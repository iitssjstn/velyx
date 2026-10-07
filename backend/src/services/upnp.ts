import dgram from 'node:dgram';
import { HttpError } from '../http-error.js';
import { createLogger } from '../logger.js';
import type { SettingsService } from './settings.js';
import type { FetchLike } from './tmdb.js';

const log = createLogger('upnp');
/** How long a port stays open on the router before it has to be asked again. */
const LEASE_S = 3600;
/** Asked again well before that. */
const RENEW_MS = 30 * 60_000;
const SEARCH_MS = 3000;
const TIMEOUT_MS = 5000;
const SSDP = { host: '239.255.255.250', port: 1900 };
const SERVICES = ['urn:schemas-upnp-org:service:WANIPConnection:2', 'urn:schemas-upnp-org:service:WANIPConnection:1', 'urn:schemas-upnp-org:service:WANPPPConnection:1'];

/** Why opening the port did not work. */
export type UpnpProblem = 'noRouter' | 'refused' | 'failed';

export interface UpnpStatus {
  enabled: boolean;
  /** The port on the router (the outside world) that leads to this server. */
  externalPort: number;
  /** The router opened it: the server is reachable at `address`. */
  open: boolean;
  /** Public IP and port for diagnostics only; use the automatically issued hostname for HTTPS. */
  address: string | null;
  problem: UpnpProblem | null;
  /** When the router last confirmed it. */
  checkedAt: number | null;
}

interface Gateway {
  controlUrl: string;
  serviceType: string;
  /** This server's address as the router sees it. */
  localIp: string;
}

/** The value of one XML element (the first one), without its tags. */
const tag = (xml: string, name: string) => new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`, 'i').exec(xml)?.[1]?.trim() ?? null;

/** Finds the router's "open a port" service in its description (the XML its SSDP answer points to). */
export function findService(xml: string, location: string): { controlUrl: string; serviceType: string } | null {
  for (const block of xml.split(/<service>/i).slice(1)) {
    const type = tag(block, 'serviceType');
    const control = tag(block, 'controlURL');
    if (type && control && SERVICES.includes(type)) return { serviceType: type, controlUrl: new URL(control, tag(xml, 'URLBase') || location).toString() };
  }
  return null;
}

/**
 * Opens a port on the router with UPnP (opt-in: Admin → Vidalune account), so the server can be
 * reached from outside without setting up port forwarding by hand. It asks the router again every
 * half hour, and closes the port when turned off. Only works when the router allows UPnP and this
 * server is on the home network itself (in Docker: network_mode: host).
 */
export class UpnpService {
  private timer: NodeJS.Timeout | null = null;
  private state: Pick<UpnpStatus, 'open' | 'address' | 'problem' | 'checkedAt'> = { open: false, address: null, problem: null, checkedAt: null };
  private gateway: Gateway | null = null;

  constructor(
    private readonly deps: {
      settings: SettingsService;
      /** The port this server listens on (inside). */
      localPort: number;
      fetchImpl?: FetchLike;
      /** Where to search (tests: a stand-in router on localhost). */
      ssdp?: { host: string; port: number };
      now?: () => number;
    },
  ) {}

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  status(): UpnpStatus {
    const s = this.deps.settings.get().upnp;
    return { enabled: s.enabled, externalPort: s.externalPort, ...this.state };
  }

  /** Turns it on or off (and sets the outside port). */
  async configure(enabled: boolean, externalPort: number): Promise<UpnpStatus> {
    const before = this.deps.settings.get().upnp;
    if (before.enabled && this.state.open && (!enabled || externalPort !== before.externalPort)) await this.close(before.externalPort);
    this.deps.settings.update({ upnp: { enabled, externalPort } });
    this.stop();
    if (enabled) {
      await this.renew();
      this.start();
    } else {
      this.state = { open: false, address: null, problem: null, checkedAt: null };
    }
    return this.status();
  }

  /** Asks the router (again) to keep the port open. */
  async renew(): Promise<UpnpStatus> {
    const { enabled, externalPort } = this.deps.settings.get().upnp;
    if (!enabled) return this.status();
    try {
      this.gateway ??= await this.discover();
      if (!this.gateway) {
        this.state = { open: false, address: null, problem: 'noRouter', checkedAt: this.now() };
        return this.status();
      }
      const g = this.gateway;
      await this.soap(g, 'AddPortMapping', {
        NewRemoteHost: '',
        NewExternalPort: String(externalPort),
        NewProtocol: 'TCP',
        NewInternalPort: String(this.deps.localPort),
        NewInternalClient: g.localIp,
        NewEnabled: '1',
        NewPortMappingDescription: 'Vidalune',
        NewLeaseDuration: String(LEASE_S),
      });
      const ip = tag(await this.soap(g, 'GetExternalIPAddress', {}), 'NewExternalIPAddress');
      this.state = { open: true, address: ip ? `${ip}:${externalPort}` : null, problem: null, checkedAt: this.now() };
    } catch (err) {
      const refused = err instanceof HttpError && err.statusCode === 409;
      if (!refused) this.gateway = null;
      log.warn(`Could not open the port on the router: ${(err as Error).message}`);
      this.state = { open: false, address: null, problem: refused ? 'refused' : 'failed', checkedAt: this.now() };
    }
    return this.status();
  }

  private async close(externalPort: number) {
    try {
      const g = this.gateway ?? (await this.discover());
      if (g) await this.soap(g, 'DeletePortMapping', { NewRemoteHost: '', NewExternalPort: String(externalPort), NewProtocol: 'TCP' });
    } catch (err) {
      // The lease runs out by itself within the hour.
      log.warn(`Could not close the port on the router: ${(err as Error).message}`);
    }
  }

  /** Looks for the router on the home network (SSDP), and reads where to ask it. */
  private async discover(): Promise<Gateway | null> {
    const target = this.deps.ssdp ?? SSDP;
    const found = await new Promise<{ location: string; localIp: string } | null>((resolve) => {
      const socket = dgram.createSocket('udp4');
      const done = (v: { location: string; localIp: string } | null) => {
        clearTimeout(timer);
        socket.close();
        resolve(v);
      };
      const timer = setTimeout(() => done(null), SEARCH_MS);
      socket.on('error', () => done(null));
      socket.on('message', (msg) => {
        const location = /^location:\s*(\S+)/im.exec(msg.toString())?.[1];
        if (!location) return;
        // Our own address towards the router: what it should send outside visitors to.
        const probe = dgram.createSocket('udp4');
        const host = new URL(location).hostname;
        probe.connect(1900, host, () => {
          const localIp = probe.address().address;
          probe.close();
          done({ location, localIp });
        });
        probe.on('error', () => probe.close());
      });
      const search = ['M-SEARCH * HTTP/1.1', `HOST: ${SSDP.host}:${SSDP.port}`, 'MAN: "ssdp:discover"', 'MX: 2', 'ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1', '', ''].join('\r\n');
      socket.bind(() => socket.send(search, target.port, target.host));
    });
    if (!found) return null;
    const res = await (this.deps.fetchImpl ?? fetch)(found.location, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const service = res.ok ? findService(await res.text(), found.location) : null;
    return service ? { ...service, localIp: found.localIp } : null;
  }

  private async soap(g: Gateway, action: string, args: Record<string, string>): Promise<string> {
    const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${g.serviceType}">${Object.entries(args)
      .map(([k, v]) => `<${k}>${v}</${k}>`)
      .join('')}</u:${action}></s:Body></s:Envelope>`;
    const res = await (this.deps.fetchImpl ?? fetch)(g.controlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${g.serviceType}#${action}"` },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    // The router said no (for example: the port is already used by another device).
    if (!res.ok) throw new HttpError(res.status === 500 ? 409 : 502, `${action}: ${tag(text, 'errorDescription') ?? res.status}`);
    return text;
  }

  start(): void {
    if (this.timer || !this.deps.settings.get().upnp.enabled) return;
    this.timer = setInterval(() => void this.renew(), RENEW_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
