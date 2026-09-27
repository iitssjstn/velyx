import http from 'node:http';
import WebSocket from 'ws';
import { createLogger } from '../logger.js';
import { CHUNK, decodeFrame, encodeFrame, FRAME, HOP_BY_HOP } from './tunnel-protocol.js';

const log = createLogger('relay');

interface Local {
  req: http.ClientRequest;
  res: http.IncomingMessage | null;
  /** Response bytes the relay can still take. */
  credit: number;
}

/**
 * Why the tunnel is not open: the relay refused it, the account that owns this server has no remote
 * access (subscription), the relay could not be reached, or the tunnel closed.
 */
export type RelayProblem = 'refused' | 'subscription' | 'unreachable' | 'closed';

export interface RelayClientStatus {
  /** The tunnel to the relay is open. */
  connected: boolean;
  /** Why it is not (while it keeps trying). */
  error: RelayProblem | null;
}

/**
 * Keeps a tunnel open to the Vidalune relay and answers what comes through it by asking this
 * server itself, over the loopback address (so everything works as for any other visitor).
 * Reconnects with growing pauses while the relay is on.
 */
export class RelayClient {
  private ws: WebSocket | null = null;
  private readonly streams = new Map<number, Local>();
  private retry: NodeJS.Timeout | null = null;
  private delay = 1000;
  private wanted = false;
  private lastError: RelayProblem | null = null;
  private auth: string | null = null;

  constructor(
    private readonly opts: {
      /** https://vidalune.com: the tunnel is wss://vidalune.com/api/server/tunnel */
      cloudUrl: string;
      /** Where this server listens (the relay's requests go there). */
      localPort: number;
    },
  ) {}

  status(): RelayClientStatus {
    return { connected: this.ws?.readyState === WebSocket.OPEN, error: this.lastError };
  }

  /** Opens the tunnel (or keeps it open) with the server's credentials. */
  start(auth: string): void {
    this.wanted = true;
    if (this.auth === auth && this.ws) return;
    this.auth = auth;
    this.ws?.terminate();
    this.connect();
  }

  stop(): void {
    this.wanted = false;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.ws?.close();
    this.ws = null;
    this.resetAll();
    this.lastError = null;
  }

  private connect() {
    if (!this.wanted || !this.auth) return;
    const url = `${this.opts.cloudUrl.replace(/^http/, 'ws')}/api/server/tunnel`;
    const ws = new WebSocket(url, { headers: { Authorization: this.auth }, maxPayload: CHUNK + 1024, handshakeTimeout: 15_000 });
    this.ws = ws;
    ws.on('open', () => {
      this.delay = 1000;
      this.lastError = null;
      log.info('Relay tunnel open');
    });
    ws.on('message', (data: Buffer) => this.onFrame(data));
    ws.on('unexpected-response', (_req, res) => {
      this.lastError = res.statusCode === 402 ? 'subscription' : res.statusCode === 401 || res.statusCode === 403 ? 'refused' : 'unreachable';
      // No remote access: look again every minute (it may be given any moment).
      if (res.statusCode === 402) this.delay = 60_000;
      ws.terminate();
    });
    ws.on('error', (err) => {
      log.debug(`Relay tunnel: ${err.message}`);
      this.lastError ??= 'unreachable';
    });
    ws.on('close', () => {
      if (this.ws === ws) this.ws = null;
      this.resetAll();
      if (!this.wanted) return;
      this.lastError ??= 'closed';
      this.retry = setTimeout(() => this.connect(), this.delay);
      this.retry.unref();
      this.delay = Math.min(this.delay * 2, 60_000);
    });
  }

  private send(type: Parameters<typeof encodeFrame>[0], stream: number, payload?: Buffer | string) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encodeFrame(type, stream, payload));
  }

  private resetAll() {
    for (const s of this.streams.values()) s.req.destroy();
    this.streams.clear();
  }

  private finish(id: number, reset: boolean) {
    const s = this.streams.get(id);
    if (!s) return;
    this.streams.delete(id);
    if (reset) {
      s.req.destroy();
      s.res?.destroy();
    }
  }

  private onFrame(data: Buffer) {
    const frame = decodeFrame(data);
    if (!frame) return;
    const id = frame.stream;
    switch (frame.type) {
      case FRAME.request:
        return this.open(id, frame.payload);
      case FRAME.requestBody:
        this.streams.get(id)?.req.write(frame.payload);
        return;
      case FRAME.requestEnd:
        this.streams.get(id)?.req.end();
        return;
      case FRAME.window: {
        const s = this.streams.get(id);
        if (!s || frame.payload.length < 4) return;
        s.credit += frame.payload.readUInt32BE(0);
        if (s.credit > 0 && s.res?.isPaused()) s.res.resume();
        return;
      }
      case FRAME.reset:
        return this.finish(id, true);
    }
  }

  /** A visitor's request: asked of this server itself, marked with who really asked. */
  private open(id: number, payload: Buffer) {
    let head: { method: string; url: string; headers: Record<string, string | string[]>; ip: string; window: number };
    try {
      head = JSON.parse(payload.toString());
    } catch {
      return this.send(FRAME.reset, id);
    }
    const headers: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(head.headers ?? {})) if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v;
    // Trusted because the request comes from this machine's loopback address (see buildApp).
    headers['x-forwarded-for'] = head.ip || '0.0.0.0';
    headers['x-forwarded-proto'] = 'https';
    const req = http.request({ host: '127.0.0.1', port: this.opts.localPort, method: head.method, path: head.url, headers });
    const local: Local = { req, res: null, credit: head.window };
    this.streams.set(id, local);
    req.on('response', (res) => {
      local.res = res;
      const out: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(res.headers)) if (v !== undefined && !HOP_BY_HOP.has(k)) out[k] = v;
      this.send(FRAME.response, id, JSON.stringify({ status: res.statusCode ?? 502, headers: out }));
      res.on('data', (chunk: Buffer) => {
        for (let i = 0; i < chunk.length; i += CHUNK) this.send(FRAME.responseBody, id, chunk.subarray(i, i + CHUNK));
        local.credit -= chunk.length;
        // The visitor is behind: wait until the relay says it took what was sent.
        if (local.credit <= 0) res.pause();
      });
      res.on('end', () => {
        this.send(FRAME.responseEnd, id);
        this.finish(id, false);
      });
      res.on('error', () => {
        this.send(FRAME.reset, id);
        this.finish(id, false);
      });
    });
    req.on('error', (err) => {
      if (!this.streams.has(id)) return;
      log.warn(`Relayed request failed: ${err.message}`);
      this.send(FRAME.reset, id);
      this.finish(id, false);
    });
  }
}

/** Loopback addresses: requests from this machine itself (the relay client). */
export const isLoopback = (addr: string) => addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
