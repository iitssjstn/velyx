import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { and, desc, eq, gt, isNotNull, isNull, lt } from 'drizzle-orm';
import { z, ZodError } from 'zod';
import type { CloudConfig } from './config.js';
import type { DB } from './db/client.js';
import { accountSessions, accounts, linkCodes, memberCodes, memberships, servers, tickets } from './db/schema.js';
import { dummyVerify, hashPassword, newLinkCode, newToken, normalizeLinkCode, sha256, verifyPassword } from './crypto.js';
import { newSlug, Relay, type Rewrite } from './relay.js';
import { composeFile, installPage, installScript } from './install.js';
import { homePage, pickLanguage } from './site.js';

const DAY = 86_400_000;
export const SESSION_COOKIE = 'vl_session';
/** app.vidalune.com: the server this browser chose (its pages and API are passed through to it). */
export const SERVER_COOKIE = 'vl_server';
/** app.vidalune.com's own account pages live under this path; everything else is the chosen server. */
export const APP_PREFIX = '/_vl';
/** The web interface on app.vidalune.com gets the same policy as on a Vidalune server itself. */
const APP_CSP = "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'";
const SESSION_DAYS = 30;
/** The Vidalune app stays signed in longer than a browser. */
const APP_SESSION_DAYS = 180;
const CODE_MINUTES = 10;
/** A ticket to open a server is used within a minute (the browser goes there right away). */
const TICKET_MS = 60_000;
/** A server's own id for one of its users. */
const userRef = z.string().trim().min(1).max(64);
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
  const publicUrl = new URL(config.publicUrl);
  /** The service's own addresses: vidalune.com, and app.vidalune.com / www.vidalune.com that serve the same pages. */
  const ownOrigins = new Set([config.publicUrl, ...['app', 'www'].map((n) => `${publicUrl.protocol}//${n}.${config.relayDomain}${publicUrl.port ? `:${publicUrl.port}` : ''}`)]);
  const admins = new Set(config.adminEmails);
  const isAdmin = (a: { email: string }) => admins.has(a.email);
  /** Whether an account's servers may be reached through Vidalune: an active plan (administrators always). */
  const hasRemote = (a: typeof accounts.$inferSelect | undefined): boolean => !!a && (isAdmin(a) || (a.plan === 'remote' && (a.planUntil === null || a.planUntil > now())));
  const ownerHasRemote = (accountId: number | null): boolean => accountId !== null && hasRemote(db.select().from(accounts).where(eq(accounts.id, accountId)).get());
  /** Remote access for this account itself: its own plan for its servers, or a viewer plan. */
  const hasPersonal = (a: typeof accounts.$inferSelect | undefined): boolean =>
    !!a && (hasRemote(a) || (a.plan === 'viewer' && (a.planUntil === null || a.planUntil > now())));
  /** The server's users whose own Vidalune account has remote access (their server user ids). */
  const remoteUsers = (serverId: string): string[] =>
    db
      .select({ userRef: memberships.userRef, account: accounts })
      .from(memberships)
      .innerJoin(accounts, eq(memberships.accountId, accounts.id))
      .where(eq(memberships.serverId, serverId))
      .all()
      .filter((m) => hasPersonal(m.account))
      .map((m) => m.userRef);
  /** A server may use the relay when its owner has remote access, or someone who uses it has it for themselves. */
  const relayUsable = (serverId: string, accountId: number | null): boolean => accountId !== null && (ownerHasRemote(accountId) || remoteUsers(serverId).length > 0);
  const relay = new Relay({ db, domain: config.relayDomain, scheme: publicUrl.protocol, port: publicUrl.port, trustProxy: hops, allowed: relayUsable, appUrl: config.frontendDir ? `${publicUrl.protocol}//app.${config.relayDomain}${publicUrl.port ? `:${publicUrl.port}` : ''}` : null });
  /** app.vidalune.com: the Vidalune web interface for whichever server its visitor chose. */
  const appHost = `app.${config.relayDomain}`;
  /** Where app.vidalune.com is (null: this service does not serve the web interface there). */
  const appOrigin = config.frontendDir ? `${publicUrl.protocol}//${appHost}${publicUrl.port ? `:${publicUrl.port}` : ''}` : null;
  const isAppHost = (req: http.IncomingMessage) => String(req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '') === appHost;
  const app = Fastify({
    trustProxy: (_addr: string, hop: number) => hop < hops,
    bodyLimit: 64 * 1024,
    logger: false,
    // Requests for <slug>.<domain> go to the relay before anything else; the rest is this service.
    serverFactory: (handler) => {
      const server = http.createServer((req, res) => {
        const slug = relay.slugOf(req);
        if (slug) return relay.handleRequest(req, res, slug);
        if (isAppHost(req) && config.frontendDir) {
          const url = req.url ?? '/';
          if (url === APP_PREFIX || url.startsWith(`${APP_PREFIX}?`)) {
            res.writeHead(302, { Location: `${APP_PREFIX}/${url.slice(APP_PREFIX.length)}` }).end();
            return;
          }
          // The account pages (sign in, choose a server) are this service itself…
          if (url.startsWith(`${APP_PREFIX}/`)) req.url = url.slice(APP_PREFIX.length);
          // …the chosen server's API goes through its tunnel…
          else if (/^\/(api\/|sso(\?|$))/.test(url)) return proxyToChosen(req, res);
          // …and the rest is the Vidalune web interface, from here (never a server's own files).
          else req.url = `/_app${url}`;
        }
        handler(req, res);
      });
      server.on('upgrade', (req, socket, head) => relay.handleUpgrade(req, socket, head));
      return server;
    },
  });
  app.decorate('relay', relay);

  /** The account signed in with a session token (null: none, or expired). */
  const accountByToken = (token: string | undefined) => {
    if (!token) return null;
    const session = db.select().from(accountSessions).where(and(eq(accountSessions.tokenHash, sha256(token)), gt(accountSessions.expiresAt, now()))).get();
    return session ? (db.select().from(accounts).where(eq(accounts.id, session.accountId)).get() ?? null) : null;
  };

  /** Cookies of a request not (yet) parsed by Fastify: those passed through app.vidalune.com. */
  const cookiesOf = (req: http.IncomingMessage): Array<[string, string]> =>
    String(req.headers.cookie ?? '')
      .split(';')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
        const i = c.indexOf('=');
        return i < 0 ? [c, ''] : [c.slice(0, i), c.slice(i + 1)];
      });

  /** Cookies a server sets on app.vidalune.com are kept apart per server under this prefix. */
  const cookiePrefix = (serverId: string) => `s${serverId.replace(/[^a-z0-9]/gi, '').slice(0, 12)}_`;

  /** app.vidalune.com: who is visiting, and the server they chose there, if they may open it through the relay. */
  const chosenServer = (token: string | undefined, serverId: string | undefined) => {
    const me = accountByToken(token);
    if (!me || !serverId) return { me, server: null };
    const server = accessible(me.id).find((s) => s.id === serverId && s.relayUrl) ?? null;
    return { me, server };
  };

  /** Passes /api and /sso on app.vidalune.com to the chosen server, through its tunnel. */
  function proxyToChosen(req: http.IncomingMessage, res: http.ServerResponse) {
    const cookies = cookiesOf(req);
    const get = (name: string) => cookies.find(([n]) => n === name)?.[1];
    const { me, server } = chosenServer(get(SESSION_COOKIE), get(SERVER_COOKIE));
    if (!server) {
      if ((req.url ?? '').startsWith('/sso')) {
        res.writeHead(302, { Location: `${APP_PREFIX}/servers${me ? '?choose' : ''}` }).end();
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ error: 'Choose a server on app.vidalune.com first.' }));
      }
      return;
    }
    const prefix = cookiePrefix(server.id);
    const rewrite: Rewrite = {
      // Only this server's own cookies, under their own names; never the account service's.
      request: (headers) => {
        const own = cookies.filter(([n]) => n.startsWith(prefix)).map(([n, v]) => `${n.slice(prefix.length)}=${v}`);
        if (own.length) headers.cookie = own.join('; ');
        else delete headers.cookie;
      },
      response: (headers) => {
        const set = headers['set-cookie'];
        if (set) {
          headers['set-cookie'] = (Array.isArray(set) ? set : [set]).map((c) =>
            `${prefix}${c.trim()}`
              .split(';')
              // Kept to app.vidalune.com itself; "Secure" only where visitors come over https.
              .filter((part) => !/^\s*domain=/i.test(part) && (secureCookie || !/^\s*secure\s*$/i.test(part)))
              .join(';'),
          );
        }
        // What a server answers is data for the web interface, never a page of its own here.
        headers['content-security-policy'] = "default-src 'none'; sandbox";
        headers['x-content-type-options'] = 'nosniff';
      },
    };
    if (!relay.forwardTo(server.id, req, res, rewrite)) {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ error: 'This Vidalune server cannot be reached through the relay right now. It may be off or offline.' }));
    }
  }
  app.addHook('onClose', async () => relay.close());
  const limiter = new RateLimiter(10, 60_000);
  const secureCookie = config.publicUrl.startsWith('https://');

  await app.register(fastifyCookie);
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:'], styleSrc: ["'self'"], scriptSrc: ["'self'"], connectSrc: ["'self'", 'https:', 'http:'], formAction: ["'self'"], frameAncestors: ["'none'"], upgradeInsecureRequests: secureCookie ? [] : null } },
  });

  // Browsers only: state-changing requests must come from our own pages (no form posts from elsewhere).
  app.addHook('onRequest', async (request) => {
    if (request.method === 'GET' || request.method === 'HEAD') return;
    // Servers and the app send a secret header: other sites cannot (no CORS), so nothing to check.
    if (request.headers.authorization) return;
    const origin = request.headers.origin;
    if (origin && !ownOrigins.has(origin)) throw new HttpError(403, 'Requests from other sites are not accepted.');
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
    const me = accountByToken(sessionToken(request));
    if (!me) throw new HttpError(401, 'Sign in first.');
    return me;
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

  const planView = (a: typeof accounts.$inferSelect) => ({
    active: hasPersonal(a),
    /** "remote": everyone on this account's servers; "viewer": this account only. */
    kind: hasRemote(a) ? ('remote' as const) : hasPersonal(a) ? ('viewer' as const) : null,
    until: isAdmin(a) ? null : a.planUntil,
  });

  app.get('/api/account', async (request) => {
    const me = account(request);
    return { email: me.email, remote: planView(me), appUrl: appOrigin, ...(isAdmin(me) ? { admin: true } : {}) };
  });

  /**
   * Opening a server from vidalune.com on app.vidalune.com: a one-time handoff (a minute, used once)
   * signs this browser in there too, and that server is chosen. The session cookie itself never
   * leaves vidalune.com, so relay addresses on *.vidalune.com never see it.
   */
  const handoffs = new Map<string, { accountId: number; serverId: string; expiresAt: number }>();
  app.post('/api/handoff', async (request) => {
    const me = account(request);
    if (!appOrigin) throw new HttpError(404, 'Not found.');
    const { server: id } = z.object({ server: z.string().max(64) }).parse(request.body);
    const s = accessible(me.id).find((x) => x.id === id);
    if (!s || !s.relayUrl) throw new HttpError(404, 'Not found.');
    const token = newToken();
    const t = now();
    for (const [k, v] of handoffs) if (v.expiresAt < t) handoffs.delete(k);
    handoffs.set(sha256(token), { accountId: me.id, serverId: s.id, expiresAt: t + TICKET_MS });
    return { url: `${appOrigin}${APP_PREFIX}/handoff?t=${encodeURIComponent(token)}` };
  });

  /** app.vidalune.com: a ticket for the server chosen there (to connect the user signed in there). */
  app.post('/api/app/ticket', async (request) => {
    if (!isAppHost(request.raw)) throw new HttpError(404, 'Not found.');
    const me = account(request);
    const s = accessible(me.id).find((x) => x.id === request.cookies[SERVER_COOKIE]);
    if (!s) throw new HttpError(404, 'Not found.');
    return { ticket: newTicket(s.id, me.id) };
  });

  app.get('/handoff', async (request, reply) => {
    if (!isAppHost(request.raw) || !appOrigin) throw new HttpError(404, 'Not found.');
    const { t: token } = z.object({ t: z.string().min(20).max(200) }).parse(request.query);
    const key = sha256(token);
    const h = handoffs.get(key);
    handoffs.delete(key);
    if (!h || h.expiresAt < now()) return reply.redirect(`${APP_PREFIX}/`);
    startSession(reply, h.accountId, 'web');
    return reply.redirect(`${APP_PREFIX}/open?server=${encodeURIComponent(h.serverId)}`);
  });

  /** Deleting an account signs out everywhere and unlinks its servers. */
  app.delete('/api/account', async (request, reply) => {
    const me = account(request);
    const body = z.object({ password: z.string().max(256) }).parse(request.body);
    if (!(await verifyPassword(me.passwordHash, body.password))) throw new HttpError(401, 'Wrong password.');
    for (const s of db.select({ id: servers.id }).from(servers).where(eq(servers.accountId, me.id)).all()) relay.drop(s.id);
    db.update(servers).set({ relayEnabled: false }).where(eq(servers.accountId, me.id)).run();
    db.delete(accounts).where(eq(accounts.id, me.id)).run();
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ---- servers, as seen by their owner

  /** A server's relay address while its relay is on and its owner has remote access (null: not reachable that way). */
  const relayUrl = (s: typeof servers.$inferSelect) => (s.relayEnabled && s.relaySlug && relayUsable(s.id, s.accountId) ? relay.url(s.relaySlug) : null);
  const serverView = (s: typeof servers.$inferSelect) => ({
    id: s.id,
    name: s.name,
    version: s.version,
    url: s.url,
    /** Its relay address while the relay is on (null: off). */
    relayUrl: relayUrl(s),
    /** The server's tunnel is open right now. */
    relayConnected: relay.connected(s.id),
    lastSeenAt: s.lastSeenAt,
    online: s.lastSeenAt > now() - ONLINE_WINDOW || relay.connected(s.id),
  });

  /** The servers this account owns, and the ones where one of its users is this account. */
  const accessible = (accountId: number) => {
    const owned = db.select().from(servers).where(eq(servers.accountId, accountId)).all();
    const memberOf = db
      .select({ server: servers })
      .from(memberships)
      .innerJoin(servers, eq(memberships.serverId, servers.id))
      .where(and(eq(memberships.accountId, accountId), isNotNull(servers.accountId)))
      .all()
      .map((r) => r.server)
      .filter((s) => !owned.some((o) => o.id === s.id));
    return [...owned.map((s) => ({ ...serverView(s), role: 'owner' as const })), ...memberOf.map((s) => ({ ...serverView(s), role: 'member' as const }))];
  };

  app.get('/api/servers', async (request) => accessible(account(request).id));

  /**
   * Opening a server: a one-time ticket the server exchanges (with its own secret) for who this is,
   * so the browser or app is signed in there without a password.
   */
  app.post('/api/servers/:id/open', async (request) => {
    const me = account(request);
    const { id } = z.object({ id: z.string().max(64) }).parse(request.params);
    const s = accessible(me.id).find((x) => x.id === id);
    if (!s) throw new HttpError(404, 'Not found.');
    return { ticket: newTicket(id, me.id), addresses: [s.url, s.relayUrl].filter(Boolean) };
  });

  function newTicket(serverId: string, accountId: number): string {
    const ticket = newToken();
    const t = now();
    db.delete(tickets).where(lt(tickets.expiresAt, t)).run();
    db.insert(tickets).values({ ticketHash: sha256(ticket), serverId, accountId, expiresAt: t + TICKET_MS }).run();
    return ticket;
  }

  /**
   * app.vidalune.com/_vl/open?server=…: this browser uses that server from now on (remembered), and
   * is signed in there with a ticket. Without a server: the one chosen before.
   */
  app.get('/open', async (request, reply) => {
    if (!isAppHost(request.raw) || !config.frontendDir) throw new HttpError(404, 'Not found.');
    const { server: wanted } = z.object({ server: z.string().max(64).optional() }).parse(request.query);
    const me = accountByToken(sessionToken(request));
    if (!me) return reply.redirect(`${APP_PREFIX}/`);
    const id = wanted ?? request.cookies[SERVER_COOKIE];
    const s = id ? accessible(me.id).find((x) => x.id === id) : undefined;
    // Not (any more) theirs, or not reachable through the relay: choose again.
    if (!s || !s.relayUrl || !relay.connected(s.id)) return reply.redirect(`${APP_PREFIX}/servers?choose${s ? `&offline=${encodeURIComponent(s.id)}` : ''}`);
    reply.setCookie(SERVER_COOKIE, s.id, { path: '/', httpOnly: true, sameSite: 'lax', secure: secureCookie, maxAge: 365 * 86_400 });
    return reply.header('Cache-Control', 'no-store').redirect(`/sso?ticket=${encodeURIComponent(newTicket(s.id, me.id))}`);
  });

  /** Someone who uses a server connects their Vidalune account with the code it showed them. */
  app.post('/api/join', async (request) => {
    const me = account(request);
    limiter.check(`join:${me.id}`, now());
    const { code } = z.object({ code: z.string().max(20) }).parse(request.body);
    const normalized = normalizeLinkCode(code);
    const row = normalized ? db.select().from(memberCodes).where(and(eq(memberCodes.codeHash, sha256(normalized)), gt(memberCodes.expiresAt, now()))).get() : undefined;
    if (!row) throw new HttpError(400, 'This code is not valid (any more). Ask the server for a new one.');
    db.insert(memberships).values({ serverId: row.serverId, userRef: row.userRef, accountId: me.id, createdAt: now() }).onConflictDoUpdate({ target: [memberships.serverId, memberships.userRef], set: { accountId: me.id, createdAt: now() } }).run();
    db.delete(memberCodes).where(eq(memberCodes.codeHash, row.codeHash)).run();
    return serverView(db.select().from(servers).where(eq(servers.id, row.serverId)).get()!);
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
    // The administrator who linked it signs in with this account from now on.
    if (row.userRef) db.insert(memberships).values({ serverId: row.serverId, userRef: row.userRef, accountId: me.id, createdAt: now() }).onConflictDoUpdate({ target: [memberships.serverId, memberships.userRef], set: { accountId: me.id } }).run();
    db.delete(linkCodes).where(eq(linkCodes.serverId, row.serverId)).run();
    return serverView(db.select().from(servers).where(eq(servers.id, row.serverId)).get()!);
  });

  app.delete('/api/servers/:id', async (request) => {
    const me = account(request);
    const { id } = z.object({ id: z.string().max(64) }).parse(request.params);
    const res = db.update(servers).set({ accountId: null, relayEnabled: false }).where(and(eq(servers.id, id), eq(servers.accountId, me.id))).run();
    if (res.changes) {
      relay.drop(id);
      return { ok: true };
    }
    // Not the owner: leave the server (its user no longer signs in with this account).
    const left = db.delete(memberships).where(and(eq(memberships.serverId, id), eq(memberships.accountId, me.id))).run();
    if (!left.changes) throw new HttpError(404, 'Not found.');
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
    // allowed: the owner has remote access (everyone may watch away from home); usable: the relay may
    // connect (the owner, or someone using the server, has remote access); remoteUsers: the server's
    // users with remote access of their own.
    return {
      linked: !!owner,
      account: owner?.email ?? null,
      relay: { enabled: s.relayEnabled && !!owner, allowed: hasRemote(owner), usable: relayUsable(s.id, s.accountId), url: owner ? relayUrl(s) : null, connected: relay.connected(s.id) },
      remoteUsers: owner ? remoteUsers(s.id) : [],
    };
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
    const { userRef: ref } = z.object({ userRef: userRef.optional() }).parse(request.body ?? {});
    const code = newLinkCode();
    const expiresAt = now() + CODE_MINUTES * 60_000;
    db.insert(linkCodes).values({ codeHash: sha256(code), serverId: me.id, userRef: ref ?? null, expiresAt }).onConflictDoUpdate({ target: linkCodes.serverId, set: { codeHash: sha256(code), userRef: ref ?? null, expiresAt } }).run();
    return { code, expiresAt, linkUrl: `${config.publicUrl}/link` };
  });

  /** A server reports its name, version and address; the answer says whether it is linked, and to whom. */
  app.post('/api/server/heartbeat', async (request) => {
    const me = server(request);
    const body = z.object({ name: serverName, version, url: serverUrl }).parse(request.body);
    db.update(servers).set({ name: body.name, version: body.version, url: body.url ?? null, lastSeenAt: now() }).where(eq(servers.id, me.id)).run();
    return serverStatus(me);
  });

  /** The server's administrator turns the relay on or off (only for a linked server). */
  app.post('/api/server/relay', async (request) => {
    const me = server(request);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
    if (enabled && !me.accountId) throw new HttpError(409, 'Link this server to a Vidalune account first.');
    if (enabled && !relayUsable(me.id, me.accountId)) throw new HttpError(402, 'Remote access through Vidalune needs a subscription.');
    let slug = me.relaySlug;
    if (enabled && !slug) {
      // A new, unused address (kept when the relay is turned off and on again).
      do slug = newSlug();
      while (db.select({ id: servers.id }).from(servers).where(eq(servers.relaySlug, slug)).get());
    }
    db.update(servers).set({ relayEnabled: enabled, relaySlug: slug }).where(eq(servers.id, me.id)).run();
    if (!enabled) relay.drop(me.id);
    return serverStatus(db.select().from(servers).where(eq(servers.id, me.id)).get()!).relay;
  });

  /** A code for one of the server's users to connect their own Vidalune account. */
  app.post('/api/server/member-code', async (request) => {
    const me = server(request);
    if (!me.accountId) throw new HttpError(409, 'Link this server to a Vidalune account first.');
    limiter.check(`member-code:${me.id}`, now());
    const { userRef: ref } = z.object({ userRef }).parse(request.body);
    const code = newLinkCode();
    const expiresAt = now() + CODE_MINUTES * 60_000;
    db.delete(memberCodes).where(and(eq(memberCodes.serverId, me.id), eq(memberCodes.userRef, ref))).run();
    db.insert(memberCodes).values({ codeHash: sha256(code), serverId: me.id, userRef: ref, expiresAt }).run();
    return { code, expiresAt, linkUrl: `${config.publicUrl}/join` };
  });

  /** Which of the server's users have connected a Vidalune account. */
  app.get('/api/server/members', async (request) => {
    const me = server(request);
    return db
      .select({ userRef: memberships.userRef, email: accounts.email })
      .from(memberships)
      .innerJoin(accounts, eq(memberships.accountId, accounts.id))
      .where(eq(memberships.serverId, me.id))
      .all();
  });

  app.delete('/api/server/members/:userRef', async (request) => {
    const me = server(request);
    const { userRef: ref } = z.object({ userRef }).parse(request.params);
    db.delete(memberships).where(and(eq(memberships.serverId, me.id), eq(memberships.userRef, ref))).run();
    return { ok: true };
  });

  /** The server exchanges a ticket (once) for who is opening it: the account and its user there. */
  app.post('/api/server/ticket', async (request) => {
    const me = server(request);
    const { ticket } = z.object({ ticket: z.string().min(20).max(200) }).parse(request.body);
    const row = db.select().from(tickets).where(and(eq(tickets.ticketHash, sha256(ticket)), eq(tickets.serverId, me.id))).get();
    if (row) db.delete(tickets).where(eq(tickets.ticketHash, row.ticketHash)).run();
    if (!row || row.expiresAt < now()) throw new HttpError(401, 'This sign-in link is not valid (any more).');
    const who = db.select().from(accounts).where(eq(accounts.id, row.accountId)).get();
    const member = db
      .select()
      .from(memberships)
      .where(and(eq(memberships.serverId, me.id), eq(memberships.accountId, row.accountId)))
      .orderBy(desc(memberships.createdAt))
      .get();
    return { email: who?.email ?? null, userRef: member?.userRef ?? null };
  });

  /**
   * After someone signed in on the server with a username and password (their Vidalune account did
   * not know that user yet), the server connects that user to the account the ticket was for: from
   * then on they sign in there with their Vidalune account alone.
   */
  app.post('/api/server/claim', async (request) => {
    const me = server(request);
    if (!me.accountId) throw new HttpError(409, 'Link this server to a Vidalune account first.');
    const body = z.object({ ticket: z.string().min(20).max(200), userRef }).parse(request.body);
    const row = db.select().from(tickets).where(and(eq(tickets.ticketHash, sha256(body.ticket)), eq(tickets.serverId, me.id))).get();
    if (row) db.delete(tickets).where(eq(tickets.ticketHash, row.ticketHash)).run();
    if (!row || row.expiresAt < now()) throw new HttpError(401, 'This sign-in link is not valid (any more).');
    // One Vidalune account per user here: the account moves to this user if it had another one.
    db.delete(memberships).where(and(eq(memberships.serverId, me.id), eq(memberships.accountId, row.accountId))).run();
    db.insert(memberships).values({ serverId: me.id, userRef: body.userRef, accountId: row.accountId, createdAt: now() }).onConflictDoUpdate({ target: [memberships.serverId, memberships.userRef], set: { accountId: row.accountId, createdAt: now() } }).run();
    return { email: db.select().from(accounts).where(eq(accounts.id, row.accountId)).get()?.email ?? null };
  });

  /** The server's administrator stops using the account service: everything about it is removed. */
  app.delete('/api/server', async (request) => {
    const me = server(request);
    relay.drop(me.id);
    db.delete(servers).where(eq(servers.id, me.id)).run();
    return { ok: true };
  });

  // ---- the admin page: who has remote access

  function admin(request: FastifyRequest) {
    const me = account(request);
    if (!isAdmin(me)) throw new HttpError(403, 'Only for Vidalune administrators.');
    return me;
  }

  const adminView = (a: typeof accounts.$inferSelect) => {
    const owned = db.select({ id: servers.id, name: servers.name, lastSeenAt: servers.lastSeenAt, relayEnabled: servers.relayEnabled }).from(servers).where(eq(servers.accountId, a.id)).all();
    return {
      id: a.id,
      email: a.email,
      createdAt: a.createdAt,
      admin: isAdmin(a),
      plan: a.plan,
      planUntil: a.planUntil,
      planNote: a.planNote,
      planChangedAt: a.planChangedAt,
      remote: hasPersonal(a),
      servers: owned.map((s) => ({ ...s, relayConnected: relay.connected(s.id) })),
    };
  };

  app.get('/api/admin/accounts', async (request) => {
    admin(request);
    const q = z.object({ q: z.string().trim().toLowerCase().max(254).default(''), filter: z.enum(['all', 'remote', 'servers']).default('all') }).parse(request.query);
    const all = db.select().from(accounts).orderBy(desc(accounts.createdAt)).all();
    const list = all
      .filter((a) => !q.q || a.email.includes(q.q))
      .map(adminView)
      .filter((a) => q.filter === 'all' || (q.filter === 'remote' ? a.remote : a.servers.length > 0));
    const linked = db.select({ id: servers.id }).from(servers).where(isNotNull(servers.accountId)).all().length;
    return {
      stats: { accounts: all.length, remote: all.filter(hasRemote).length, viewers: all.filter((a) => !hasRemote(a) && hasPersonal(a)).length, servers: linked, tunnels: relay.count() },
      accounts: list.slice(0, 200),
      more: list.length > 200,
    };
  });

  /** Gives or takes remote access: the plan, until when (null: no end) and a note. */
  app.put('/api/admin/accounts/:id/plan', async (request) => {
    admin(request);
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(request.params);
    const body = z
      .object({
        plan: z.enum(['free', 'remote', 'viewer']),
        until: z.number().int().positive().nullable().default(null),
        note: z.string().trim().max(200).nullable().default(null),
      })
      .parse(request.body);
    if (body.plan !== 'free' && body.until !== null && body.until <= now()) throw new HttpError(400, 'Choose an end date in the future.');
    const res = db
      .update(accounts)
      .set({ plan: body.plan, planUntil: body.plan !== 'free' ? body.until : null, planNote: body.note || null, planChangedAt: now() })
      .where(eq(accounts.id, id))
      .run();
    if (!res.changes) throw new HttpError(404, 'Not found.');
    const row = db.select().from(accounts).where(eq(accounts.id, id)).get()!;
    // Taken away: its servers' tunnels close now, not at the next check.
    relay.dropUnallowed();
    return adminView(row);
  });

  // ---- installing Vidalune: the page, a compose file, the installer, the app and the latest version

  /** This service is built with every Vidalune release, so its version is the latest one. */
  const releaseVersion = String((JSON.parse(fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'package.json'), 'utf8')) as { version: string }).version);
  const APK = /^vidalune-(\d+\.\d+\.\d+)\.apk$/;
  /** The newest Android app present (null: none in this image). */
  const latestApk = () => {
    let files: string[];
    try {
      files = fs.readdirSync(config.downloadDir).filter((f) => APK.test(f));
    } catch {
      return null;
    }
    const v = (f: string) => APK.exec(f)![1].split('.').map(Number);
    return files.sort((a, b) => {
      const [x, y] = [v(a), v(b)];
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    }).at(-1) ?? null;
  };

  app.get('/api/releases/latest', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=3600');
    return { version: releaseVersion, url: `${config.publicUrl}/install`, app: latestApk() ? `${config.publicUrl}/download/app` : null };
  });

  app.get('/install', async (request, reply) =>
    reply.type('text/html').header('Cache-Control', 'no-cache').send(installPage(pickLanguage(request.query, request.headers['accept-language']), config.publicUrl, releaseVersion, !!latestApk(), !!accountByToken(request.cookies[SESSION_COOKIE]))),
  );
  app.get('/install/docker-compose.yml', async (_request, reply) =>
    reply.type('text/yaml; charset=utf-8').header('Content-Disposition', 'attachment; filename="docker-compose.yml"').send(composeFile()),
  );
  app.get('/get', async (_request, reply) => reply.type('text/plain; charset=utf-8').header('Cache-Control', 'no-cache').send(installScript(config.publicUrl)));

  /** The newest Android app. */
  app.get('/download/app', async (_request, reply) => {
    const file = latestApk();
    if (!file) throw new HttpError(404, 'The Android app is not available for download right now.');
    return reply.header('Cache-Control', 'no-cache').redirect(`/download/${file}`);
  });
  app.get('/download/:file', async (request, reply) => {
    const { file } = z.object({ file: z.string().regex(APK) }).parse(request.params);
    const full = path.join(config.downloadDir, file);
    if (!fs.existsSync(full)) throw new HttpError(404, 'Not found.');
    return reply
      .type('application/vnd.android.package-archive')
      .header('Content-Disposition', `attachment; filename="${file}"`)
      .header('Content-Length', String(fs.statSync(full).size))
      .header('Cache-Control', 'public, max-age=86400')
      .send(fs.createReadStream(full));
  });

  // ---- housekeeping and pages

  app.get('/health', async () => ({ status: 'ok' }));

  const prune = () => {
    const t = now();
    db.delete(accountSessions).where(lt(accountSessions.expiresAt, t)).run();
    db.delete(linkCodes).where(lt(linkCodes.expiresAt, t)).run();
    db.delete(memberCodes).where(lt(memberCodes.expiresAt, t)).run();
    db.delete(tickets).where(lt(tickets.expiresAt, t)).run();
    // Plans that ended: those servers are no longer reachable through the relay.
    relay.dropUnallowed();
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
    // The website's home page; on app.vidalune.com (reached as /_vl/) the account pages.
    app.get('/', async (request, reply) => {
      if (isAppHost(request.raw)) return page(request, reply);
      const lang = pickLanguage(request.query, request.headers['accept-language']);
      return reply.type('text/html').header('Cache-Control', 'no-cache').send(homePage(lang, !!accountByToken(request.cookies[SESSION_COOKIE])));
    });
    app.get('/account', page);
    app.get('/link', page);
    app.get('/servers', page);
    app.get('/join', page);
    app.get('/admin', page);
  }
  const frontendDir = config.frontendDir;
  if (frontendDir) {
    // app.vidalune.com's web interface (requests there are rewritten to /_app/…; see serverFactory).
    await app.register(fastifyStatic, {
      root: frontendDir,
      prefix: '/_app/',
      index: false,
      wildcard: true,
      decorateReply: !config.webDir,
      preCompressed: true,
      allowedPath: (pathName, _root, request) => isAppHost(request.raw) && pathName !== '/index.html',
      setHeaders: (reply, file) => {
        reply.header('Cache-Control', /[/\\]assets[/\\]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache');
        reply.header('Content-Security-Policy', APP_CSP);
      },
    });
  }
  /** A page of the web interface: the app itself, once there is a server to show; else choose one. */
  const appPage = (request: FastifyRequest, reply: FastifyReply) => {
    const { server } = chosenServer(request.cookies[SESSION_COOKIE], request.cookies[SERVER_COOKIE]);
    if (!server) return reply.redirect(`${APP_PREFIX}/servers`);
    return reply.type('text/html').header('Cache-Control', 'no-cache').header('Content-Security-Policy', APP_CSP).send(fs.readFileSync(path.join(frontendDir!, 'index.html')));
  };
  if (frontendDir) {
    app.get('/_app/', async (request, reply) => {
      if (!isAppHost(request.raw)) throw new HttpError(404, 'Not found.');
      return appPage(request, reply);
    });
  }
  app.setNotFoundHandler((request, reply) => {
    if (frontendDir && request.method === 'GET' && request.url.startsWith('/_app/') && isAppHost(request.raw)) return appPage(request, reply);
    return reply.code(404).send({ error: 'Not found.' });
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    prune: () => void;
    relay: Relay;
  }
}
