import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { and, desc, eq, gt, isNotNull, isNull, lt } from 'drizzle-orm';
import { z, ZodError } from 'zod';
import type { CloudConfig } from './config.js';
import type { DB } from './db/client.js';
import { accountActivity, accountSessions, accounts, invites, linkCodes, memberCodes, memberships, servers, tickets } from './db/schema.js';
import { dummyVerify, hashPassword, newLinkCode, newToken, normalizeLinkCode, sha256, verifyPassword } from './crypto.js';
import { isRelayedMediaBytes, newSlug, rejectRelayedMedia, Relay, relayMessage, type Rewrite } from './relay.js';
import { composeFile, installPage, debInstallScript, installScript } from './install.js';
import { homePage, pickLanguage } from './site.js';
import { Community, communityRoutes } from './community.js';
import { detectionRoutes } from './detection.js';
import { SubtitleError, SubtitleProxy, subtitleRoutes } from './subtitles.js';
import { CeoError, ceoRoutes } from './ceo.js';
import { CloudflareDns, publicAddress } from './cloudflare-dns.js';
import { DirectCertificateIssuer } from './direct-certificate.js';

const DAY = 86_400_000;
export const SESSION_COOKIE = 'vl_session';
/** app.vidalune.com: the server this browser chose (its pages and API are passed through to it). */
export const SERVER_COOKIE = 'vl_server';
/** app.vidalune.com's own account pages live under this path; everything else is the chosen server. */
export const APP_PREFIX = '/_vl';
/** The web interface on app.vidalune.com gets the same policy as on a Vidalune server itself. */
const appCsp = (directDomain: string) => `default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: https://*.${directDomain}:*; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' https://www.gstatic.com; connect-src 'self' https://*.${directDomain}:*; object-src 'none'; frame-src https://www.youtube-nocookie.com; frame-ancestors 'self'; base-uri 'self'; form-action 'self'`;
const SESSION_DAYS = 30;
/** The Vidalune app stays signed in longer than a browser. */
const APP_SESSION_DAYS = 180;
const CODE_MINUTES = 10;
/** A ticket to open a server is used within a minute (the browser goes there right away). */
const TICKET_MS = 60_000;
/** A server's own id for one of its users. */
const userRef = z.string().trim().min(1).max(64);
/** A server's own id for an invitation; accepted, it stands in for the user until the server makes one. */
const inviteRef = z.string().regex(/^[\w-]{6,40}$/);
/** How long an invitation can be accepted. */
const INVITE_MS = 7 * DAY;
/** The member placeholder for an accepted invitation. */
const invitedRef = (ref: string) => `invite:${ref}`;
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
/** This service is built with every Vidalune release, so its version is the latest one. */
const releaseVersion = String((JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')) as { version: string }).version);
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
  /** Outgoing requests (health checks of other relays); tests pass their own. */
  fetchImpl?: typeof fetch;
  /** Tests can replace ACME calls without contacting a certificate authority. */
  directCertificateIssuer?: Pick<DirectCertificateIssuer, 'issue'>;
}

export async function buildCloudApp(config: CloudConfig, db: DB, opts: CloudAppOptions = {}): Promise<FastifyInstance> {
  const now = opts.now ?? Date.now;
  const directDns = config.cloudflareApiToken
    ? new CloudflareDns({ token: config.cloudflareApiToken, zoneName: config.cloudflareZoneName, fetchImpl: opts.fetchImpl })
    : null;
  const directHostname = (serverId: string) => `${serverId}.${config.directDomain}`;
  const directCertificates = opts.directCertificateIssuer ?? (directDns
    ? new DirectCertificateIssuer({
        dataDir: config.dataDir,
        directDomain: config.directDomain,
        directoryUrl: config.directAcmeDirectoryUrl,
        email: config.directAcmeEmail || undefined,
        dns: directDns,
      })
    : null);
  const hops = config.trustProxy;
  const publicUrl = new URL(config.publicUrl);
  /** The service's own addresses: vidalune.com, and app.vidalune.com / www.vidalune.com that serve the same pages. */
  const ownOrigins = new Set([config.publicUrl, ...['app', 'www'].map((n) => `${publicUrl.protocol}//${n}.${config.relayDomain}${publicUrl.port ? `:${publicUrl.port}` : ''}`)]);
  const admins = new Set(config.adminEmails);
  const isAdmin = (a: { email: string }) => admins.has(a.email);
  const ceos = new Set(config.ceoEmails);
  /** The Control Center (/admin): CEO_EMAILS, and the administrators of ADMIN_EMAILS. */
  const isCeo = (a: { email: string }) => ceos.has(a.email) || admins.has(a.email);
  /** Whether an account's servers may be reached through Vidalune: an active plan (administrators always). */
  const hasRemote = (a: typeof accounts.$inferSelect | undefined): boolean => !!a && a.suspendedAt === null && (isAdmin(a) || (a.plan === 'remote' && (a.planUntil === null || a.planUntil > now())));
  const ownerHasRemote = (accountId: number | null): boolean => accountId !== null && hasRemote(db.select().from(accounts).where(eq(accounts.id, accountId)).get());
  /** Remote access for this account itself: its own plan for its servers, or a viewer plan. */
  const hasPersonal = (a: typeof accounts.$inferSelect | undefined): boolean =>
    !!a && a.suspendedAt === null && (hasRemote(a) || (a.plan === 'viewer' && (a.planUntil === null || a.planUntil > now())));
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
  const controlAllowed = (_serverId: string, accountId: number | null): boolean => accountId !== null && db.select({ suspendedAt: accounts.suspendedAt }).from(accounts).where(eq(accounts.id, accountId)).get()?.suspendedAt === null;
  const relay = new Relay({ db, domain: config.relayDomain, scheme: publicUrl.protocol, port: publicUrl.port, trustProxy: hops, allowed: relayUsable, controlAllowed, appUrl: config.frontendDir ? `${publicUrl.protocol}//app.${config.relayDomain}${publicUrl.port ? `:${publicUrl.port}` : ''}` : null, maxMbps: config.relayMaxMbps, limitMbps: (id) => db.select({ limit: servers.relayLimitMbps }).from(servers).where(eq(servers.id, id)).get()?.limit ?? config.relayServerMbps, now });
  /** app.vidalune.com: the Vidalune web interface for whichever server its visitor chose. */
  const appHost = `app.${config.relayDomain}`;
  /** Where app.vidalune.com is (null: this service does not serve the web interface there). */
  const appOrigin = config.frontendDir ? `${publicUrl.protocol}//${appHost}${publicUrl.port ? `:${publicUrl.port}` : ''}` : null;
  /** discord.<domain>: the Vidalune community (see communityRoutes). */
  const community = new Community({ db, now });
  const isDiscordHost = (req: http.IncomingMessage) => String(req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '') === `discord.${config.relayDomain}`;
  const isAppHost = (req: http.IncomingMessage) => String(req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '') === appHost;
  const denyRobots = (res: http.ServerResponse) =>
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }).end('User-agent: *\nDisallow: /\n');
  const sitemapEntries = ['/', '/install'].flatMap((route) => {
    const localized = (lang: 'en' | 'nl') => {
      const url = new URL(route, config.publicUrl);
      url.searchParams.set('lang', lang);
      return url.toString();
    };
    const en = localized('en');
    const nl = localized('nl');
    return [{ loc: en, en, nl }, { loc: nl, en, nl }];
  });
  const escapeXml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${sitemapEntries
    .map(({ loc, en, nl }) => `  <url><loc>${escapeXml(loc)}</loc><xhtml:link rel="alternate" hreflang="en" href="${escapeXml(en)}"/><xhtml:link rel="alternate" hreflang="nl" href="${escapeXml(nl)}"/><xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(en)}"/></url>`)
    .join('\n')}\n</urlset>\n`;
  const app = Fastify({
    trustProxy: (_addr: string, hop: number) => hop < hops,
    bodyLimit: 64 * 1024,
    logger: false,
    // Requests for <slug>.<domain> go to the relay before anything else; the rest is this service.
    serverFactory: (handler) => {
      const server = http.createServer((req, res) => {
        if (isDiscordHost(req)) req.url = '/discord';
        const requestPath = (req.url ?? '/').split('?', 1)[0];
        if (requestPath === '/robots.txt' && isAppHost(req)) return denyRobots(res);
        if (requestPath === '/sitemap.xml' && isAppHost(req)) return res.writeHead(404, { 'X-Robots-Tag': 'noindex' }).end();
        const slug = relay.slugOf(req);
        if (slug) {
          if (requestPath === '/robots.txt') return denyRobots(res);
          return relay.handleRequest(req, res, slug);
        }
        if (isAppHost(req) && config.frontendDir) {
          const url = req.url ?? '/';
          if (isRelayedMediaBytes(req.method ?? '', url)) return rejectRelayedMedia(res, req.headers['accept-language']);
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
    const a = session ? db.select().from(accounts).where(eq(accounts.id, session.accountId)).get() : undefined;
    // A suspended account is signed out everywhere.
    return a && a.suspendedAt === null ? a : null;
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
    const server = accessible(me.id).find((s) => s.id === serverId && relay.connected(s.id)) ?? null;
    return { me, server };
  };

  /** Passes /api and /sso on app.vidalune.com to the chosen server, through its tunnel. */
  function proxyToChosen(req: http.IncomingMessage, res: http.ServerResponse) {
    const requestPath = (req.url ?? '/').split('?', 1)[0]!;
    if ((req.method === 'GET' || req.method === 'HEAD') && (
      /^\/api\/media\/\d+\/(?:stream|remux|hls\/(?:index\.m3u8|init\.mp4|seg\/\d+\.m4s)|subtitles\/\d+\.vtt)$/.test(requestPath) ||
      /^\/api\/(?:subtitles|online-subtitles)\/\d+\.vtt$/.test(requestPath)
    )) {
      res.writeHead(409, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Vidalune-Direct-Playback': 'required' })
        .end(JSON.stringify({ error: 'Connect to the server direct address for media playback.', directPlayback: 'required' }));
      return;
    }
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
      relay.recordError(server.id);
      res.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Vidalune-Relay': 'offline' }).end(JSON.stringify({ error: relayMessage('offline', req.headers['accept-language']), relay: 'offline' }));
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
    if (error instanceof HttpError || error instanceof CeoError || error instanceof SubtitleError) return reply.code(error.statusCode).send({ error: error.message });
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
    // Signing up or in counts as using Vidalune that day (the CEO panel's "active").
    db.insert(accountActivity).values({ accountId, day: new Date(t).toISOString().slice(0, 10) }).onConflictDoNothing().run();
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

  /** Days an account was seen (at most one write per account and day): "active" for the CEO panel. */
  const seen = new Map<number, string>();
  function account(request: FastifyRequest) {
    const me = accountByToken(sessionToken(request));
    if (!me) throw new HttpError(401, 'Sign in first.');
    const day = new Date(now()).toISOString().slice(0, 10);
    if (seen.get(me.id) !== day) {
      seen.set(me.id, day);
      if (seen.size > 100_000) seen.clear();
      db.insert(accountActivity).values({ accountId: me.id, day }).onConflictDoNothing().run();
    }
    return me;
  }

  app.post('/api/account', async (request, reply) => {
    limiter.check(`signup:${request.ip}`, now());
    const body = z.object({ email, password, client }).parse(request.body);
    const existing = db.select().from(accounts).where(eq(accounts.email, body.email)).get();
    // Added by the CEO (no password yet): signing up with that address takes it over, with its access.
    if (existing && (existing.passwordHash !== '' || existing.suspendedAt !== null)) throw new HttpError(409, 'There is already an account with this email address. Sign in instead.');
    const row = existing
      ? db.update(accounts).set({ passwordHash: await hashPassword(body.password) }).where(eq(accounts.id, existing.id)).returning().get()
      : db.insert(accounts).values({ email: body.email, passwordHash: await hashPassword(body.password), createdAt: now() }).returning().get();
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
    if (row.suspendedAt !== null) throw new HttpError(403, 'This Vidalune account is suspended. Contact Vidalune.');
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
    // The CEO also sees which version of vidalune.com is running (shown in the Control Center).
    return { email: me.email, remote: planView(me), appUrl: appOrigin, ...(isAdmin(me) ? { admin: true } : {}), ...(isCeo(me) ? { ceo: true, version: releaseVersion } : {}) };
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
    if (!s || !relay.connected(s.id)) throw new HttpError(404, 'Not found.');
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
    directAccess: directAccessView(s),
    /** Its relay address while the relay is on (null: off). */
    relayUrl: relayUrl(s),
    /** The server's tunnel is open right now. */
    relayConnected: s.relayEnabled && relay.connected(s.id),
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
    return { ticket: newTicket(id, me.id), addresses: [s.directAccess.url, s.url, s.relayUrl].filter(Boolean) };
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
    if (!s || !relay.connected(s.id)) return reply.redirect(`${APP_PREFIX}/servers?choose${s ? `&offline=${encodeURIComponent(s.id)}` : ''}`);
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

  /** An invitation, before signing in: which server it is for (nothing else). */
  const openInvite = (token: string) => {
    const row = db.select().from(invites).where(and(eq(invites.tokenHash, sha256(token)), gt(invites.expiresAt, now()))).get();
    const s = row ? db.select().from(servers).where(eq(servers.id, row.serverId)).get() : undefined;
    if (!row || !s?.accountId) throw new HttpError(404, 'This invitation is not valid (any more). Ask for a new one.');
    return { row, server: s };
  };
  const inviteToken = z.object({ token: z.string().min(20).max(200) });

  app.post('/api/invite', async (request) => {
    limiter.check(`invite:${request.ip}`, now());
    const { server: s, row } = openInvite(inviteToken.parse(request.body).token);
    return { server: s.name, expiresAt: row.expiresAt };
  });

  /** Accepting an invitation (once): the server is in this account's list, and makes a user for it on first open. */
  app.post('/api/invite/accept', async (request) => {
    const me = account(request);
    limiter.check(`invite:${me.id}`, now());
    const { row, server: s } = openInvite(inviteToken.parse(request.body).token);
    if (accessible(me.id).some((x) => x.id === s.id)) throw new HttpError(409, `You already use ${s.name} with this account.`);
    db.insert(memberships).values({ serverId: s.id, userRef: invitedRef(row.ref), accountId: me.id, createdAt: now() }).onConflictDoNothing().run();
    db.delete(invites).where(eq(invites.tokenHash, row.tokenHash)).run();
    return serverView(s);
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

  // Shared detection: a few hundred calls an hour per server (a whole library the first time).
  const detectionLimiter = new RateLimiter(600, 3_600_000);
  detectionRoutes(app, { db, server, now, limit: (key) => detectionLimiter.check(key, now()) });

  // Online subtitles with the one OpenSubtitles key of vidalune.com. Per server: new downloads are
  // a small share of the daily allowance there; files kept here and searches only stop floods.
  const subtitleLimiters = { settings: new RateLimiter(10, 60_000), search: new RateLimiter(120, 3_600_000), download: new RateLimiter(40, 86_400_000), kept: new RateLimiter(300, 3_600_000) };
  communityRoutes(app, {
    community,
    ceo: (request) => {
      const me = account(request);
      if (!isCeo(me)) throw new HttpError(403, 'Only for the CEO of Vidalune.');
      return me;
    },
    limit: (key) => subtitleLimiters.settings.check(key, now()),
  });
  subtitleRoutes(app, {
    db,
    proxy: new SubtitleProxy({ db, fetchImpl: opts.fetchImpl ?? ((input, init) => fetch(input, init)), now, userAgent: 'Vidalune v1' }),
    ceo: (request) => {
      const me = account(request);
      if (!isCeo(me)) throw new HttpError(403, 'Only for the CEO of Vidalune.');
      return me;
    },
    server,
    limit: (key) => {
      const which = key.startsWith('subtitle-settings:') ? 'settings' : key.startsWith('subtitle-search:') ? 'search' : key.startsWith('subtitle-download:') ? 'download' : 'kept';
      subtitleLimiters[which].check(key, now());
    },
  });

  const directAccessView = (s: typeof servers.$inferSelect) => ({
    configured: !!directDns,
    hostname: directHostname(s.id),
    port: s.directPort,
    dnsReady: s.directDnsReady,
    tlsReady: s.directTlsReady,
    portOpen: s.directPortOpen,
    checkedAt: s.directPortCheckedAt,
    url: s.directDnsReady && s.directTlsReady && s.directPortOpen ? `https://${directHostname(s.id)}${s.directPort === 443 ? '' : `:${s.directPort}`}` : null,
  });

  const directAccessHeartbeat = (s: typeof servers.$inferSelect) => ({ ...directAccessView(s), publicIp: s.publicIp });

  const serverStatus = (s: typeof servers.$inferSelect) => {
    const owner = s.accountId ? db.select().from(accounts).where(eq(accounts.id, s.accountId)).get() : undefined;
    // allowed: the owner has remote access (everyone may watch away from home); usable: the relay may
    // connect (the owner, or someone using the server, has remote access); remoteUsers: the server's
    // users with remote access of their own.
    return {
      linked: !!owner,
      account: owner?.email ?? null,
      directAccess: directAccessHeartbeat(s),
      relay: { enabled: s.relayEnabled && !!owner, allowed: hasRemote(owner), usable: relayUsable(s.id, s.accountId), url: owner ? relayUrl(s) : null, connected: s.relayEnabled && relay.connected(s.id) },
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
    const body = z.object({ name: serverName, version, url: serverUrl, directPort: z.number().int().min(1).max(65535).default(32400), directTlsReady: z.boolean().default(false) }).parse(request.body);
    const publicIp = publicAddress(request.ip);
    const checkedAt = now();
    let dnsReady = false;
    if (directDns && me.accountId && publicIp) {
      try {
        await directDns.upsertAddress(directHostname(me.id), publicIp);
        dnsReady = true;
      } catch (err) {
        console.warn(`Direct DNS update failed for server ${me.id}: ${(err as Error).message}`);
      }
    } else if (directDns && !me.accountId) {
      try {
        await directDns.deleteAddress(directHostname(me.id));
      } catch (err) {
        console.warn(`Direct DNS cleanup failed for server ${me.id}: ${(err as Error).message}`);
      }
    }
    const directPort = body.directPort;
    const directTlsReady = body.directTlsReady;
    let directPortOpen = false;
    if (dnsReady && directTlsReady && config.cloudflareApiToken) {
      const portPart = directPort === 443 ? '' : `:${directPort}`;
      try {
        const probe = await (opts.fetchImpl ?? fetch)(`https://${directHostname(me.id)}${portPart}/api/server/direct/health`, {
          method: 'HEAD',
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        });
        directPortOpen = probe.status === 204;
      } catch {
        directPortOpen = false;
      }
    }
    db.update(servers)
      .set({ name: body.name, version: body.version, url: body.url ?? null, publicIp, directDnsReady: dnsReady, directDnsCheckedAt: checkedAt, directPort, directTlsReady, directPortOpen, directPortCheckedAt: checkedAt, lastSeenAt: checkedAt })
      .where(eq(servers.id, me.id))
      .run();
    return serverStatus(db.select().from(servers).where(eq(servers.id, me.id)).get()!);
  });

  app.post('/api/server/direct/certificate', async (request) => {
    const me = server(request);
    if (!me.accountId) throw new HttpError(409, 'Link this server to a Vidalune account first.');
    if (!directCertificates || !me.directDnsReady) throw new HttpError(503, 'Direct server DNS is not ready.');
    limiter.check(`direct-certificate:${me.id}`, now());
    const { csr } = z.object({ csr: z.string().min(1).max(30_000) }).parse(request.body);
    const hostname = directHostname(me.id);
    try {
      const certificate = await directCertificates.issue(hostname, csr);
      return { hostname, certificate };
    } catch (err) {
      console.warn(`Direct TLS certificate issuance failed for server ${me.id}: ${(err as Error).message}`);
      throw new HttpError(502, 'Could not issue the direct server certificate. Check DNS and try again later.');
    }
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

  /** An invitation link for someone to use this server (seven days, once). */
  app.post('/api/server/invites', async (request) => {
    const me = server(request);
    if (!me.accountId) throw new HttpError(409, 'Link this server to a Vidalune account first.');
    limiter.check(`invites:${me.id}`, now());
    const { ref } = z.object({ ref: inviteRef }).parse(request.body);
    const token = newToken();
    const t = now();
    db.delete(invites).where(lt(invites.expiresAt, t)).run();
    db.insert(invites).values({ tokenHash: sha256(token), serverId: me.id, ref, createdAt: t, expiresAt: t + INVITE_MS }).onConflictDoUpdate({ target: [invites.serverId, invites.ref], set: { tokenHash: sha256(token), createdAt: t, expiresAt: t + INVITE_MS } }).run();
    // The token rides along after "#": it is not sent to the service in the page request.
    return { url: `${config.publicUrl}/invite#${token}`, expiresAt: t + INVITE_MS };
  });

  /** Withdrawn: the link stops working, and whoever accepted it no longer has the server in their list. */
  app.delete('/api/server/invites/:ref', async (request) => {
    const me = server(request);
    const { ref } = z.object({ ref: inviteRef }).parse(request.params);
    db.delete(invites).where(and(eq(invites.serverId, me.id), eq(invites.ref, ref))).run();
    db.delete(memberships).where(and(eq(memberships.serverId, me.id), eq(memberships.userRef, invitedRef(ref)))).run();
    return { ok: true };
  });

  /** The server made a user for an accepted invitation: that account signs in as this user from now on. */
  app.post('/api/server/invites/:ref/user', async (request) => {
    const me = server(request);
    const { ref } = z.object({ ref: inviteRef }).parse(request.params);
    const { userRef: to } = z.object({ userRef }).parse(request.body);
    const row = db.select().from(memberships).where(and(eq(memberships.serverId, me.id), eq(memberships.userRef, invitedRef(ref)))).get();
    if (!row) throw new HttpError(404, 'Not found.');
    db.delete(memberships).where(and(eq(memberships.serverId, me.id), eq(memberships.userRef, to))).run();
    db.update(memberships).set({ userRef: to }).where(and(eq(memberships.serverId, me.id), eq(memberships.userRef, invitedRef(ref)))).run();
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
    // The server's owner (the account it is linked to) is known without a user of their own yet:
    // the server then signs them in as its administrator and connects them (see owner-member).
    return { email: who?.email ?? null, userRef: member?.userRef ?? null, owner: me.accountId !== null && row.accountId === me.accountId };
  });

  /**
   * The server connects its owner's Vidalune account to a user there (its administrator), so the
   * owner signs in with that account alone. Only ever for the account the server is linked to.
   */
  app.post('/api/server/owner-member', async (request) => {
    const me = server(request);
    if (!me.accountId) throw new HttpError(409, 'Link this server to a Vidalune account first.');
    const body = z.object({ userRef }).parse(request.body);
    db.delete(memberships).where(and(eq(memberships.serverId, me.id), eq(memberships.accountId, me.accountId))).run();
    db.insert(memberships).values({ serverId: me.id, userRef: body.userRef, accountId: me.accountId, createdAt: now() }).onConflictDoUpdate({ target: [memberships.serverId, memberships.userRef], set: { accountId: me.accountId, createdAt: now() } }).run();
    return { email: db.select().from(accounts).where(eq(accounts.id, me.accountId)).get()?.email ?? null };
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

  // ---- the CEO panel (/ceo): customers, access, relays and figures over time
  const ceo = ceoRoutes(app, {
    db,
    account,
    isCeo,
    now,
    mainCapacityMbps: config.relayMaxMbps,
    defaultServerMbps: config.relayServerMbps,
    relay,
    accessChanged: () => relay.dropUnallowed(),
    signOut: (accountId) => void db.delete(accountSessions).where(eq(accountSessions.accountId, accountId)).run(),
    fetchImpl: opts.fetchImpl,
  });
  app.decorate('ceoMonitor', ceo.monitor);

  // ---- installing Vidalune: the page, a compose file, the installer, the app and the latest version

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

  const DEB = /^vidalune_(\d+\.\d+\.\d+)_(amd64|arm64)\.deb$/;
  /** The newest Debian/Ubuntu package present for an architecture (null: none in this image). */
  const latestDeb = (arch: 'amd64' | 'arm64') => {
    let files: string[];
    try {
      files = fs.readdirSync(config.downloadDir).filter((f) => DEB.exec(f)?.[2] === arch);
    } catch {
      return null;
    }
    const v = (f: string) => DEB.exec(f)![1].split('.').map(Number);
    return files.sort((a, b) => {
      const [x, y] = [v(a), v(b)];
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    }).at(-1) ?? null;
  };

  app.get('/api/releases/latest', async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=3600');
    return { version: releaseVersion, url: `${config.publicUrl}/install`, app: latestApk() ? `${config.publicUrl}/download/app` : null };
  });

  app.get('/robots.txt', async (request, reply) => {
    if (isAppHost(request.raw)) return reply.type('text/plain; charset=utf-8').send('User-agent: *\nDisallow: /\n');
    return reply
      .type('text/plain; charset=utf-8')
      .header('Cache-Control', 'public, max-age=3600')
      .send(`User-agent: *\nDisallow: /api/\nDisallow: /apt/\nDisallow: /download/\nDisallow: /get\nDisallow: /get-deb\n\nSitemap: ${config.publicUrl}/sitemap.xml\n`);
  });
  app.get('/sitemap.xml', async (request, reply) => {
    if (isAppHost(request.raw)) return reply.code(404).header('X-Robots-Tag', 'noindex').send();
    return reply.type('application/xml; charset=utf-8').header('Cache-Control', 'public, max-age=3600').send(sitemap);
  });

  app.get('/install', async (request, reply) =>
    reply.type('text/html').header('Cache-Control', 'no-cache').send(installPage(pickLanguage(request.query, request.headers['accept-language']), config.publicUrl, releaseVersion, !!latestApk(), !!accountByToken(request.cookies[SESSION_COOKIE]), !!latestDeb('amd64'), !!community.discord())),
  );
  app.get('/install/docker-compose.yml', async (_request, reply) =>
    reply.type('text/yaml; charset=utf-8').header('Content-Disposition', 'attachment; filename="docker-compose.yml"').send(composeFile()),
  );
  app.get('/get', async (_request, reply) => reply.type('text/plain; charset=utf-8').header('Cache-Control', 'no-cache').send(installScript(config.publicUrl)));
  app.get('/get-deb', async (_request, reply) => reply.type('text/plain; charset=utf-8').header('Cache-Control', 'no-cache').send(debInstallScript(config.publicUrl)));

  /** The newest Android app. */
  app.get('/download/app', async (_request, reply) => {
    const file = latestApk();
    if (!file) throw new HttpError(404, 'The Android app is not available for download right now.');
    return reply.header('Cache-Control', 'no-cache').redirect(`/download/${file}`);
  });
  /** The signed apt repository Debian/Ubuntu installations update from (built into the image with the packages). */
  const APT_INDEX: Record<string, string> = {
    Packages: 'text/plain; charset=utf-8',
    'Packages.gz': 'application/gzip',
    Release: 'text/plain; charset=utf-8',
    InRelease: 'text/plain; charset=utf-8',
    'Release.gpg': 'application/pgp-signature',
    'vidalune.gpg': 'application/pgp-keys',
    'vidalune.asc': 'application/pgp-keys',
  };
  app.get<{ Params: { '*': string } }>('/apt/*', async (request, reply) => {
    const match = /^(?:\.\/)?([^/]+)$/.exec(request.params['*']);
    const { file } = z.object({ file: z.string().refine((f) => Object.hasOwn(APT_INDEX, f) || DEB.test(f)) }).parse({ file: match?.[1] });
    const full = path.join(config.downloadDir, 'apt', file);
    if (!fs.existsSync(full)) throw new HttpError(404, 'Not found.');
    const deb = DEB.test(file);
    return reply
      .type(deb ? 'application/vnd.debian.binary-package' : APT_INDEX[file])
      .header('Content-Length', String(fs.statSync(full).size))
      .header('Cache-Control', deb ? 'public, max-age=86400' : 'no-cache')
      .send(fs.createReadStream(full));
  });

  /** The newest Debian/Ubuntu package for amd64 or arm64. */
  app.get('/download/deb/:arch', async (request, reply) => {
    const { arch } = z.object({ arch: z.enum(['amd64', 'arm64']) }).parse(request.params);
    const file = latestDeb(arch);
    if (!file) throw new HttpError(404, 'The package is not available for download right now.');
    return reply.header('Cache-Control', 'no-cache').redirect(`/download/${file}`);
  });
  app.get('/download/:file', async (request, reply) => {
    const { file } = z.object({ file: z.string().refine((f) => APK.test(f) || DEB.test(f)) }).parse(request.params);
    const full = path.join(config.downloadDir, file);
    if (!fs.existsSync(full)) throw new HttpError(404, 'Not found.');
    return reply
      .type(DEB.test(file) ? 'application/vnd.debian.binary-package' : 'application/vnd.android.package-archive')
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
      return reply.type('text/html').header('Cache-Control', 'no-cache').send(homePage(lang, !!accountByToken(request.cookies[SESSION_COOKIE]), !!community.discord(), config.publicUrl, releaseVersion));
    });
    app.get('/account', page);
    app.get('/link', page);
    app.get('/servers', page);
    app.get('/join', page);
    app.get('/invite', page);
    // The Control Center: the page for everyone, its data only for the CEO and administrators
    // (checked by /api/ceo on every call). /ceo was its address before.
    app.get('/admin', (_req, reply) => reply.type('text/html').header('Cache-Control', 'no-cache').send(fs.readFileSync(path.join(webDir, 'ceo.html'))));
    app.get('/ceo', (_req, reply) => reply.redirect('/admin'));
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
        reply.header('Content-Security-Policy', appCsp(config.directDomain));
      },
    });
  }
  /** A page of the web interface: the app itself, once there is a server to show; else choose one. */
  const appPage = (request: FastifyRequest, reply: FastifyReply) => {
    const { server } = chosenServer(request.cookies[SESSION_COOKIE], request.cookies[SERVER_COOKIE]);
    if (!server) return reply.redirect(`${APP_PREFIX}/servers`);
    return reply.type('text/html').header('Cache-Control', 'no-cache').header('Content-Security-Policy', appCsp(config.directDomain)).send(fs.readFileSync(path.join(frontendDir!, 'index.html')));
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
    /** Checks the relays and writes down their state (every five minutes). */
    ceoMonitor: () => Promise<void>;
  }
}
