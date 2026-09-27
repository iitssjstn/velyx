import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { eq } from 'drizzle-orm';
import { WebSocketServer, type WebSocket } from 'ws';
import type { DB } from './db/client.js';
import { servers } from './db/schema.js';
import { sha256 } from './crypto.js';
import { CHUNK, decodeFrame, encodeFrame, FRAME, HOP_BY_HOP, INITIAL_WINDOW, windowPayload } from './tunnel-protocol.js';

/** Subdomains that are never given to a server. */
export const RESERVED = new Set(['www', 'app', 'api', 'relay', 'admin', 'mail', 'status', 'docs', 'cloud', 'help', 'support', 'blog', 'account', 'login']);
const SLUG_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const newSlug = () => Array.from({ length: 8 }, () => SLUG_ALPHABET[crypto.randomInt(SLUG_ALPHABET.length)]).join('');

/** Requests a server may have open through the relay at once. */
const MAX_STREAMS = 64;
/** Largest request body passed on (servers take JSON and small uploads). */
const MAX_REQUEST_BODY = 8 * 1024 * 1024;
const PING_MS = 25_000;

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
}

class Tunnel {
  readonly streams = new Map<number, Stream>();
  private next = 1;
  private alive = true;
  private readonly ping: NodeJS.Timeout;

  constructor(
    readonly serverId: string,
    readonly ws: WebSocket,
    private readonly onClose: () => void,
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
    if (this.streams.size >= MAX_STREAMS) return unavailable(res, 503);
    const id = this.next;
    this.next = this.next >= 0xfffffff0 ? 1 : this.next + 1;
    const stream: Stream = { req, res, started: false, owed: 0, rewrite };
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
      if (size > MAX_REQUEST_BODY) {
        this.reset(id);
        return unavailable(res, 413);
      }
      for (let i = 0; i < chunk.length; i += CHUNK) this.send(FRAME.requestBody, id, chunk.subarray(i, i + CHUNK));
    });
    req.on('end', () => this.send(FRAME.requestEnd, id));
    // The visitor left (closed the tab, skipped ahead in a video): stop the server sending.
    res.on('close', () => {
      if (this.streams.delete(id) && !res.writableFinished) this.send(FRAME.reset, id);
    });
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
        const waiting = stream.owed > 0;
        stream.owed += frame.payload.length;
        if (waiting) {
          res.write(frame.payload);
        } else if (res.write(frame.payload)) {
          this.send(FRAME.window, frame.stream, windowPayload(stream.owed));
          stream.owed = 0;
        } else {
          res.once('drain', () => {
            this.send(FRAME.window, frame.stream, windowPayload(stream.owed));
            stream.owed = 0;
          });
        }
        break;
      }
      case FRAME.responseEnd:
        this.streams.delete(frame.stream);
        res.end();
        break;
      case FRAME.reset:
        this.streams.delete(frame.stream);
        if (!stream.started) unavailable(res, 502);
        else res.destroy();
        break;
    }
  }

  private closed() {
    clearInterval(this.ping);
    for (const { res, started } of this.streams.values()) {
      if (started) res.destroy();
      else unavailable(res, 502);
    }
    this.streams.clear();
    this.onClose();
  }

  close() {
    this.ws.close(1001, 'replaced');
  }
}

/** A short page for visitors when the relay cannot reach the server. */
function unavailable(res: ServerResponse, status: number): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const text =
    status === 413
      ? 'Too large to send through the Vidalune relay.'
      : 'This Vidalune server cannot be reached through the relay right now. It may be off or offline. / Deze Vidalune-server is nu niet bereikbaar via de relay. Misschien staat hij uit of is hij offline.';
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
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
      allowed: (accountId: number | null) => boolean;
    },
  ) {}

  url(slug: string): string {
    return `${this.opts.scheme}//${slug}.${this.opts.domain}${this.opts.port ? `:${this.opts.port}` : ''}`;
  }

  connected(serverId: string): boolean {
    return this.tunnels.has(serverId);
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
    const tunnel = row?.enabled && this.opts.allowed(row.accountId) ? this.tunnels.get(row.id) : undefined;
    if (!tunnel) return unavailable(res, 502);
    tunnel.forward(req, res, clientIp(req, this.opts.trustProxy));
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
    if (!row.relayEnabled || !row.accountId) return deny(403);
    // The owner has no remote access (any more): 402, so the server can say why.
    if (!this.opts.allowed(row.accountId)) return deny(402);
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      // One tunnel per server: a reconnect replaces the old one.
      this.tunnels.get(row.id)?.close();
      const tunnel = new Tunnel(row.id, ws, () => {
        if (this.tunnels.get(row.id) === tunnel) this.tunnels.delete(row.id);
      });
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
      const row = this.opts.db.select({ accountId: servers.accountId, enabled: servers.relayEnabled }).from(servers).where(eq(servers.id, id)).get();
      if (!row?.enabled || !this.opts.allowed(row.accountId)) this.drop(id);
    }
  }

  close(): void {
    for (const t of this.tunnels.values()) t.close();
    this.tunnels.clear();
    this.wss.close();
  }
}
