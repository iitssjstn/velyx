import { HttpError } from '../http-error.js';
import { createLogger } from '../logger.js';
import type { FetchLike } from './tmdb.js';
import type { SettingsService } from './settings.js';
import { RelayClient, type RelayProblem } from './relay-client.js';

const log = createLogger('cloud');
const TIMEOUT_MS = 10_000;
/** How often a linked server tells the account service it is still there. */
const HEARTBEAT_MS = 30 * 60_000;

export interface CloudStatus {
  /** Linking is on (the server is registered with the account service). */
  enabled: boolean;
  /** Linked to this account (email), or null while waiting for the code to be entered. */
  account: string | null;
  /** The code to enter on the account page, while it is valid. */
  code: { code: string; expiresAt: number; linkUrl: string } | null;
  /** Where the account pages are. */
  serviceUrl: string;
  /** The relay: reachable at `url` without an open port (opt-in, only while linked). */
  relay: { enabled: boolean; url: string | null; connected: boolean; error: RelayProblem | null };
}

/**
 * Links this server to a Vidalune account, only after an administrator turns it on. What the
 * service gets: the server's name, version and public address (if set). Never media, users or
 * what anyone watches.
 */
export class CloudService {
  private code: CloudStatus['code'] = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly relay: RelayClient;

  constructor(
    private readonly deps: {
      baseUrl: string;
      settings: SettingsService;
      version: string;
      fetchImpl?: FetchLike;
      now?: () => number;
      /** Where this server listens: relayed requests are passed there. */
      localPort: number;
    },
  ) {
    this.relay = new RelayClient({ cloudUrl: deps.baseUrl, localPort: deps.localPort });
  }

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  status(): CloudStatus {
    const link = this.deps.settings.get().cloud;
    const code = this.code && this.code.expiresAt > this.now() && !link?.account ? this.code : null;
    const relayOn = !!(link?.account && link.relay);
    const tunnel = this.relay.status();
    return {
      enabled: !!link,
      account: link?.account ?? null,
      code,
      serviceUrl: this.deps.baseUrl,
      relay: { enabled: relayOn, url: relayOn ? (link?.relayUrl ?? null) : null, connected: relayOn && tunnel.connected, error: relayOn && !tunnel.connected ? tunnel.error : null },
    };
  }

  private about() {
    const s = this.deps.settings;
    return { name: s.serverName().slice(0, 60), version: this.deps.version, url: s.serverUrl() || null };
  }

  private async call<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const link = this.deps.settings.get().cloud;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && link) headers.Authorization = `Server ${link.serverId}:${link.secret}`;
    let res: Response;
    try {
      res = await (this.deps.fetchImpl ?? fetch)(`${this.deps.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      log.warn(`Vidalune account service not reachable: ${(err as Error).message}`);
      throw new HttpError(502, 'Could not reach the Vidalune account service. Try again later.');
    }
    if (res.status === 401 && auth) {
      // The service no longer knows this server (it was removed there): start over when linking again.
      this.deps.settings.update({ cloud: null });
      this.code = null;
      throw new HttpError(409, 'The Vidalune account service no longer knows this server. Turn linking on again.');
    }
    if (!res.ok) throw new HttpError(502, 'The Vidalune account service could not handle the request. Try again later.');
    return (await res.json()) as T;
  }

  /** Turns linking on (registering once) and returns a fresh code to enter on the account page. */
  async link(): Promise<CloudStatus> {
    if (!this.deps.settings.get().cloud) {
      const reg = await this.call<{ id: string; secret: string }>('POST', '/api/server/register', this.about(), false);
      this.deps.settings.update({ cloud: { serverId: reg.id, secret: reg.secret, account: null } });
      this.start();
    }
    const c = await this.call<{ code: string; expiresAt: number; linkUrl: string }>('POST', '/api/server/code', {});
    // The code rides along after "#": it is not sent to the service in the page request.
    this.code = { code: c.code, expiresAt: c.expiresAt, linkUrl: `${c.linkUrl}#${c.code}` };
    return this.status();
  }

  /** Reports in and learns whether (and to whom) this server is linked. */
  async check(): Promise<CloudStatus> {
    const link = this.deps.settings.get().cloud;
    if (!link) return this.status();
    const r = await this.call<{ linked: boolean; account: string | null; relay?: { enabled: boolean; url: string | null } }>('POST', '/api/server/heartbeat', this.about());
    const current = this.deps.settings.get().cloud;
    // The service decides: an unlinked server (unlinked on vidalune.com) has no relay any more.
    const relay = !!r.relay?.enabled;
    const relayUrl = r.relay?.url ?? null;
    if (current && (current.account !== r.account || !!current.relay !== relay || (current.relayUrl ?? null) !== relayUrl)) {
      this.deps.settings.update({ cloud: { ...current, account: r.account, relay, relayUrl } });
    }
    if (r.account) this.code = null;
    this.syncRelay();
    return this.status();
  }

  /** Turns the relay on or off (the server must be linked). */
  async setRelay(enabled: boolean): Promise<CloudStatus> {
    const link = this.deps.settings.get().cloud;
    if (!link?.account) throw new HttpError(409, 'Link this server to a Vidalune account first.');
    const r = await this.call<{ enabled: boolean; url: string | null }>('POST', '/api/server/relay', { enabled });
    this.deps.settings.update({ cloud: { ...link, relay: r.enabled, relayUrl: r.url } });
    this.syncRelay();
    return this.status();
  }

  /** Opens or closes the tunnel to match the settings. */
  private syncRelay() {
    const link = this.deps.settings.get().cloud;
    if (link?.account && link.relay) this.relay.start(`Server ${link.serverId}:${link.secret}`);
    else this.relay.stop();
  }

  /** Turns linking off: the service forgets this server, and nothing is sent any more. */
  async unlink(): Promise<CloudStatus> {
    if (this.deps.settings.get().cloud) {
      try {
        await this.call('DELETE', '/api/server');
      } catch (err) {
        // Off is off, also when the service cannot be reached: it forgets silent servers by itself.
        log.warn(`Could not tell the account service: ${(err as Error).message}`);
      }
    }
    this.deps.settings.update({ cloud: null });
    this.code = null;
    this.stop();
    this.relay.stop();
    return this.status();
  }

  /** Reports in every half hour while linking is on. */
  start(): void {
    if (this.timer || !this.deps.settings.get().cloud) return;
    this.syncRelay();
    const beat = () => void this.check().catch(() => {});
    setTimeout(beat, 30_000).unref();
    this.timer = setInterval(beat, HEARTBEAT_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Server shutdown: also closes the relay tunnel. */
  shutdown(): void {
    this.stop();
    this.relay.stop();
  }
}
