import os from 'node:os';
import { isIP } from 'node:net';
import { HttpError } from '../http-error.js';
import { createLogger } from '../logger.js';
import type { FetchLike } from './tmdb.js';
import type { SettingsService } from './settings.js';
import { RelayClient, type RelayProblem } from './relay-client.js';
import { DEFAULT_DIRECT_TLS_PORT } from '../config.js';

const log = createLogger('cloud');
const TIMEOUT_MS = 10_000;
/** Refresh dynamic IP, DNS and external port reachability often enough to recover quickly. */
const HEARTBEAT_MS = 5 * 60_000;
/** When vidalune.com cannot be reached, remote access it confirmed keeps working this long. */
export const REMOTE_GRACE_MS = 7 * 24 * 60 * 60_000;
/** A server without remote access asks again at most this often (it may just have been given). */
const RECHECK_MS = 2 * 60_000;

export interface LocalEndpoint {
  type: 'lan';
  address: string;
  port: number;
  protocol: 'https';
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [first, second] = address.split('.').map(Number);
    return first === 10 || (first === 172 && second! >= 16 && second! <= 31) || (first === 192 && second === 168) || (first === 100 && second! >= 64 && second! <= 127);
  }
  if (version === 6) return /^(?:fc|fd)/i.test(address);
  return false;
}

/** Private interface addresses are endpoint hints only; the account service observes the WAN IP itself. */
export function localEndpoints(port: number, interfaces = os.networkInterfaces()): LocalEndpoint[] {
  const addresses = Object.values(interfaces).flatMap((items) => items ?? [])
    .filter((item) => !item.internal && isPrivateAddress(item.address))
    .map((item) => item.address);
  return [...new Set(addresses)].map((address) => ({ type: 'lan', address, port, protocol: 'https' }));
}

/** Whether playing away from home is allowed, and why not. */
export type RemoteAccess = 'allowed' | 'not_linked' | 'no_subscription';

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
  relay: { enabled: boolean; url: string | null; connected: boolean; error: RelayProblem | null; allowed: boolean };
  /** Automatically assigned direct hostname; certificate and listener may still be provisioning. */
  directAccess: { configured: boolean; hostname: string; publicIp: string | null; port: number; dnsReady: boolean; tlsReady: boolean; portOpen: boolean; checkedAt: number | null; url: string | null; localEndpoints: LocalEndpoint[] } | null;
  /** Playing away from home works (linked, and the owner has remote access as last confirmed). */
  remoteAccess: boolean;
  /** Networks that also count as home, on top of the private ranges. */
  homeNetworks: string[];
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
      /** Public HTTPS port forwarded to the direct listener. */
      directPublicPort?: () => number;
      /** The local HTTPS listener port (also used to report LAN endpoint hints). */
      directTlsPort?: number;
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
      relay: {
        enabled: relayOn,
        url: relayOn ? (link?.relayUrl ?? null) : null,
        connected: relayOn && tunnel.connected,
        error: relayOn && !tunnel.connected ? tunnel.error : null,
        // The owner's Vidalune account has remote access (unknown until the service said so: yes).
        // Whether the relay may be on (the owner has remote access, or someone who uses this server).
        allowed: (link?.relayUsable ?? link?.relayAllowed) !== false,
      },
      directAccess: link?.directAccess ? {
        ...link.directAccess,
        localEndpoints: link.directAccess.localEndpoints ?? localEndpoints(this.deps.directTlsPort ?? DEFAULT_DIRECT_TLS_PORT),
      } : null,
      remoteAccess: !!link?.account && link.relayAllowed !== false && !!link.remoteConfirmedAt && this.now() - link.remoteConfirmedAt < REMOTE_GRACE_MS,
      homeNetworks: this.deps.settings.get().homeNetworks,
    };
  }

  private about() {
    const s = this.deps.settings;
    return { name: s.serverName().slice(0, 60), version: this.deps.version, url: s.serverUrl() || null, directPort: this.deps.directPublicPort?.() ?? DEFAULT_DIRECT_TLS_PORT, localEndpoints: localEndpoints(this.deps.directTlsPort ?? DEFAULT_DIRECT_TLS_PORT) };
  }

  private heartbeat() {
    return {
      ...this.about(),
      directPort: this.deps.directPublicPort?.() ?? DEFAULT_DIRECT_TLS_PORT,
      directTlsReady: this.deps.settings.get().cloud?.directTlsReady ?? false,
    };
  }

  setDirectTlsReady(ready: boolean): void {
    const current = this.deps.settings.get().cloud;
    if (!current || current.directTlsReady === ready) return;
    this.deps.settings.update({ cloud: { ...current, directTlsReady: ready } });
    void this.check().catch((err) => log.warn(`Could not report direct TLS status: ${(err as Error).message}`));
  }

  /** `soft401`: a 401 is about the request (a used ticket), not about this server's registration. */
  /** `soft402`: pass a 402 (no remote access) on instead of a generic failure. */
  /** `pass`: statuses passed on as they are (with the service's message) instead of a generic failure. */
  private async call<T>(method: string, path: string, body?: unknown, auth = true, soft401 = false, soft402 = false, pass: number[] = [], timeoutMs = TIMEOUT_MS): Promise<T> {
    const link = this.deps.settings.get().cloud;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && link) headers.Authorization = `Server ${link.serverId}:${link.secret}`;
    let res: Response;
    try {
      res = await (this.deps.fetchImpl ?? fetch)(`${this.deps.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      log.warn(`Vidalune account service not reachable: ${(err as Error).message}`);
      throw new HttpError(502, 'Could not reach the Vidalune account service. Try again later.');
    }
    if (res.status === 401 && soft401) throw new HttpError(401, 'This sign-in link is not valid (any more).');
    if (res.status === 401 && auth) {
      // The service no longer knows this server (it was removed there): start over when linking again.
      this.deps.settings.update({ cloud: null });
      this.code = null;
      throw new HttpError(409, 'The Vidalune account service no longer knows this server. Turn linking on again.');
    }
    if (res.status === 402 && soft402) throw new HttpError(402, 'Remote access through Vidalune needs a subscription.');
    if (pass.includes(res.status)) {
      const answer = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new HttpError(res.status, answer?.error ?? 'The Vidalune account service could not handle the request.');
    }
    if (!res.ok) throw new HttpError(502, 'The Vidalune account service could not handle the request. Try again later.');
    return (await res.json()) as T;
  }

  /** Registers this server with the account service once (for shared detection; linking not needed). */
  async ensureRegistered(): Promise<void> {
    if (this.deps.settings.get().cloud) return;
    const reg = await this.call<{ id: string; secret: string }>('POST', '/api/server/register', this.about(), false);
    this.deps.settings.update({ cloud: { serverId: reg.id, secret: reg.secret, account: null } });
    this.start();
  }

  /** Whether this server is known to the account service (registered). */
  registered(): boolean {
    return !!this.deps.settings.get().cloud;
  }

  /** Shared detection: a season's profile (what servers agree on, fingerprints). */
  detectionProfile<T>(tmdbShow: number, season: number): Promise<T> {
    return this.call<T>('GET', `/api/detection/${tmdbShow}/${season}`);
  }

  /** Shared detection: reports what this server found in a season; answers with the new profile. */
  reportDetection<T>(body: unknown): Promise<T> {
    return this.call<T>('POST', '/api/detection/reports', body);
  }

  /** Online subtitles through vidalune.com: only for a server linked to a Vidalune account. */
  linked(): boolean {
    return !!this.deps.settings.get().cloud?.account;
  }

  /** Online subtitles through vidalune.com: OpenSubtitles' answer to a search. */
  async subtitleSearch(query: unknown): Promise<unknown[]> {
    return (await this.call<{ data: unknown[] }>('POST', '/api/subtitles/search', query, true, false, false, [403, 429, 503])).data;
  }

  /** Online subtitles through vidalune.com: one subtitle file (SubRip). */
  async subtitleDownload(fileId: number): Promise<Buffer> {
    const r = await this.call<{ data: string }>('POST', '/api/subtitles/download', { fileId }, true, false, false, [403, 429, 503]);
    return Buffer.from(r.data, 'base64');
  }

  /** Turns linking on (registering once) and returns a fresh code to enter on the account page. */
  async link(userId?: number): Promise<CloudStatus> {
    if (!this.deps.settings.get().cloud) {
      const reg = await this.call<{ id: string; secret: string }>('POST', '/api/server/register', this.about(), false);
      this.deps.settings.update({ cloud: { serverId: reg.id, secret: reg.secret, account: null } });
      this.start();
    }
    // The administrator asking signs in with that account from then on.
    const c = await this.call<{ code: string; expiresAt: number; linkUrl: string }>('POST', '/api/server/code', userId ? { userRef: String(userId) } : {});
    // The code rides along after "#": it is not sent to the service in the page request.
    this.code = { code: c.code, expiresAt: c.expiresAt, linkUrl: `${c.linkUrl}#${c.code}` };
    return this.status();
  }

  /** Reports in and learns whether (and to whom) this server is linked. */
  async check(): Promise<CloudStatus> {
    const link = this.deps.settings.get().cloud;
    if (!link) return this.status();
    const r = await this.call<{ linked: boolean; account: string | null; relay?: { enabled: boolean; url: string | null; allowed?: boolean; usable?: boolean }; directAccess?: CloudStatus['directAccess']; remoteUsers?: unknown[] }>('POST', '/api/server/heartbeat', this.heartbeat());
    const current = this.deps.settings.get().cloud;
    // The service decides: an unlinked server (unlinked on vidalune.com) has no relay any more.
    const relay = !!r.relay?.enabled;
    const relayUrl = r.relay?.url ?? null;
    const relayAllowed = r.relay?.allowed !== false;
    const relayUsable = r.relay?.usable ?? relayAllowed;
    const remoteUsers = Array.isArray(r.remoteUsers) ? r.remoteUsers.filter((u): u is string => typeof u === 'string') : [];
    this.checkedAt = this.now();
    if (current) {
      const confirmed = r.account && (relayAllowed || remoteUsers.length > 0) ? this.now() : current.remoteConfirmedAt;
      this.deps.settings.update({ cloud: { ...current, account: r.account, relay, relayUrl, relayAllowed, relayUsable, directAccess: r.directAccess ?? current.directAccess ?? null, remoteUsers, remoteConfirmedAt: confirmed } });
    }
    if (r.account) this.code = null;
    this.syncRelay();
    return this.status();
  }

  private checkedAt = 0;

  /** Requests a certificate for this server's assigned hostname; its private key is never sent. `pending`: still being issued, ask again. */
  async directCertificate(csr: string, keyId: string): Promise<{ hostname: string; certificate: string } | { pending: true }> {
    if (!this.deps.settings.get().cloud?.account) throw new HttpError(409, 'Link this server to a Vidalune account first.');
    return this.call<{ hostname: string; certificate: string } | { pending: true }>('POST', '/api/server/direct/certificate', { csr, keyId }, true, false, false, [409, 429, 502, 503], 45_000);
  }

  /**
   * Whether this server may be used away from home: linked to a Vidalune account whose owner has
   * remote access. A "no" is checked again (at most every two minutes), since it may just have been
   * given; when vidalune.com cannot be reached, a recent "yes" keeps counting for a week.
   */
  async remoteAccess(userId?: number): Promise<RemoteAccess> {
    const before = this.deps.settings.get().cloud;
    if (!before?.account) return 'not_linked';
    // Everyone, when the owner has remote access; else only users with a viewer subscription.
    const may = (l: typeof before) => l.relayAllowed !== false || (userId !== undefined && (l.remoteUsers ?? []).includes(String(userId)));
    const fresh = (l: typeof before) => may(l) && !!l.remoteConfirmedAt && this.now() - l.remoteConfirmedAt < RECHECK_MS * 15;
    if (fresh(before)) return 'allowed';
    if (this.now() - this.checkedAt >= RECHECK_MS) {
      try {
        await this.check();
      } catch {
        /* unreachable: decide on what was confirmed before */
      }
    }
    const link = this.deps.settings.get().cloud;
    if (!link?.account) return 'not_linked';
    if (!may(link)) return 'no_subscription';
    return link.remoteConfirmedAt && this.now() - link.remoteConfirmedAt < REMOTE_GRACE_MS ? 'allowed' : 'no_subscription';
  }

  /** The site where people sign in with their Vidalune account and open their servers. */
  appUrl(): string | null {
    if (!this.deps.settings.get().cloud?.account) return null;
    const u = new URL(this.deps.baseUrl);
    return `${u.protocol}//app.${u.host}`;
  }

  private membersCache: { at: number; list: Array<{ userRef: string; email: string }> } | null = null;

  /** Which users here connected a Vidalune account (asked at most every half minute). */
  async members(): Promise<Array<{ userRef: string; email: string }>> {
    if (!this.deps.settings.get().cloud?.account) return [];
    if (this.membersCache && this.membersCache.at > this.now() - 30_000) return this.membersCache.list;
    const list = await this.call<Array<{ userRef: string; email: string }>>('GET', '/api/server/members');
    this.membersCache = { at: this.now(), list };
    return list;
  }

  /** A code for one user here to connect their own Vidalune account. */
  async memberCode(userId: number): Promise<{ code: string; expiresAt: number; linkUrl: string }> {
    if (!this.deps.settings.get().cloud?.account) throw new HttpError(409, 'Link this server to a Vidalune account first.');
    const c = await this.call<{ code: string; expiresAt: number; linkUrl: string }>('POST', '/api/server/member-code', { userRef: String(userId) });
    this.membersCache = null;
    return { code: c.code, expiresAt: c.expiresAt, linkUrl: `${c.linkUrl}#${c.code}` };
  }

  async removeMember(userId: number): Promise<void> {
    if (!this.deps.settings.get().cloud) return;
    await this.call('DELETE', `/api/server/members/${userId}`);
    this.membersCache = null;
  }

  /** Exchanges a one-time ticket from vidalune.com for who is opening this server. */
  async redeem(ticket: string): Promise<{ email: string | null; userRef: string | null; owner?: boolean }> {
    if (!this.deps.settings.get().cloud?.account) throw new HttpError(401, 'This sign-in link is not valid (any more).');
    try {
      return await this.call<{ email: string | null; userRef: string | null; owner?: boolean }>('POST', '/api/server/ticket', { ticket }, true, true);
    } catch (err) {
      if (err instanceof HttpError && err.statusCode === 401) throw new HttpError(401, 'This sign-in link is not valid (any more).');
      throw err;
    }
  }

  /** Connects a user here to the Vidalune account a ticket was made for (after they signed in by password). */
  async claim(ticket: string, userId: number): Promise<string | null> {
    if (!this.deps.settings.get().cloud?.account) throw new HttpError(409, 'Link this server to a Vidalune account first.');
    try {
      const r = await this.call<{ email: string | null }>('POST', '/api/server/claim', { ticket, userRef: String(userId) }, true, true);
      this.membersCache = null;
      return r.email;
    } catch (err) {
      if (err instanceof HttpError && err.statusCode === 401) throw new HttpError(401, 'This sign-in link is not valid (any more).');
      throw err;
    }
  }

  /** Connects the owner's Vidalune account (the one this server is linked to) to a user here. */
  async connectOwner(userId: number): Promise<void> {
    await this.call('POST', '/api/server/owner-member', { userRef: String(userId) }, true, true);
    this.membersCache = null;
  }

  /** A link on vidalune.com for someone to accept an invitation to this server (seven days, once). */
  async createInvite(ref: string): Promise<{ url: string; expiresAt: number }> {
    if (!this.deps.settings.get().cloud?.account) throw new HttpError(409, 'Link this server to a Vidalune account first.');
    return this.call<{ url: string; expiresAt: number }>('POST', '/api/server/invites', { ref });
  }

  /** Withdraws an invitation there (whoever accepted it loses the server from their list). */
  async revokeInvite(ref: string): Promise<void> {
    if (!this.deps.settings.get().cloud) return;
    await this.call('DELETE', `/api/server/invites/${encodeURIComponent(ref)}`);
    this.membersCache = null;
  }

  /** The user made for an accepted invitation: that Vidalune account signs in as them from now on. */
  async inviteUser(ref: string, userId: number): Promise<void> {
    await this.call('POST', `/api/server/invites/${encodeURIComponent(ref)}/user`, { userRef: String(userId) });
    this.membersCache = null;
  }

  /** Turns the relay on or off (the server must be linked). */
  async setRelay(enabled: boolean): Promise<CloudStatus> {
    const link = this.deps.settings.get().cloud;
    if (!link?.account) throw new HttpError(409, 'Link this server to a Vidalune account first.');
    let r: { enabled: boolean; url: string | null; allowed?: boolean; usable?: boolean };
    try {
      r = await this.call('POST', '/api/server/relay', { enabled }, true, false, true);
    } catch (err) {
      if (err instanceof HttpError && err.statusCode === 402) {
        this.deps.settings.update({ cloud: { ...link, relayUsable: false } });
        throw new HttpError(402, 'Remote access through Vidalune needs a subscription.');
      }
      throw err;
    }
    this.deps.settings.update({ cloud: { ...link, relay: r.enabled, relayUrl: r.url, relayAllowed: r.allowed !== false, relayUsable: r.usable ?? r.allowed !== false } });
    this.syncRelay();
    return this.status();
  }

  /** Opens or closes the tunnel to match the settings. */
  private syncRelay() {
    const link = this.deps.settings.get().cloud;
    if (link?.account) this.relay.start(`Server ${link.serverId}:${link.secret}`);
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
