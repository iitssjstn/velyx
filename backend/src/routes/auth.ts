import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireUser } from '../app.js';
import { users } from '../db/schema.js';
import { SESSION_COOKIE, describeUserAgent, sessionCookieOptions } from '../auth/sessions.js';
import { ProgressiveLimiter } from '../auth/rate-limit.js';
import { PAIRING_POLL_SECONDS, PairingService } from '../services/pairing.js';

/** Version of the API the Vidalune app talks to. */
export const API_VERSION = 1;

/** Public session ids are 20 hex characters. */
export const sessionIdParam = z.string().regex(/^[0-9a-f]{20}$/, 'Invalid session id.');
import { dummyVerify, hashPassword, validatePassword, validateUsername, verifyPassword } from '../auth/password.js';
import { HttpError } from '../http-error.js';
import { createLogger } from '../logger.js';
import { APP_NAME, APP_TAGLINE, APP_VERSION } from '../version.js';
import { DEFAULT_LANGUAGE, isLanguage, languageSchema, requestLanguage, tr, type Language } from '../i18n/index.js';
import { redeemInvite } from './invites.js';

const log = createLogger('auth');

function waitMessage(ms: number, lang: Language): string {
  const s = Math.ceil(ms / 1000);
  return s < 90 ? tr(lang, '{n} seconds', { n: s }) : tr(lang, '{n} minutes', { n: Math.ceil(s / 60) });
}

export function publicUser(u: { id: number; username: string; displayName: string | null; role: 'admin' | 'user'; avatarFile: string | null; language: string }) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    language: isLanguage(u.language) ? u.language : DEFAULT_LANGUAGE,
    avatarUrl: u.avatarFile ? `/api/avatars/${u.id}?v=${encodeURIComponent(u.avatarFile)}` : null,
  };
}

export function adminCount(ctx: AppContext): number {
  return ctx.db
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.disabled, false)))
    .get()!.n;
}

/**
 * The account for a sign-in name. Names are matched without regard to case ("Justin" signs in as
 * "justin": phone keyboards often capitalise the first letter), unless two accounts differ only by case.
 */
export function findUserByName(ctx: AppContext, username: string) {
  const exact = ctx.db.select().from(users).where(eq(users.username, username)).get();
  if (exact) return exact;
  const matches = ctx.db.select().from(users).where(sql`lower(${users.username}) = lower(${username})`).limit(2).all();
  return matches.length === 1 ? matches[0] : undefined;
}

export function setupRequired(ctx: AppContext): boolean {
  return ctx.db.select({ n: count() }).from(users).where(eq(users.role, 'admin')).get()!.n === 0;
}

function setSessionCookie(ctx: AppContext, request: FastifyRequest, reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(ctx.config.cookieSecure, request.protocol, ctx.sessions.ttlMs));
}

const loginBody = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(256) });
/** The name the app gives its device ("Pixel 8"), shown in the session list. */
const deviceNameSchema = z.string().trim().min(1).max(64);
const setupBody = z.object({
  username: z.string().trim(),
  password: z.string(),
  serverName: z.string().trim().max(64).optional(),
  tmdbApiKey: z.string().trim().max(512).optional(),
  /** The browser's language, as the administrator's first interface language. */
  language: languageSchema.optional(),
});
const profileBody = z.object({ displayName: z.string().trim().max(64).nullable() });
const passwordBody = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string(),
  /** Sign out every other device (default: yes). */
  signOutOthers: z.boolean().default(true),
});
const avatarBody = z.object({ dataUrl: z.string().max(3 * 1024 * 1024) });
const language = z.string().trim().toLowerCase().regex(/^([a-z]{2,3})?$/, 'Use a language code like en or nl');
const subtitleStyleSchema = z.object({
  size: z.enum(['small', 'medium', 'large', 'xlarge']),
  color: z.enum(['white', 'yellow']),
  background: z.enum(['none', 'translucent', 'solid']),
  edge: z.enum(['shadow', 'outline', 'none']),
  position: z.number().int().min(0).max(20).multipleOf(5),
  castDefaults: z.boolean().default(false),
}).strict();
const preferencesBody = z.object({
  audioLanguage: language.optional(),
  subtitleLanguage: language.optional(),
  subtitleFallback: language.optional(),
  subtitleMode: z.enum(['remember', 'always', 'foreign', 'forced', 'off']).optional(),
  skipIntro: z.enum(['never', 'ask', 'always']).optional(),
  skipCredits: z.enum(['never', 'ask', 'always']).optional(),
  skipRecap: z.enum(['never', 'ask', 'always']).optional(),
  subtitleStyle: subtitleStyleSchema.nullable().optional(),
});

function accountSubtitleStyle(stored: string | null): z.infer<typeof subtitleStyleSchema> | null {
  if (stored === null) return null;
  try {
    const parsed = subtitleStyleSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function preferencesView(u: typeof users.$inferSelect) {
  return { audioLanguage: u.prefAudioLanguage, subtitleLanguage: u.prefSubtitleLanguage, subtitleFallback: u.prefSubtitleFallback, subtitleMode: u.prefSubtitleMode, skipIntro: u.prefSkipIntro, skipCredits: u.prefSkipCredits, skipRecap: u.prefSkipRecap, subtitleStyle: accountSubtitleStyle(u.prefSubtitleStyle) };
}

const AVATAR_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
};

export async function authRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const limiter = new ProgressiveLimiter();

  app.get('/health', async (_req, reply) => {
    try {
      ctx.db.$client.prepare('SELECT 1').get();
      return { status: 'ok', name: APP_NAME, version: APP_VERSION };
    } catch {
      return reply.code(503).send({ status: 'error' });
    }
  });

  app.get('/api/server/info', async () => ({
    name: ctx.settings.serverName(),
    product: APP_NAME,
    tagline: APP_TAGLINE,
    version: APP_VERSION,
    /** Raised when the API changes in a way the Vidalune app has to know about. */
    apiVersion: API_VERSION,
    setupRequired: setupRequired(ctx),
    /** Linked to a Vidalune account: where its users find all their servers. */
    vidalune: ctx.cloud.appUrl() ? { appUrl: ctx.cloud.appUrl() } : null,
  }));

  app.post('/api/setup', async (request, reply) => {
    if (!setupRequired(ctx)) throw new HttpError(409, 'Vidalune is already set up.');
    const body = setupBody.parse(request.body);
    const uErr = validateUsername(body.username);
    if (uErr) throw new HttpError(400, uErr);
    const pErr = validatePassword(body.password);
    if (pErr) throw new HttpError(400, pErr);
    if (body.tmdbApiKey) {
      let valid = true;
      try {
        valid = await ctx.tmdb.validateKey(body.tmdbApiKey);
      } catch (err) {
        log.warn('Could not verify TMDB key during setup (saved anyway)', err);
      }
      if (!valid) throw new HttpError(400, 'TMDB rejected this API key. Check it, or leave the field empty and add it later.');
    }
    const passwordHash = await hashPassword(body.password);
    // Re-check inside a transaction so two concurrent setup requests cannot both create an admin.
    const user = ctx.db.transaction((tx) => {
      const existing = tx.select({ n: count() }).from(users).where(eq(users.role, 'admin')).get()!.n;
      if (existing > 0) throw new HttpError(409, 'Vidalune is already set up.');
      return tx.insert(users).values({ username: body.username, passwordHash, role: 'admin', language: body.language ?? DEFAULT_LANGUAGE, lastLoginAt: Date.now() }).returning().get();
    });
    ctx.settings.update({
      serverName: body.serverName || 'Vidalune',
      ...(body.tmdbApiKey ? { tmdbApiKey: body.tmdbApiKey } : {}),
    });
    const { token } = ctx.sessions.create(user.id, request.headers['user-agent'], request.ip);
    setSessionCookie(ctx, request, reply, token);
    log.info(`Administrator "${user.username}" created during first-run setup`);
    ctx.audit.record('setup.completed', { actor: user, ip: request.ip });
    return { user: publicUser(user) };
  });

  /** Checks a sign-in (throttled per address and per account); returns the account or throws. */
  async function checkSignIn(request: FastifyRequest, body: z.infer<typeof loginBody>, reply: FastifyReply) {
    const ip = request.ip;
    // Throttled per client address and per account, so neither many addresses nor many accounts help.
    const keys = [`ip:${ip}`, `user:${body.username.toLowerCase()}`];
    const wait = limiter.retryAfter(keys);
    if (wait > 0) {
      ctx.audit.record('login.blocked', { actorName: body.username, ip });
      reply.header('Retry-After', String(Math.ceil(wait / 1000)));
      throw new HttpError(429, 'Too many failed sign-in attempts. Try again in {wait}.', { wait: (lang) => waitMessage(wait, lang) });
    }
    const user = findUserByName(ctx, body.username);
    const ok = user ? await verifyPassword(user.passwordHash, body.password) : await dummyVerify(body.password);
    if (!user || !ok) {
      limiter.fail(keys);
      log.warn(`Failed sign-in for "${body.username}" from ${ip}`);
      ctx.audit.record('login.failed', { actorName: body.username, ip, detail: user ? 'wrong password' : 'unknown user' });
      throw new HttpError(401, 'Incorrect username or password.');
    }
    if (user.disabled) {
      ctx.audit.record('login.failed', { actor: user, ip, detail: 'account disabled' });
      throw new HttpError(403, 'This account is disabled. Ask an administrator to enable it.');
    }
    limiter.reset(keys);
    ctx.db.update(users).set({ lastLoginAt: Date.now() }).where(eq(users.id, user.id)).run();
    return user;
  }

  app.post('/api/auth/login', async (request, reply) => {
    const user = await checkSignIn(request, loginBody.parse(request.body), reply);
    const { token } = ctx.sessions.create(user.id, request.headers['user-agent'], request.ip);
    setSessionCookie(ctx, request, reply, token);
    ctx.audit.record('login.success', { actor: user, ip: request.ip, detail: describeUserAgent(request.headers['user-agent']) });
    ctx.notifications.notify('newDevice', { user: user.displayName || user.username, device: describeUserAgent(request.headers['user-agent']) });
    return { user: publicUser(user) };
  });

  // ---- the Vidalune app: a token instead of a cookie, by password or by a code confirmed on the website
  const pairing = new PairingService();
  const pairStarts = new ProgressiveLimiter({ freeAttempts: 10, baseDelayMs: 60_000 });
  const codeGuesses = new ProgressiveLimiter({ freeAttempts: 5, baseDelayMs: 30_000 });
  const appSignIn = (user: { id: number; username: string }, deviceName: string, request: FastifyRequest, how: string) => {
    const { token, expiresAt } = ctx.sessions.create(user.id, request.headers['user-agent'], request.ip, { deviceName });
    ctx.audit.record('login.success', { actor: user, ip: request.ip, detail: `Vidalune app (${how}): ${deviceName}` });
    ctx.notifications.notify('newDevice', { user: user.username, device: `Vidalune app, ${deviceName}` });
    return { token, expiresAt };
  };

  // ---- a Vidalune account: a one-time ticket from vidalune.com, checked with the account service
  const ticketBody = z.object({ ticket: z.string().min(20).max(200) });
  /** Who the ticket is for here: the user who connected that Vidalune account (enabled), or nobody. */
  const ticketUser = async (ticket: string, request: FastifyRequest) => {
    const who = await ctx.cloud.redeem(ticket);
    // An invitation this account accepted: its user is made now, the first time.
    const invited = /^invite:([\w-]{6,40})$/.exec(who.userRef ?? '')?.[1];
    let user = invited
      ? ((await redeemInvite(ctx, invited, who.email, request.ip)) ?? undefined)
      : who.userRef && /^\d+$/.test(who.userRef)
        ? ctx.db.select().from(users).where(eq(users.id, Number(who.userRef))).get()
        : undefined;
    // The server's owner without a user of their own here yet (linked before accounts were connected
    // per user): they are its administrator. Connected now, so it stays that way.
    if (!user && !who.userRef && who.owner) {
      user = ctx.db.select().from(users).where(and(eq(users.role, 'admin'), eq(users.disabled, false))).orderBy(asc(users.id)).get();
      if (user) {
        const owner = user;
        await ctx.cloud.connectOwner(owner.id).catch((err: Error) => log.warn(`Connecting the owner's Vidalune account failed: ${err.message}`));
        ctx.audit.record('cloud.account_linked', { actor: owner, ip: request.ip, detail: who.email ?? undefined });
      }
    }
    if (!user || user.disabled) {
      ctx.audit.record('login.failed', { actorName: who.email ?? 'Vidalune account', ip: request.ip, detail: user ? 'account disabled (Vidalune account)' : 'Vidalune account not connected to a user' });
      return null;
    }
    ctx.db.update(users).set({ lastLoginAt: Date.now() }).where(eq(users.id, user.id)).run();
    return user;
  };

  /** Opened from app.vidalune.com: signed in with the ticket, then on to the home page. */
  app.get('/sso', async (request, reply) => {
    const parsed = ticketBody.safeParse(request.query);
    if (!parsed.success) return reply.redirect('/login?vidalune=failed');
    try {
      const user = await ticketUser(parsed.data.ticket, request);
      if (!user) return reply.redirect('/login?vidalune=unknown');
      const { token } = ctx.sessions.create(user.id, request.headers['user-agent'], request.ip);
      setSessionCookie(ctx, request, reply, token);
      ctx.audit.record('login.success', { actor: user, ip: request.ip, detail: `Vidalune account, ${describeUserAgent(request.headers['user-agent'])}` });
      ctx.notifications.notify('newDevice', { user: user.displayName || user.username, device: describeUserAgent(request.headers['user-agent']) });
      return reply.header('Cache-Control', 'no-store').redirect('/');
    } catch (err) {
      log.warn(`Sign-in with a Vidalune account failed: ${(err as Error).message}`);
      return reply.redirect('/login?vidalune=failed');
    }
  });

  /** The app signs in with a ticket it got from the account service for this server. */
  app.post('/api/auth/app/ticket', async (request) => {
    const body = ticketBody.extend({ deviceName: deviceNameSchema }).parse(request.body);
    const user = await ticketUser(body.ticket, request);
    if (!user) throw new HttpError(403, 'Your Vidalune account has no user on this server (any more). Ask its administrator to invite you again.');
    return { ...appSignIn(user, body.deviceName, request, 'Vidalune account'), user: publicUser(user) };
  });

  app.post('/api/auth/app/login', async (request, reply) => {
    const body = loginBody.extend({ deviceName: deviceNameSchema }).parse(request.body);
    const user = await checkSignIn(request, body, reply);
    return { ...appSignIn(user, body.deviceName, request, 'password'), user: publicUser(user) };
  });

  app.post('/api/auth/pair/start', async (request, reply) => {
    const { deviceName } = z.object({ deviceName: deviceNameSchema }).parse(request.body);
    const keys = [`pair-ip:${request.ip}`];
    const wait = pairStarts.retryAfter(keys);
    if (wait > 0) {
      reply.header('Retry-After', String(Math.ceil(wait / 1000)));
      throw new HttpError(429, 'Too many codes requested. Try again in {wait}.', { wait: (lang) => waitMessage(wait, lang) });
    }
    // Every code counts towards the limit; a normal app asks for one now and then.
    pairStarts.fail(keys);
    return { ...pairing.start(deviceName), interval: PAIRING_POLL_SECONDS };
  });

  app.post('/api/auth/pair/poll', async (request) => {
    const { pollToken } = z.object({ pollToken: z.string().min(1).max(100) }).parse(request.body);
    const result = pairing.poll(pollToken);
    if (result.status === 'expired') throw new HttpError(410, 'This code has expired. Ask for a new one.');
    if (result.status === 'pending') return { status: 'pending' };
    const user = ctx.db.select().from(users).where(eq(users.id, result.userId)).get();
    if (!user || user.disabled) throw new HttpError(410, 'This code has expired. Ask for a new one.');
    return { status: 'approved', ...appSignIn(user, result.deviceName, request, 'code'), user: publicUser(user) };
  });

  /** A code someone signed in on the website entered: which device is waiting behind it. */
  const pendingDevice = (request: FastifyRequest, reply: FastifyReply, input: string) => {
    const keys = [`code:${request.user!.id}`];
    const wait = codeGuesses.retryAfter(keys);
    if (wait > 0) {
      reply.header('Retry-After', String(Math.ceil(wait / 1000)));
      throw new HttpError(429, 'Too many wrong codes. Try again in {wait}.', { wait: (lang) => waitMessage(wait, lang) });
    }
    const found = pairing.find(input);
    if (!found) {
      codeGuesses.fail(keys);
      throw new HttpError(404, 'This code is not valid (any more). Check it, or ask the app for a new one.');
    }
    return found;
  };

  app.get<{ Params: { code: string } }>('/api/auth/pair/:code', { preHandler: requireUser }, async (request, reply) => {
    const found = pendingDevice(request, reply, request.params.code.slice(0, 20));
    return { code: found.code, deviceName: found.deviceName, expiresAt: found.expiresAt };
  });

  app.post<{ Params: { code: string } }>('/api/auth/pair/:code/approve', { preHandler: requireUser }, async (request, reply) => {
    const found = pendingDevice(request, reply, request.params.code.slice(0, 20));
    pairing.approve(found.code, request.user!.id);
    codeGuesses.reset([`code:${request.user!.id}`]);
    ctx.audit.record('device.linked', { actor: request.user, ip: request.ip, target: found.deviceName });
    return { ok: true, deviceName: found.deviceName };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    if (request.user) ctx.audit.record('logout', { actor: request.user, ip: request.ip });
    ctx.sessions.destroy(request.sessionToken);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireUser }, async (request) => ({ user: publicUser(request.user!) }));

  // ---- account
  app.put('/api/account/profile', { preHandler: requireUser }, async (request) => {
    const body = profileBody.parse(request.body);
    const row = ctx.db
      .update(users)
      .set({ displayName: body.displayName || null, updatedAt: Date.now() })
      .where(eq(users.id, request.user!.id))
      .returning()
      .get();
    return { user: publicUser(row) };
  });

  app.post('/api/account/password', { preHandler: requireUser }, async (request) => {
    const body = passwordBody.parse(request.body);
    const user = ctx.db.select().from(users).where(eq(users.id, request.user!.id)).get()!;
    if (!(await verifyPassword(user.passwordHash, body.currentPassword))) throw new HttpError(400, 'Current password is incorrect.');
    const pErr = validatePassword(body.newPassword);
    if (pErr) throw new HttpError(400, pErr);
    ctx.db
      .update(users)
      .set({ passwordHash: await hashPassword(body.newPassword), updatedAt: Date.now() })
      .where(eq(users.id, user.id))
      .run();
    const ended = body.signOutOthers ? ctx.sessions.destroyAllForUser(user.id, request.sessionToken) : 0;
    ctx.audit.record('account.password_changed', { actor: user, ip: request.ip, detail: body.signOutOthers ? `signed out ${ended} other session(s)` : 'other sessions kept' });
    return { ok: true, signedOut: ended };
  });

  // ---- interface language (per account; separate from audio and subtitle languages)
  app.put('/api/account/language', { preHandler: requireUser }, async (request) => {
    const { language } = z.object({ language: languageSchema }).parse(request.body);
    const row = ctx.db.update(users).set({ language, updatedAt: Date.now() }).where(eq(users.id, request.user!.id)).returning().get();
    return { user: publicUser(row) };
  });

  // ---- playback language preferences (per account, used on every device)
  app.get('/api/account/preferences', { preHandler: requireUser }, async (request) => {
    const u = ctx.db.select().from(users).where(eq(users.id, request.user!.id)).get()!;
    return preferencesView(u);
  });

  app.put('/api/account/preferences', { preHandler: requireUser }, async (request) => {
    const b = preferencesBody.parse(request.body);
    const row = ctx.db
      .update(users)
      .set({
        ...(b.audioLanguage !== undefined ? { prefAudioLanguage: b.audioLanguage } : {}),
        ...(b.subtitleLanguage !== undefined ? { prefSubtitleLanguage: b.subtitleLanguage } : {}),
        ...(b.subtitleFallback !== undefined ? { prefSubtitleFallback: b.subtitleFallback } : {}),
        ...(b.subtitleMode !== undefined ? { prefSubtitleMode: b.subtitleMode } : {}),
        ...(b.skipIntro !== undefined ? { prefSkipIntro: b.skipIntro } : {}),
        ...(b.skipCredits !== undefined ? { prefSkipCredits: b.skipCredits } : {}),
        ...(b.skipRecap !== undefined ? { prefSkipRecap: b.skipRecap } : {}),
        ...(b.subtitleStyle !== undefined ? { prefSubtitleStyle: b.subtitleStyle === null ? null : JSON.stringify(b.subtitleStyle) } : {}),
        updatedAt: Date.now(),
      })
      .where(eq(users.id, request.user!.id))
      .returning()
      .get();
    return preferencesView(row);
  });

  // ---- own sessions
  app.get('/api/account/sessions', { preHandler: requireUser }, async (request) => ctx.sessions.list(request.user!.id, request.sessionToken));

  app.delete<{ Params: { id: string } }>('/api/account/sessions/:id', { preHandler: requireUser }, async (request) => {
    const id = sessionIdParam.parse(request.params.id);
    if (!ctx.sessions.revoke(request.user!.id, id)) throw new HttpError(404, 'Session not found.');
    ctx.audit.record('session.revoked', { actor: request.user, ip: request.ip, target: request.user!.username });
    return { ok: true };
  });

  app.post('/api/account/sessions/revoke-others', { preHandler: requireUser }, async (request) => {
    const n = ctx.sessions.destroyAllForUser(request.user!.id, request.sessionToken);
    ctx.audit.record('session.revoked_all', { actor: request.user, ip: request.ip, target: request.user!.username, detail: `${n} session(s)` });
    return { ok: true, revoked: n };
  });

  app.put('/api/account/avatar', { preHandler: requireUser }, async (request) => {
    const { dataUrl } = avatarBody.parse(request.body);
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) throw new HttpError(400, 'Upload a PNG, JPEG or WebP image.');
    const type = AVATAR_TYPES[m[1]];
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 2 * 1024 * 1024) throw new HttpError(400, 'Images must be 2 MB or smaller.');
    if (!type.magic(buf)) throw new HttpError(400, 'The file is not a valid image.');
    const userId = request.user!.id;
    for (const ext of ['png', 'jpg', 'webp']) fs.rmSync(path.join(ctx.config.avatarDir, `${userId}.${ext}`), { force: true });
    const file = `${userId}.${type.ext}`;
    fs.writeFileSync(path.join(ctx.config.avatarDir, file), buf);
    const row = ctx.db
      .update(users)
      .set({ avatarFile: `${file}#${Date.now()}`, updatedAt: Date.now() })
      .where(eq(users.id, userId))
      .returning()
      .get();
    return { user: publicUser(row) };
  });

  app.delete('/api/account/avatar', { preHandler: requireUser }, async (request) => {
    const userId = request.user!.id;
    for (const ext of ['png', 'jpg', 'webp']) fs.rmSync(path.join(ctx.config.avatarDir, `${userId}.${ext}`), { force: true });
    const row = ctx.db.update(users).set({ avatarFile: null }).where(eq(users.id, userId)).returning().get();
    return { user: publicUser(row) };
  });

  app.get<{ Params: { id: string } }>('/api/avatars/:id', { preHandler: requireUser }, async (request, reply) => {
    const id = Number(request.params.id);
    const row = Number.isInteger(id) ? ctx.db.select({ avatarFile: users.avatarFile }).from(users).where(eq(users.id, id)).get() : undefined;
    const file = row?.avatarFile?.split('#')[0];
    if (!file || !/^\d+\.(png|jpg|webp)$/.test(file)) return reply.code(404).send({ error: tr(requestLanguage(request), 'No avatar.') });
    const full = path.join(ctx.config.avatarDir, file);
    if (!fs.existsSync(full)) return reply.code(404).send({ error: tr(requestLanguage(request), 'No avatar.') });
    const mime = file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return reply.type(mime).header('Cache-Control', 'private, max-age=86400').send(fs.createReadStream(full));
  });
}
