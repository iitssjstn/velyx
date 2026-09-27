import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { z, ZodError } from 'zod';
import type { CloudConfig } from './config.js';
import type { DB } from './db/client.js';
import { accountSessions, accounts, linkCodes, servers } from './db/schema.js';
import { dummyVerify, hashPassword, newLinkCode, newToken, normalizeLinkCode, sha256, verifyPassword } from './crypto.js';

const DAY = 86_400_000;
export const SESSION_COOKIE = 'vl_session';
const SESSION_DAYS = 30;
/** The Vidalune app stays signed in longer than a browser. */
const APP_SESSION_DAYS = 180;
const CODE_MINUTES = 10;
/** A server that has not reported for this long is shown as offline. */
export const ONLINE_WINDOW = 2 * 60 * 60 * 1000;

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/** A few attempts per minute per address, for sign-up, sign-in, registering and codes. */
class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}
  check(key: string, now: number): void {
    const recent = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
    if (recent.length >= this.limit) throw new HttpError(429, 'Too many attempts. Wait a minute and try again.');
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.clear();
  }
}

const email = z.string().trim().toLowerCase().max(254).email('Enter a valid email address.');
const password = z.string().min(8, 'Passwords are at least 8 characters.').max(256);
const serverName = z.string().trim().min(1).max(60);
const version = z.string().trim().min(1).max(32);
/** Who signs in: a browser (cookie) or the Vidalune app (token). */
const client = z.enum(['web', 'app']).default('web');
/** The address a server can be opened at, if its administrator set one. */
const serverUrl = z
  .string()
  .trim()
  .max(300)
  .refine((u) => /^https?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(u), 'Not a web address.')
  .nullable()
  .optional();

export interface CloudAppOptions {
  now?: () => number;
}

export async function buildCloudApp(config: CloudConfig, db: DB, opts: CloudAppOptions = {}): Promise<FastifyInstance> {
  const now = opts.now ?? Date.now;
  const hops = config.trustProxy;
  const app = Fastify({ trustProxy: (_addr: string, hop: number) => hop < hops, bodyLimit: 64 * 1024, logger: false });
  const limiter = new RateLimiter(10, 60_000);
  const secureCookie = config.publicUrl.startsWith('https://');

  await app.register(fastifyCookie);
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:'], styleSrc: ["'self'"], scriptSrc: ["'self'"], connectSrc: ["'self'"] } },
  });

  // Browsers only: state-changing requests must come from our own pages (no form posts from elsewhere).
  app.addHook('onRequest', async (request) => {
    if (request.method === 'GET' || request.method === 'HEAD') return;
    // Servers and the app send a secret header: other sites cannot (no CORS), so nothing to check.
    if (request.headers.authorization) return;
    const origin = request.headers.origin;
    if (origin && origin !== config.publicUrl) throw new HttpError(403, 'Requests from other sites are not accepted.');
  });
  app.addHook('preHandler', async (request) => {
    if (request.body === undefined) return;
    if (!String(request.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: error.issues[0]?.message ?? 'Invalid input.' });
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.message });
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.code(status).send({ error: 'Invalid request.' });
    app.log.error(error);
    return reply.code(500).send({ error: 'Something went wrong.' });
  });

  // ---- accounts

  /** Browsers get a cookie; the Vidalune app (client "app") gets the token in the answer. */
  function startSession(reply: FastifyReply, accountId: number, client: 'web' | 'app' = 'web'): string | undefined {
    const token = newToken();
    const t = now();
    const days = client === 'app' ? APP_SESSION_DAYS : SESSION_DAYS;
    db.insert(accountSessions).values({ tokenHash: sha256(token), accountId, createdAt: t, expiresAt: t + days * DAY }).run();
    if (client === 'app') return token;
    reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: secureCookie, maxAge: days * 86_400 });
    return undefined;
  }

  /** The session token: the cookie of a browser, or "Authorization: Bearer …" from the app. */
  const sessionToken = (request: FastifyRequest) => {
    const bearer = /^Bearer ([\w-]{20,200})$/.exec(request.headers.authorization ?? '')?.[1];
    return bearer ?? request.cookies[SESSION_COOKIE];
  };

  function account(request: FastifyRequest) {
    const token = sessionToken(request);
    if (!token) throw new HttpError(401, 'Sign in first.');
    const session = db.select().from(accountSessions).where(and(eq(accountSessions.tokenHash, sha256(token)), gt(accountSessions.expiresAt, now()))).get();
    if (!session) throw new HttpError(401, 'Sign in first.');
    return db.select().from(accounts).where(eq(accounts.id, session.accountId)).get()!;
  }

  app.post('/api/account', async (request, reply) => {
    limiter.check(`signup:${request.ip}`, now());
    const body = z.object({ email, password, client }).parse(request.body);
    if (db.select().from(accounts).where(eq(accounts.email, body.email)).get()) throw new HttpError(409, 'There is already an account with this email address. Sign in instead.');
    const row = db.insert(accounts).values({ email: body.email, passwordHash: await hashPassword(body.password), createdAt: now() }).returning().get();
    const token = startSession(reply, row.id, body.client);
    return { email: row.email, ...(token ? { token } : {}) };
  });

  app.post('/api/login', async (request, reply) => {
    const body = z.object({ email, password: z.string().max(256), client }).parse(request.body);
    limiter.check(`login:${request.ip}`, now());
    limiter.check(`login:${body.email}`, now());
    const row = db.select().from(accounts).where(eq(accounts.email, body.email)).get();
    const ok = row ? await verifyPassword(row.passwordHash, body.password) : await dummyVerify(body.password);
    if (!row || !ok) throw new HttpError(401, 'Wrong email address or password.');
    const token = startSession(reply, row.id, body.client);
    return { email: row.email, ...(token ? { token } : {}) };
  });

  app.post('/api/logout', async (request, reply) => {
    const token = sessionToken(request);
    if (token) db.delete(accountSessions).where(eq(accountSessions.tokenHash, sha256(token))).run();
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/account', async (request) => ({ email: account(request).email }));

  /** Deleting an account signs out everywhere and unlinks its servers. */
  app.delete('/api/account', async (request, reply) => {
    const me = account(request);
    const body = z.object({ password: z.string().max(256) }).parse(request.body);
    if (!(await verifyPassword(me.passwordHash, body.password))) throw new HttpError(401, 'Wrong password.');
    db.delete(accounts).where(eq(accounts.id, me.id)).run();
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ---- servers, as seen by their owner

  const serverView = (s: typeof servers.$inferSelect) => ({
    id: s.id,
    name: s.name,
    version: s.version,
    url: s.url,
    lastSeenAt: s.lastSeenAt,
    online: s.lastSeenAt > now() - ONLINE_WINDOW,
  });

  app.get('/api/servers', async (request) => {
    const me = account(request);
    return db.select().from(servers).where(eq(servers.accountId, me.id)).all().map(serverView);
  });

  /** Entering the code a server shows links that server to this account. */
  app.post('/api/link', async (request) => {
    const me = account(request);
    limiter.check(`link:${me.id}`, now());
    const { code } = z.object({ code: z.string().max(20) }).parse(request.body);
    const normalized = normalizeLinkCode(code);
    const row = normalized ? db.select().from(linkCodes).where(and(eq(linkCodes.codeHash, sha256(normalized)), gt(linkCodes.expiresAt, now()))).get() : undefined;
    if (!row) throw new HttpError(400, 'This code is not valid (any more). Ask the server for a new one.');
    db.update(servers).set({ accountId: me.id }).where(eq(servers.id, row.serverId)).run();
    db.delete(linkCodes).where(eq(linkCodes.serverId, row.serverId)).run();
    return serverView(db.select().from(servers).where(eq(servers.id, row.serverId)).get()!);
  });

  app.delete('/api/servers/:id', async (request) => {
    const me = account(request);
    const { id } = z.object({ id: z.string().max(64) }).parse(request.params);
    const res = db.update(servers).set({ accountId: null }).where(and(eq(servers.id, id), eq(servers.accountId, me.id))).run();
    if (!res.changes) throw new HttpError(404, 'Not found.');
    return { ok: true };
  });

  // ---- the server side: a Vidalune server registers, asks for codes, and reports in

  function server(request: FastifyRequest) {
    const auth = request.headers.authorization ?? '';
    const m = /^Server ([\w-]{1,64}):([\w-]{20,200})$/.exec(auth);
    const row = m ? db.select().from(servers).where(eq(servers.id, m[1])).get() : undefined;
    if (!row || !m || !crypto.timingSafeEqual(Buffer.from(row.secretHash), Buffer.from(sha256(m[2])))) throw new HttpError(401, 'Unknown server.');
    return row;
  }

  const serverStatus = (s: typeof servers.$inferSelect) => {
    const owner = s.accountId ? db.select().from(accounts).where(eq(accounts.id, s.accountId)).get() : undefined;
    return { linked: !!owner, account: owner?.email ?? null };
  };

  app.post('/api/server/register', async (request) => {
    limiter.check(`register:${request.ip}`, now());
    const body = z.object({ name: serverName, version, url: serverUrl }).parse(request.body);
    const id = crypto.randomUUID();
    const secret = newToken();
    const t = now();
    db.insert(servers).values({ id, secretHash: sha256(secret), name: body.name, version: body.version, url: body.url ?? null, createdAt: t, lastSeenAt: t }).run();
    return { id, secret };
  });

  app.post('/api/server/code', async (request) => {
    const me = server(request);
    limiter.check(`code:${me.id}`, now());
    const code = newLinkCode();
    const expiresAt = now() + CODE_MINUTES * 60_000;
    db.insert(linkCodes).values({ codeHash: sha256(code), serverId: me.id, expiresAt }).onConflictDoUpdate({ target: linkCodes.serverId, set: { codeHash: sha256(code), expiresAt } }).run();
    return { code, expiresAt, linkUrl: `${config.publicUrl}/link` };
  });

  /** A server reports its name, version and address; the answer says whether it is linked, and to whom. */
  app.post('/api/server/heartbeat', async (request) => {
    const me = server(request);
    const body = z.object({ name: serverName, version, url: serverUrl }).parse(request.body);
    db.update(servers).set({ name: body.name, version: body.version, url: body.url ?? null, lastSeenAt: now() }).where(eq(servers.id, me.id)).run();
    return serverStatus({ ...me, accountId: me.accountId });
  });

  /** The server's administrator stops using the account service: everything about it is removed. */
  app.delete('/api/server', async (request) => {
    const me = server(request);
    db.delete(servers).where(eq(servers.id, me.id)).run();
    return { ok: true };
  });

  // ---- housekeeping and pages

  app.get('/health', async () => ({ status: 'ok' }));

  const prune = () => {
    const t = now();
    db.delete(accountSessions).where(lt(accountSessions.expiresAt, t)).run();
    db.delete(linkCodes).where(lt(linkCodes.expiresAt, t)).run();
    // Registered but never linked, and silent for 30 days: forgotten.
    db.delete(servers)
      .where(and(isNull(servers.accountId), lt(servers.lastSeenAt, t - 30 * DAY)))
      .run();
  };
  app.decorate('prune', prune);

  if (config.webDir && fs.existsSync(path.join(config.webDir, 'index.html'))) {
    const webDir = config.webDir;
    await app.register(fastifyStatic, { root: webDir, prefix: '/', index: false, wildcard: false });
    const page = (_req: FastifyRequest, reply: FastifyReply) => reply.type('text/html').header('Cache-Control', 'no-cache').send(fs.readFileSync(path.join(webDir, 'index.html')));
    app.get('/', page);
    app.get('/link', page);
    app.get('/servers', page);
  }
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Not found.' }));

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    prune: () => void;
  }
}
