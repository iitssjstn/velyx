import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { eq, lt, sql } from 'drizzle-orm';
import { WebSocketServer, type WebSocket } from 'ws';
import type { DB } from './db/client.js';
import { relayTraffic, servers } from './db/schema.js';
import { sha256 } from './crypto.js';
import { CHUNK, decodeFrame, encodeFrame, FRAME, HOP_BY_HOP, INITIAL_WINDOW, windowPayload } from './tunnel-protocol.js';
import { mbpsToBps, Shaper } from './shaper.js';

/** Subdomains that are never given to a server. */
export const RESERVED = new Set(['www', 'app', 'api', 'relay', 'admin', 'mail', 'status', 'docs', 'cloud', 'help', 'support', 'blog', 'account', 'login', 'discord']);
const SLUG_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const newSlug = () => Array.from({ length: 8 }, () => SLUG_ALPHABET[crypto.randomInt(SLUG_ALPHABET.length)]).join('');

/** Requests a server may have open through the relay at once. */
const MAX_STREAMS = 64;
/** Largest request body passed on (servers take JSON and small uploads). */
const MAX_REQUEST_BODY = 8 * 1024 * 1024;
const PING_MS = 25_000;
/** How often the current speed is measured, and how often amounts are written down. */
const SAMPLE_MS = 5000;
const FLUSH_EVERY = 12;
/** A client (a viewer's device) counts as connected while it asked something this recently. */
export const CLIENT_WINDOW_MS = 5 * 60_000;

/** What kind of device a request comes from, for the CEO panel (from its user agent; nothing else is kept). */
export function deviceLabel(ua: string | undefined): string {
  const u = String(ua ?? '');
  if (/CrKey/i.test(u)) return 'Chromecast';
  if (/Vidalune|okhttp|Expo|ReactNative/i.test(u)) return /iPhone|iPad|iOS/i.test(u) ? 'Vidalune app (iOS)' : 'Vidalune app (Android)';
  const os = /Android/i.test(u) ? 'Android' : /iPhone|iPad/i.test(u) ? 'iOS' : /Windows/i.test(u) ? 'Windows' : /Mac OS X|Macintosh/i.test(u) ? 'macOS' : /CrOS/i.test(u) ? 'ChromeOS' : /Linux/i.test(u) ? 'Linux' : null;
  const browser = /Edg\//.test(u) ? 'Edge' : /Firefox\//.test(u) ? 'Firefox' : /Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? 'Other device';
}

/** A client of a server right now: its kind of device, since when, and what it received. */
export interface RelayClient {
  device: string;
  since: number;
  lastSeen: number;
  bytes: number;
}

/** Changes made to what passes through (app.vidalune.com: cookies per server, a strict policy). */
export interface Rewrite {
  request?: (headers: Record<string, string | string[]>) => void;
  response?: (headers: Record<string, string | string[]>) => void;
}

interface Stream {
  res: ServerResponse;
  req: IncomingMessage;
  started: boolean;
  /** Bytes written to the visitor but not yet credited back (waiting for "drain"). */
  owed: number;
  rewrite: Rewrite;
  /** The client it is for (see Tunnel.clients). */
  client: RelayClient;
}

class Tunnel {
  readonly streams = new Map<number, Stream>();
  private next = 1;
  private alive = true;
  private readonly ping: NodeJS.Timeout;
  /** Not yet written down: bytes to visitors, from visitors, and requests. */
  out = 0;
  in = 0;
  requests = 0;
  /** Visitors who got an error instead of an answer (busy, too large, failed, cut off). */
  errors = 0;
  /** Bytes to visitors since the last speed sample, and the speed then (bytes per second). */
  sampled = 0;
  bps = 0;
  /** When the tunnel opened. */
  readonly since = Date.now();
  /**
   * Clients seen recently, by a hash of their address and user agent (neither is kept): how many
   * devices watch through this server, and on what.
   */
  readonly clients = new Map<string, RelayClient>();

  constructor(
    readonly serverId: string,
    readonly ws: WebSocket,
    private readonly onClose: () => void,
    private readonly shaper: Shaper,
    /** This server's own limit in bytes per second (0: none). */
    public capBps: number,
  ) {
    ws.on('message', (data: Buffer) => this.onFrame(data));
    ws.on('pong', () => (this.alive = true));
    ws.on('close', () => this.closed());
    ws.on('error', () => ws.terminate());
    this.ping = setInterval(() => {
      if (!this.alive) return ws.terminate();
      this.alive = false;
      ws.ping();
    }, PING_MS);
    this.ping.unref();
  }

  private send(type: Parameters<typeof encodeFrame>[0], stream: number, payload?: Buffer | string) {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(encodeFrame(type, stream, payload));
  }

  /** Passes one visitor's request to the server and its answer back. */
  forward(req: IncomingMessage, res: ServerResponse, ip: string, rewrite: Rewrite = {}): void {
    if (this.streams.size >= MAX_STREAMS) {
      this.errors++;
      return unavailable(req, res, 'busy');
    }
    this.requests++;
    const id = this.next;
    this.next = this.next >= 0xfffffff0 ? 1 : this.next + 1;
    const stream: Stream = { req, res, started: false, owed: 0, rewrite, client: this.clientOf(viewerAddress(req, ip), req.headers['user-agent']) };
    this.streams.set(id, stream);
    const headers: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined || HOP_BY_HOP.has(k) || k.startsWith('x-forwarded-') || k === 'forwarded' || k === 'x-real-ip') continue;
      headers[k] = v;
    }
    rewrite.request?.(headers);
    this.send(FRAME.request, id, JSON.stringify({ method: req.method, url: req.url, headers, ip, window: INITIAL_WINDOW }));
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      this.in += chunk.length;
      if (size > MAX_REQUEST_BODY) {
        this.reset(id);
        this.errors++;
        return unavailable(req, res, 'tooLarge');
      }
      for (let i = 0; i < chunk.length; i += CHUNK) this.send(FRAME.requestBody, id, chunk.subarray(i, i + CHUNK));
    });
    req.on('end', () => this.send(FRAME.requestEnd, id));
    // The visitor left (closed the tab, skipped ahead in a video): stop the server sending.
    res.on('close', () => {
      if (this.streams.delete(id) && !res.writableFinished) this.send(FRAME.reset, id);
    });
  }

  private clientOf(ip: string, ua: string | undefined): RelayClient {
    const key = sha256(`${ip}|${ua ?? ''}`).slice(0, 24);
    const t = Date.now();
    let c = this.clients.get(key);
    if (!c || c.lastSeen < t - CLIENT_WINDOW_MS) {
      c = { device: deviceLabel(ua), since: t, lastSeen: t, bytes: 0 };
      this.clients.set(key, c);
    }
    c.lastSeen = t;
    if (this.clients.size > 500) for (const [k, v] of this.clients) if (v.lastSeen < t - CLIENT_WINDOW_MS) this.clients.delete(k);
    return c;
  }

  /** Clients that asked something in the last few minutes. */
  recentClients(now = Date.now()): RelayClient[] {
    const out: RelayClient[] = [];
    for (const [k, c] of this.clients) {
      if (c.lastSeen < now - CLIENT_WINDOW_MS && ![...this.streams.values()].some((s) => s.client === c)) this.clients.delete(k);
      else out.push(c);
    }
    return out;
  }

  /** Credit for bytes the visitor took, passed back no faster than this server's fair share. */
  private credit(id: number, bytes: number) {
    const go = () => {
      if (this.streams.has(id)) this.send(FRAME.window, id, windowPayload(bytes));
    };
    const wait = this.shaper.delay(this.serverId, bytes, this.capBps);
    if (wait <= 0) go();
    else setTimeout(go, wait).unref();
  }

  private reset(id: number) {
    this.streams.delete(id);
    this.send(FRAME.reset, id);
  }

  private onFrame(data: Buffer) {
    const frame = decodeFrame(data);
    if (!frame) return;
    const stream = this.streams.get(frame.stream);
    if (!stream) return;
    const { res } = stream;
    switch (frame.type) {
      case FRAME.response: {
        let head: { status: number; headers: Record<string, string | string[]> };
        try {
          head = JSON.parse(frame.payload.toString());
        } catch {
          return this.reset(frame.stream);
        }
        const headers: Record<string, string | string[]> = {};
        for (const [k, v] of Object.entries(head.headers ?? {})) if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k.toLowerCase()] = v;
        stream.rewrite.response?.(headers);
        stream.started = true;
        res.writeHead(head.status, headers);
        break;
      }
      case FRAME.responseBody: {
        // Credit goes back once the visitor has taken the bytes: a slow viewer slows the server down.
        this.out += frame.payload.length;
        this.sampled += frame.payload.length;
        stream.client.bytes += frame.payload.length;
        stream.client.lastSeen = Date.now();
        const waiting = stream.owed > 0;
        stream.owed += frame.payload.length;
        const pay = () => {
          const owed = stream.owed;
          stream.owed = 0;
          this.credit(frame.stream, owed);
        };
        if (waiting) {
          res.write(frame.payload);
        } else if (res.write(frame.payload)) {
          pay();
        } else {
          res.once('drain', pay);
        }
        break;
      }
      case FRAME.responseEnd:
        this.streams.delete(frame.stream);
        res.end();
        break;
      case FRAME.reset:
        this.streams.delete(frame.stream);
        if (!stream.started) {
          this.errors++;
          unavailable(stream.req, res, 'failed');
        }
        else res.destroy();
        break;
    }
  }

  private closed() {
    clearInterval(this.ping);
    for (const { req, res, started } of this.streams.values()) {
      this.errors++;
      if (started) res.destroy();
      else unavailable(req, res, 'offline');
    }
    this.streams.clear();
    this.onClose();
  }

  close() {
    this.ws.close(1001, 'replaced');
  }
}

/** Why the relay cannot pass a request on. */
export type RelayProblem = 'offline' | 'off' | 'busy' | 'tooLarge' | 'failed';

const MEDIA_BYTES_PATH = /^\/api\/(?:media\/\d+\/(?:stream|remux|hls\/(?:index\.m3u8|init\.mp4|seg\/\d+\.m4s)|subtitles\/\d+\.vtt)|(?:online-)?subtitles\/\d+\.vtt|images\/[^/]+\/[^/]+)$/;

export function isRelayedMediaBytes(method: string, url: string | undefined): boolean {
  return (method === 'GET' || method === 'HEAD') && MEDIA_BYTES_PATH.test((url ?? '/').split('?', 1)[0]!);
}

export function rejectRelayedMedia(res: ServerResponse, acceptLanguage: string | undefined): void {
  const message = /^\s*nl\b/i.test(acceptLanguage ?? '')
    ? 'Media wordt rechtstreeks vanaf je Vidalune-server geladen; gebruik het ingestelde serveradres.'
    : 'Media is served directly from your Vidalune server; use its configured address.';
  res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Vidalune-Direct-Playback': 'required' })
    .end(JSON.stringify({ error: message, directPlayback: 'required' }));
}

const PROBLEMS: Record<RelayProblem, { status: number; en: string; nl: string }> = {
  offline: {
    status: 502,
    en: 'This Vidalune server cannot be reached through the relay right now: it is off, or has no internet connection. Try again later.',
    nl: 'Deze Vidalune-server is nu niet bereikbaar via de relay: hij staat uit of heeft geen internetverbinding. Probeer het later opnieuw.',
  },
  off: {
    status: 502,
    en: 'This Vidalune server is not reachable through the relay: its relay is off, or remote access is not active on its Vidalune account.',
    nl: 'Deze Vidalune-server is niet bereikbaar via de relay: de relay staat uit, of toegang op afstand is niet actief op het Vidalune-account.',
  },
  busy: {
    status: 503,
    en: 'This Vidalune server is busy with many requests through the relay. Try again in a moment.',
    nl: 'Deze Vidalune-server heeft het druk met veel verzoeken via de relay. Probeer het zo opnieuw.',
  },
  tooLarge: { status: 413, en: 'This is too large to send through the Vidalune relay.', nl: 'Dit is te groot om via de Vidalune-relay te versturen.' },
  failed: {
    status: 502,
    en: 'The Vidalune server stopped answering through the relay. Try again.',
    nl: 'De Vidalune-server gaf via de relay geen antwoord meer. Probeer het opnieuw.',
  },
};

/** The explanation, in the visitor's language (Dutch or English). */
export function relayMessage(problem: RelayProblem, acceptLanguage: string | undefined): string {
  const nl = /^\s*nl\b/i.test(acceptLanguage ?? '');
  return nl ? PROBLEMS[problem].nl : PROBLEMS[problem].en;
}

/** Tells the visitor why: a short page for a browser, JSON ({ error }) for the web interface and the app. */
function unavailable(req: IncomingMessage, res: ServerResponse, problem: RelayProblem): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const { status } = PROBLEMS[problem];
  const text = relayMessage(problem, req.headers['accept-language']);
  const headers = { 'Cache-Control': 'no-store', 'X-Vidalune-Relay': problem };
  if (isNavigation(req)) {
    const safe = text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    res.writeHead(status, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vidalune</title><body style="font-family:system-ui,sans-serif;background:#0b0d12;color:#e8eaf0;display:grid;place-items:center;min-height:100vh;margin:0"><p style="max-width:32rem;padding:1.5rem;line-height:1.5">${safe}</p></body>`);
    return;
  }
  res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: text, relay: problem }));
}

/** A browser opening a page (not the API, not a file the app or player asks for). */
function isNavigation(req: IncomingMessage): boolean {
  if (req.method !== 'GET') return false;
  const path = req.url ?? '/';
  if (path.startsWith('/api/') || path.startsWith('/sso')) return false;
  const mode = req.headers['sec-fetch-mode'];
  if (mode) return mode === 'navigate';
  return String(req.headers.accept ?? '').includes('text/html');
}

/**
 * The address to tell a viewer's devices apart by (for counting clients only): Cloudflare's own
 * header when it is in front (its edge addresses change from request to request), else the address
 * of the request. Nothing depends on it but that count, so a made-up header changes nothing else.
 */
export function viewerAddress(req: Pick<IncomingMessage, 'headers'>, ip: string): string {
  const cf = req.headers['cf-connecting-ip'];
  const v = (Array.isArray(cf) ? cf[0] : cf)?.trim();
  return v && v.length <= 64 ? v : ip;
}

/** The visitor's address: the socket, or the entries proxies in front of us added. */
export function clientIp(req: IncomingMessage, hops: number): string {
  const chain = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  chain.push(req.socket.remoteAddress ?? '');
  return chain[Math.max(0, chain.length - 1 - hops)] ?? '';
}

/**
 * The relay: servers keep a tunnel open to it, and https://<slug>.<domain> reaches them through
 * it. Nothing passing through is stored.
 */
export class Relay {
  private readonly tunnels = new Map<string, Tunnel>();
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: CHUNK + 1024 });
  private readonly shaper: Shaper;
  private readonly sampler: NodeJS.Timeout;
  private samples = 0;
  /** Each tunnel's speed at every sample of the last five minutes (for averages and peaks). */
  private readonly recent: Array<Map<string, number>> = [];

  constructor(
    private readonly opts: {
      db: DB;
      /** "vidalune.com": relay addresses are <slug>.vidalune.com */
      domain: string;
      /** How relay addresses are written ("https://", ":8443" in tests). */
      scheme: string;
      port: string;
      trustProxy: number;
      /** Whether the owner (account id) of a server may use the relay: they have remote access. */
      allowed: (serverId: string, accountId: number | null) => boolean;
      /** Whether a linked, unsuspended server may keep its small account-control tunnel. */
      controlAllowed: (serverId: string, accountId: number | null) => boolean;
      /** app.vidalune.com: browsers opening a relay address are sent there (null: not served). */
      appUrl?: string | null;
      /** What the relay may send in total, in Mbit/s (0: no limit). */
      maxMbps?: number;
      /** A server's own limit in Mbit/s (0: none). */
      limitMbps?: (serverId: string) => number;
      now?: () => number;
    },
  ) {
    this.shaper = new Shaper({ totalBps: () => mbpsToBps(this.opts.maxMbps ?? 0), now: opts.now });
    this.sampler = setInterval(() => this.sample(), SAMPLE_MS);
    this.sampler.unref();
  }

  private capOf(serverId: string) {
    return mbpsToBps(this.opts.limitMbps?.(serverId) ?? 0);
  }

  /** A server's limit changed: it applies to its open tunnel at once. */
  refreshLimit(serverId: string): void {
    const t = this.tunnels.get(serverId);
    if (t) t.capBps = this.capOf(serverId);
  }

  /** Measures the current speed of every tunnel; now and then writes the amounts down. */
  sample(): void {
    for (const t of this.tunnels.values()) {
      t.bps = (t.sampled * 1000) / SAMPLE_MS;
      t.sampled = 0;
    }
    this.recent.push(new Map([...this.tunnels].map(([id, t]) => [id, t.bps])));
    if (this.recent.length > CLIENT_WINDOW_MS / SAMPLE_MS) this.recent.shift();
    if (++this.samples % FLUSH_EVERY === 0) this.flush();
  }

  /** Writes down what passed through each tunnel since last time (per server and UTC day). */
  flush(): void {
    for (const t of this.tunnels.values()) this.write(t);
    // Kept for about a year.
    const cutoff = new Date((this.opts.now?.() ?? Date.now()) - 400 * 86_400_000).toISOString().slice(0, 10);
    this.opts.db.delete(relayTraffic).where(lt(relayTraffic.day, cutoff)).run();
  }

  private write(t: Tunnel) {
    if (!t.out && !t.in && !t.requests && !t.errors) return;
    const day = new Date(this.opts.now?.() ?? Date.now()).toISOString().slice(0, 10);
    const row = { serverId: t.serverId, day, bytesOut: t.out, bytesIn: t.in, requests: t.requests, errors: t.errors };
    t.out = t.in = t.requests = t.errors = 0;
    try {
      this.opts.db
        .insert(relayTraffic)
        .values(row)
        .onConflictDoUpdate({
          target: [relayTraffic.serverId, relayTraffic.day],
          set: { bytesOut: sql`${relayTraffic.bytesOut} + ${row.bytesOut}`, bytesIn: sql`${relayTraffic.bytesIn} + ${row.bytesIn}`, requests: sql`${relayTraffic.requests} + ${row.requests}`, errors: sql`${relayTraffic.errors} + ${row.errors}` },
        })
        .run();
    } catch {
      /* the server was just removed */
    }
  }

  /** Right now: open tunnels, servers sending, and each tunnel's speed (bytes per second). */
  now(): { tunnels: number; active: number; bps: Map<string, number> } {
    return { tunnels: this.tunnels.size, active: this.shaper.active(), bps: new Map([...this.tunnels].map(([id, t]) => [id, t.bps])) };
  }

  /** The speed samples of the last five minutes (bytes per second per server), oldest first. */
  snapshots(): Array<Map<string, number>> {
    return [...this.recent];
  }

  url(slug: string): string {
    return `${this.opts.scheme}//${slug}.${this.opts.domain}${this.opts.port ? `:${this.opts.port}` : ''}`;
  }

  connected(serverId: string): boolean {
    return this.tunnels.has(serverId);
  }

  /** Since when a server's tunnel is open (null: not connected). */
  connectedSince(serverId: string): number | null {
    return this.tunnels.get(serverId)?.since ?? null;
  }

  /** The clients watching through a server right now (see CLIENT_WINDOW_MS). */
  clients(serverId: string): RelayClient[] {
    return this.tunnels.get(serverId)?.recentClients() ?? [];
  }

  /** Open tunnels right now. */
  count(): number {
    return this.tunnels.size;
  }

  /** The slug a request is for, if it is a relay address. */
  slugOf(req: IncomingMessage): string | null {
    const host = String(req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
    const suffix = `.${this.opts.domain}`;
    if (!host.endsWith(suffix)) return null;
    const slug = host.slice(0, -suffix.length);
    return /^[a-z0-9]{4,32}$/.test(slug) && !RESERVED.has(slug) ? slug : null;
  }

  handleRequest(req: IncomingMessage, res: ServerResponse, slug: string): void {
    const row = this.opts.db.select({ id: servers.id, enabled: servers.relayEnabled, accountId: servers.accountId }).from(servers).where(eq(servers.relaySlug, slug)).get();
    if (!row?.enabled || !this.opts.allowed(row.id, row.accountId)) {
      if (row) this.recordError(row.id);
      return unavailable(req, res, 'off');
    }
        const DIRECT_MEDIA_PATH = /^\/api\/(?:media\/\d+\/(?:stream|remux|hls\/(?:index\.m3u8|init\.mp4|seg\/\d+\.m4s)|subtitles\/\d+\.vtt)|(?:online-)?subtitles\/\d+\.vtt)$/;
        if ((req.method === 'GET' || req.method === 'HEAD') && DIRECT_MEDIA_PATH.test((req.url ?? '/').split('?', 1)[0]!)) {
          res.writeHead(409, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Vidalune-Direct-Playback': 'required' })
            .end(JSON.stringify({ error: 'Connect to the server direct address for media playback.', directPlayback: 'required' }));
          return;
        }
    const tunnel = this.tunnels.get(row.id);
    if (!tunnel) {
      this.recordError(row.id);
      return unavailable(req, res, 'offline');
    }
    // A person opening the relay address in a browser: the web interface is on app.vidalune.com, with
    // this server chosen. Apps and the web interface's own requests (the API) pass through.
    if (this.opts.appUrl && isNavigation(req)) {
      res.writeHead(302, { Location: `${this.opts.appUrl}/_vl/open?server=${encodeURIComponent(row!.id)}`, 'Cache-Control': 'no-store' }).end();
      return;
    }
    tunnel.forward(req, res, clientIp(req, this.opts.trustProxy));
  }

  /** A visitor of a server got an error before reaching it (relay off, server offline): counted per day. */
  recordError(serverId: string): void {
    const t = this.tunnels.get(serverId);
    if (t) {
      t.errors++;
      return;
    }
    const day = new Date(this.opts.now?.() ?? Date.now()).toISOString().slice(0, 10);
    try {
      this.opts.db
        .insert(relayTraffic)
        .values({ serverId, day, errors: 1 })
        .onConflictDoUpdate({ target: [relayTraffic.serverId, relayTraffic.day], set: { errors: sql`${relayTraffic.errors} + 1` } })
        .run();
    } catch {
      /* the server was just removed */
    }
  }

  /**
   * Passes a request for app.vidalune.com to the server its visitor chose (checked by the caller).
   * False: that server's tunnel is not open.
   */
  forwardTo(serverId: string, req: IncomingMessage, res: ServerResponse, rewrite: Rewrite): boolean {
    const tunnel = this.tunnels.get(serverId);
    if (!tunnel) return false;
    tunnel.forward(req, res, clientIp(req, this.opts.trustProxy), rewrite);
    return true;
  }

  /** A server opens its tunnel: wss://<domain>/api/server/tunnel with its secret. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const deny = (status: number) => {
      const reason = { 401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden' }[status] ?? 'Forbidden';
      socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    if (!req.url?.startsWith('/api/server/tunnel')) return deny(403);
    const m = /^Server ([\w-]{1,64}):([\w-]{20,200})$/.exec(req.headers.authorization ?? '');
    const row = m ? this.opts.db.select().from(servers).where(eq(servers.id, m[1])).get() : undefined;
    if (!row || !m || !crypto.timingSafeEqual(Buffer.from(row.secretHash), Buffer.from(sha256(m[2])))) return deny(401);
    // Linked servers keep a control tunnel for account-site browsing even on the free plan.
    // Public relay addresses are still gated in handleRequest; server-side remoteGate controls playback.
    if (!this.opts.controlAllowed(row.id, row.accountId)) return deny(403);
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      // One tunnel per server: a reconnect replaces the old one.
      this.tunnels.get(row.id)?.close();
      const tunnel = new Tunnel(
        row.id,
        ws,
        () => {
          this.write(tunnel);
          if (this.tunnels.get(row.id) === tunnel) {
            this.tunnels.delete(row.id);
            this.shaper.forget(row.id);
          }
        },
        this.shaper,
        this.capOf(row.id),
      );
      this.tunnels.set(row.id, tunnel);
    });
  }

  /** Closes a server's tunnel (relay turned off, server unlinked or removed). */
  drop(serverId: string): void {
    this.tunnels.get(serverId)?.close();
    this.tunnels.delete(serverId);
  }

  /** Closes the tunnels of servers whose owner no longer has remote access. */
  dropUnallowed(): void {
    for (const id of [...this.tunnels.keys()]) {
      const row = this.opts.db.select({ accountId: servers.accountId }).from(servers).where(eq(servers.id, id)).get();
      if (!row || !this.opts.controlAllowed(id, row.accountId)) this.drop(id);
    }
  }

  close(): void {
    clearInterval(this.sampler);
    this.flush();
    for (const t of this.tunnels.values()) t.close();
    this.tunnels.clear();
    this.wss.close();
  }
}
