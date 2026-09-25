import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, count, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireUser } from '../app.js';
import { users } from '../db/schema.js';
import { SESSION_COOKIE } from '../auth/sessions.js';
import { dummyVerify, hashPassword, validatePassword, validateUsername, verifyPassword } from '../auth/password.js';
import { HttpError } from '../http-error.js';
import { createLogger } from '../logger.js';
import { APP_NAME, APP_TAGLINE, APP_VERSION } from '../version.js';

const log = createLogger('auth');

/** Small in-memory limiter for failed logins (per IP). */
class LoginLimiter {
  private attempts = new Map<string, { count: number; resetAt: number }>();
  constructor(
    private readonly max = 10,
    private readonly windowMs = 15 * 60 * 1000,
  ) {}
  blocked(key: string): boolean {
    const a = this.attempts.get(key);
    if (!a) return false;
    if (Date.now() > a.resetAt) {
      this.attempts.delete(key);
      return false;
    }
    return a.count >= this.max;
  }
  fail(key: string): void {
    const a = this.attempts.get(key);
    if (!a || Date.now() > a.resetAt) this.attempts.set(key, { count: 1, resetAt: Date.now() + this.windowMs });
    else a.count++;
    if (this.attempts.size > 10000) this.attempts.clear();
  }
  reset(key: string): void {
    this.attempts.delete(key);
  }
}

export function publicUser(u: { id: number; username: string; displayName: string | null; role: 'admin' | 'user'; avatarFile: string | null }) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
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

export function setupRequired(ctx: AppContext): boolean {
  return ctx.db.select({ n: count() }).from(users).where(eq(users.role, 'admin')).get()!.n === 0;
}

function setSessionCookie(ctx: AppContext, request: FastifyRequest, reply: FastifyReply, token: string): void {
  const secure = ctx.config.cookieSecure === 'auto' ? request.protocol === 'https' : ctx.config.cookieSecure;
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    signed: true,
    maxAge: Math.floor(ctx.sessions.ttlMs / 1000),
  });
}

const loginBody = z.object({ username: z.string().trim().min(1).max(64), password: z.string().min(1).max(256) });
const setupBody = z.object({
  username: z.string().trim(),
  password: z.string(),
  serverName: z.string().trim().max(64).optional(),
  tmdbApiKey: z.string().trim().max(512).optional(),
});
const profileBody = z.object({ displayName: z.string().trim().max(64).nullable() });
const passwordBody = z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string() });
const avatarBody = z.object({ dataUrl: z.string().max(3 * 1024 * 1024) });

const AVATAR_TYPES: Record<string, { ext: string; magic: (b: Buffer) => boolean }> = {
  'image/png': { ext: 'png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: 'webp', magic: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
};

export async function authRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const limiter = new LoginLimiter();

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
    setupRequired: setupRequired(ctx),
  }));

  app.post('/api/setup', async (request, reply) => {
    if (!setupRequired(ctx)) throw new HttpError(409, 'Velyx is already set up.');
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
      if (existing > 0) throw new HttpError(409, 'Velyx is already set up.');
      return tx.insert(users).values({ username: body.username, passwordHash, role: 'admin', lastLoginAt: Date.now() }).returning().get();
    });
    ctx.settings.update({
      serverName: body.serverName || 'Velyx',
      ...(body.tmdbApiKey ? { tmdbApiKey: body.tmdbApiKey } : {}),
    });
    const { token } = ctx.sessions.create(user.id, request.headers['user-agent']);
    setSessionCookie(ctx, request, reply, token);
    log.info(`Administrator "${user.username}" created during first-run setup`);
    return { user: publicUser(user) };
  });

  app.post('/api/auth/login', async (request, reply) => {
    const ip = request.ip;
    if (limiter.blocked(ip)) throw new HttpError(429, 'Too many failed sign-in attempts. Wait 15 minutes and try again.');
    const body = loginBody.parse(request.body);
    const user = ctx.db.select().from(users).where(eq(users.username, body.username)).get();
    const ok = user ? await verifyPassword(user.passwordHash, body.password) : await dummyVerify(body.password);
    if (!user || !ok) {
      limiter.fail(ip);
      log.warn(`Failed sign-in for "${body.username}" from ${ip}`);
      throw new HttpError(401, 'Incorrect username or password.');
    }
    if (user.disabled) throw new HttpError(403, 'This account is disabled. Ask an administrator to enable it.');
    limiter.reset(ip);
    ctx.db.update(users).set({ lastLoginAt: Date.now() }).where(eq(users.id, user.id)).run();
    const { token } = ctx.sessions.create(user.id, request.headers['user-agent']);
    setSessionCookie(ctx, request, reply, token);
    return { user: publicUser(user) };
  });

  app.post('/api/auth/logout', async (request, reply) => {
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
    ctx.sessions.destroyAllForUser(user.id, request.sessionToken);
    return { ok: true };
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
    if (!file || !/^\d+\.(png|jpg|webp)$/.test(file)) return reply.code(404).send({ error: 'No avatar.' });
    const full = path.join(ctx.config.avatarDir, file);
    if (!fs.existsSync(full)) return reply.code(404).send({ error: 'No avatar.' });
    const mime = file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return reply.type(mime).header('Cache-Control', 'private, max-age=86400').send(fs.createReadStream(full));
  });
}
