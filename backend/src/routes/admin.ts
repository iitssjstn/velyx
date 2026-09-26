import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { count, eq, gt, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireAdmin } from '../app.js';
import { episodes, libraries, mediaFiles, movies, seasons, shows, users } from '../db/schema.js';
import { hashPassword, validatePassword, validateUsername } from '../auth/password.js';
import { validateLibraryPath } from '../services/paths.js';
import { checkBinary } from '../services/probe.js';
import { recentLogs } from '../logger.js';
import { compatibilityReport } from '../services/compatibility-report.js';
import { isHealthKey, LibraryHealth } from '../services/library-health.js';
import { APP_VERSION } from '../version.js';
import { HttpError, notFound, parseId } from '../http-error.js';
import { adminCount, publicUser, sessionIdParam } from './auth.js';
import { backupPath, cancelRestore, createDatabaseSnapshot, pendingRestore, stageRestore, verifyBackup } from '../services/backup.js';
import { createLogger } from '../logger.js';
import type { RemuxEngine } from '../playback/remux.js';

const log = createLogger('admin');

const libraryBody = z.object({
  name: z.string().trim().min(1).max(64),
  type: z.enum(['movies', 'shows']),
  path: z.string().trim().min(1).max(1024),
});
const libraryUpdate = z.object({ name: z.string().trim().min(1).max(64).optional(), path: z.string().trim().min(1).max(1024).optional() });

const userCreate = z.object({
  username: z.string().trim(),
  password: z.string(),
  displayName: z.string().trim().max(64).optional(),
  role: z.enum(['admin', 'user']).default('user'),
  /** null (or omitted) = every library, including ones added later. */
  libraryIds: z.array(z.number().int().positive()).max(1000).nullable().optional(),
});
const userUpdate = z.object({
  displayName: z.string().trim().max(64).nullable().optional(),
  role: z.enum(['admin', 'user']).optional(),
  disabled: z.boolean().optional(),
  password: z.string().optional(),
  libraryIds: z.array(z.number().int().positive()).max(1000).nullable().optional(),
});

const settingsBody = z.object({
  serverName: z.string().trim().min(1).max(64).optional(),
  serverUrl: z
    .string()
    .trim()
    .max(512)
    .refine((v) => v === '' || /^https?:\/\/[^\s]+$/i.test(v), 'Enter a full URL starting with http:// or https://')
    .optional(),
  tmdbApiKey: z.string().trim().max(512).optional(),
  tmdbLanguage: z
    .string()
    .trim()
    .regex(/^([a-z]{2}(-[A-Z]{2})?)?$/, 'Use a language code like en-US or nl-NL')
    .optional(),
  includeAdult: z.boolean().optional(),
  watchFolders: z.boolean().optional(),
  scanIntervalMinutes: z.number().int().min(0).max(10080).nullable().optional(),
  scanOnStartup: z.boolean().optional(),
  deferScansWhilePlaying: z.boolean().optional(),
  segmentDetection: z.boolean().optional(),
  updateCheck: z.boolean().optional(),
});

const matchSearch = z.object({ type: z.enum(['movie', 'show']), query: z.string().trim().min(1).max(200), year: z.coerce.number().int().min(1870).max(2100).optional() });
const matchApply = z.object({ type: z.enum(['movie', 'show']), id: z.number().int().positive(), tmdbId: z.number().int().positive() });

/** CPU usage between two calls (system-wide and for the Velyx process), from cheap counters. */
function cpuSampler() {
  let prev = { times: os.cpus().map((c) => c.times), proc: process.cpuUsage(), at: process.hrtime.bigint() };
  return () => {
    const times = os.cpus().map((c) => c.times);
    const proc = process.cpuUsage();
    const at = process.hrtime.bigint();
    let idle = 0;
    let total = 0;
    times.forEach((t, i) => {
      const p = prev.times[i];
      if (!p) return;
      const sum = (x: typeof t) => x.user + x.nice + x.sys + x.idle + x.irq;
      total += sum(t) - sum(p);
      idle += t.idle - p.idle;
    });
    const elapsedUs = Number(at - prev.at) / 1000;
    const procUs = proc.user - prev.proc.user + (proc.system - prev.proc.system);
    prev = { times, proc, at };
    return {
      system: total > 0 ? Math.round((1 - idle / total) * 1000) / 10 : null,
      velyx: elapsedUs > 0 ? Math.round((procUs / elapsedUs / Math.max(1, times.length)) * 1000) / 10 : null,
    };
  };
}

function diskInfo(p: string): { total: number; free: number } | null {
  try {
    const s = fs.statfsSync(p);
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    return null;
  }
}

export async function adminRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const db = ctx.db;
  let ffmpegVersion: string | null | undefined;
  const sampleCpu = cpuSampler();

  // ------------------------------------------------------------------ dashboard
  app.get('/api/admin/dashboard', { preHandler: requireAdmin }, async () => {
    ffmpegVersion ??= await checkBinary(ctx.config.ffprobePath);
    const libs = db.select().from(libraries).orderBy(libraries.name).all();
    const mediaBytes = db.select({ total: sql<number>`coalesce(sum(${mediaFiles.size}), 0)` }).from(mediaFiles).get()!.total;
    const lastScan = libs.reduce<number | null>((max, l) => (l.lastScanAt && (!max || l.lastScanAt > max) ? l.lastScanAt : max), null);
    const dbSize = ['', '-wal'].reduce((s, suffix) => {
      try {
        return s + fs.statSync(ctx.config.dbPath + suffix).size;
      } catch {
        return s;
      }
    }, 0);
    const duplicates = db
      .select({ id: movies.id, title: movies.title, year: movies.year, files: count(mediaFiles.id) })
      .from(movies)
      .innerJoin(mediaFiles, eq(mediaFiles.movieId, movies.id))
      .groupBy(movies.id)
      .having(gt(count(mediaFiles.id), 1))
      .limit(50)
      .all();
    return {
      version: APP_VERSION,
      serverName: ctx.settings.serverName(),
      uptimeSec: Math.round((Date.now() - ctx.startedAt) / 1000),
      node: process.version,
      platform: `${os.type()} ${os.release()} (${os.arch()})`,
      memory: { rss: process.memoryUsage().rss, systemTotal: os.totalmem(), systemFree: os.freemem() },
      loadAverage: os.loadavg(),
      cpus: os.cpus().length,
      ffprobe: ffmpegVersion,
      activeStreams: (ctx.playback.get('remux') as RemuxEngine | undefined)?.activeStreams ?? 0,
      cpu: sampleCpu(),
      streams: ctx.streams.active(),
      disk: ctx.storage.dataDisk(),
      backups: { latest: ctx.backups.list()[0] ?? null, nextDue: ctx.backups.nextDue() },
      probeQueue: { active: ctx.probe.active, waiting: ctx.probe.waiting },
      update: ctx.updates.info(),
      tmdb: { configured: ctx.tmdb.configured, source: ctx.settings.tmdbKeySource() },
      counts: {
        movies: db.select({ n: count() }).from(movies).get()!.n,
        shows: db.select({ n: count() }).from(shows).get()!.n,
        seasons: db.select({ n: count() }).from(seasons).get()!.n,
        episodes: db.select({ n: count() }).from(episodes).get()!.n,
        files: db.select({ n: count() }).from(mediaFiles).get()!.n,
        users: db.select({ n: count() }).from(users).get()!.n,
        needsReview:
          db.select({ n: count() }).from(movies).where(eq(movies.matchStatus, 'unmatched')).get()!.n +
          db.select({ n: count() }).from(shows).where(eq(shows.matchStatus, 'unmatched')).get()!.n,
      },
      storage: {
        mediaBytes,
        databaseBytes: dbSize,
        // Folder sizes come from the storage report, computed at most every 10 minutes.
        cacheBytes: ((r) => r.velyx.artwork + r.velyx.subtitles)(await ctx.storage.get()),
        dataDisk: diskInfo(ctx.config.dataDir),
        libraries: libs.map((l) => ({ id: l.id, name: l.name, path: l.path, disk: diskInfo(l.path) })),
      },
      lastScanAt: lastScan,
      scan: ctx.scans.state(),
      duplicates,
    };
  });

  app.get('/api/admin/logs', { preHandler: requireAdmin }, async () => recentLogs().reverse());

  // ------------------------------------------------------------------ compatibility
  app.get('/api/admin/compatibility', { preHandler: requireAdmin }, async () => ({ libraries: compatibilityReport(db), analysis: ctx.analyzer.status() }));

  app.post('/api/admin/compatibility/analyze', { preHandler: requireAdmin }, async () => {
    ctx.analyzer.start();
    return { analysis: ctx.analyzer.status() };
  });

  // ------------------------------------------------------------------ library health
  const health = new LibraryHealth(db, () => ctx.metadata.enabled);
  const healthQuery = z.object({
    libraryId: z.coerce.number().int().positive().optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  });
  const assertLibrary = (id: number | undefined) => {
    if (id !== undefined && !db.select({ id: libraries.id }).from(libraries).where(eq(libraries.id, id)).get()) throw notFound('Library');
  };

  app.get('/api/admin/health', { preHandler: requireAdmin }, async (request) => {
    const { libraryId } = healthQuery.parse(request.query);
    assertLibrary(libraryId);
    return { ...health.summary(libraryId), analysis: ctx.analyzer.status() };
  });

  app.get<{ Params: { key: string } }>('/api/admin/health/:key', { preHandler: requireAdmin }, async (request) => {
    const { key } = request.params;
    if (!isHealthKey(key)) throw notFound('Category');
    const q = healthQuery.parse(request.query);
    assertLibrary(q.libraryId);
    return health.items(key, q);
  });

  // ------------------------------------------------------------------ storage
  app.get<{ Querystring: { refresh?: string } }>('/api/admin/storage', { preHandler: requireAdmin }, async (request) => ctx.storage.get(request.query.refresh === '1'));

  app.post('/api/admin/storage/cleanup', { preHandler: requireAdmin }, async (request) => {
    const { target } = z.object({ target: z.enum(['artwork', 'subtitles']) }).parse(request.body);
    const result = await ctx.storage.cleanup(target);
    ctx.audit.record('cache.cleared', { actor: request.user, ip: request.ip, target: target === 'artwork' ? 'Artwork cache' : 'Subtitle cache', detail: `${result.files} unused file(s)` });
    return { ...result, report: await ctx.storage.get(true) };
  });

  // ------------------------------------------------------------------ libraries
  const libraryView = (l: typeof libraries.$inferSelect) => {
    const state = ctx.scans.state();
    const itemCount =
      l.type === 'movies'
        ? db.select({ n: count() }).from(movies).where(eq(movies.libraryId, l.id)).get()!.n
        : db.select({ n: count() }).from(shows).where(eq(shows.libraryId, l.id)).get()!.n;
    const fileCount = db.select({ n: count() }).from(mediaFiles).where(eq(mediaFiles.libraryId, l.id)).get()!.n;
    return {
      ...l,
      itemCount,
      fileCount,
      available: fs.existsSync(l.path),
      scanning: state.running?.libraryId === l.id ? state.running.progress : null,
      queued: state.queued.some((j) => j.libraryId === l.id),
      watching: ctx.watcher.isWatching(l.id),
      watchError: ctx.watcher.status().find((w) => w.libraryId === l.id)?.error ?? null,
    };
  };

  app.get('/api/libraries', { preHandler: requireAdmin }, async () => ({
    libraries: db.select().from(libraries).orderBy(libraries.name).all().map(libraryView),
    mediaRoots: ctx.config.mediaRoots,
  }));

  app.post('/api/libraries', { preHandler: requireAdmin }, async (request) => {
    const body = libraryBody.parse(request.body);
    const check = validateLibraryPath(body.path, ctx.config.mediaRoots);
    if (!check.ok) throw new HttpError(400, check.error!);
    const all = db.select().from(libraries).all();
    const clash = all.find((l) => l.path === check.resolved || check.resolved!.startsWith(l.path + '/') || l.path.startsWith(check.resolved! + '/'));
    if (clash) throw new HttpError(409, `This folder overlaps with the library "${clash.name}".`);
    const row = db.insert(libraries).values({ name: body.name, type: body.type, path: check.resolved! }).returning().get();
    log.info(`Library "${row.name}" added (${row.path})`);
    ctx.audit.record('library.created', { actor: request.user, ip: request.ip, target: row.name, detail: `${row.type} at ${row.path}` });
    ctx.scans.enqueue(row.id);
    ctx.watcher.sync(ctx.settings.get().watchFolders);
    return libraryView(row);
  });

  app.put<{ Params: { id: string } }>('/api/libraries/:id', { preHandler: requireAdmin }, async (request) => {
    const id = parseId(request.params.id);
    const body = libraryUpdate.parse(request.body);
    const lib = db.select().from(libraries).where(eq(libraries.id, id)).get();
    if (!lib) throw notFound('Library');
    const patch: Partial<typeof libraries.$inferInsert> = {};
    if (body.name) patch.name = body.name;
    let pathChanged = false;
    if (body.path && body.path !== lib.path) {
      const check = validateLibraryPath(body.path, ctx.config.mediaRoots);
      if (!check.ok) throw new HttpError(400, check.error!);
      const clash = db
        .select()
        .from(libraries)
        .where(ne(libraries.id, id))
        .all()
        .find((l) => l.path === check.resolved || check.resolved!.startsWith(l.path + '/') || l.path.startsWith(check.resolved! + '/'));
      if (clash) throw new HttpError(409, `This folder overlaps with the library "${clash.name}".`);
      if (ctx.scans.isBusy(id)) throw new HttpError(409, 'Wait for the current scan to finish before changing the folder.');
      patch.path = check.resolved!;
      pathChanged = true;
    }
    const row = db.update(libraries).set(patch).where(eq(libraries.id, id)).returning().get();
    ctx.audit.record('library.updated', {
      actor: request.user,
      ip: request.ip,
      target: row.name,
      detail: [patch.name && patch.name !== lib.name ? `renamed from "${lib.name}"` : null, pathChanged ? `folder ${lib.path} → ${row.path}` : null].filter(Boolean).join('; ') || null,
    });
    if (pathChanged) {
      // Files under the old path disappear during the next scan; files under the new one are added.
      ctx.scans.enqueue(id);
      ctx.watcher.sync(ctx.settings.get().watchFolders);
    }
    return libraryView(row);
  });

  app.delete<{ Params: { id: string } }>('/api/libraries/:id', { preHandler: requireAdmin }, async (request) => {
    const id = parseId(request.params.id);
    if (ctx.scans.state().running?.libraryId === id) throw new HttpError(409, 'This library is being scanned. Try again when the scan finishes.');
    const lib = db.select().from(libraries).where(eq(libraries.id, id)).get();
    if (!lib) throw notFound('Library');
    db.delete(libraries).where(eq(libraries.id, id)).run();
    ctx.audit.record('library.deleted', { actor: request.user, ip: request.ip, target: lib.name, detail: lib.path });
    log.info(`Library ${id} removed (media files on disk were not touched)`);
    ctx.watcher.sync(ctx.settings.get().watchFolders);
    return { ok: true };
  });

  const scanBody = z.object({ refreshMetadata: z.boolean().optional(), full: z.boolean().optional() }).default({});

  app.post<{ Params: { id: string } }>('/api/libraries/:id/scan', { preHandler: requireAdmin }, async (request) => {
    const id = parseId(request.params.id);
    if (!db.select({ id: libraries.id }).from(libraries).where(eq(libraries.id, id)).get()) throw notFound('Library');
    const { refreshMetadata: refresh = false, full = false } = scanBody.parse(request.body ?? {});
    if (refresh && !ctx.tmdb.configured) throw new HttpError(400, 'Add a TMDB API key in Admin → Metadata to refresh metadata.');
    ctx.scans.enqueue(id, refresh, full);
    const name = db.select({ name: libraries.name }).from(libraries).where(eq(libraries.id, id)).get()?.name;
    ctx.audit.record('library.scan', { actor: request.user, ip: request.ip, target: name, detail: [refresh ? 'with metadata refresh' : null, full ? 're-analysing every file' : null].filter(Boolean).join(', ') || null });
    return { queued: true };
  });

  app.post('/api/libraries/scan-all', { preHandler: requireAdmin }, async (request) => {
    const { full = false } = scanBody.parse(request.body ?? {});
    ctx.scans.enqueueAll(false, full);
    return { queued: true };
  });

  app.get('/api/libraries/scan-status', { preHandler: requireAdmin }, async () => ctx.scans.state());

  app.post('/api/libraries/scans/pause', { preHandler: requireAdmin }, async (request) => {
    ctx.scans.pause('manual');
    ctx.audit.record('scans.paused', { actor: request.user, ip: request.ip });
    return ctx.scans.state();
  });

  app.post('/api/libraries/scans/resume', { preHandler: requireAdmin }, async (request) => {
    ctx.scans.resume('manual');
    ctx.audit.record('scans.resumed', { actor: request.user, ip: request.ip });
    return ctx.scans.state();
  });

  app.get<{ Params: { id: string } }>('/api/libraries/:id/issues', { preHandler: requireAdmin }, async (request) => {
    const id = parseId(request.params.id);
    if (!db.select({ id: libraries.id }).from(libraries).where(eq(libraries.id, id)).get()) throw notFound('Library');
    return {
      unrecognized: ctx.scanner.unlinkedFiles(id),
      failed: ctx.scanner.failedFiles(id),
    };
  });

  // ------------------------------------------------------------------ users
  const userView = (u: typeof users.$inferSelect) => ({
    ...publicUser(u),
    disabled: u.disabled,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    libraryIds: ctx.access.grantedIds(u.id),
  });

  app.get('/api/users', { preHandler: requireAdmin }, async () => db.select().from(users).orderBy(users.username).all().map(userView));

  app.post('/api/users', { preHandler: requireAdmin }, async (request) => {
    const body = userCreate.parse(request.body);
    const uErr = validateUsername(body.username);
    if (uErr) throw new HttpError(400, uErr);
    const pErr = validatePassword(body.password);
    if (pErr) throw new HttpError(400, pErr);
    if (db.select({ id: users.id }).from(users).where(eq(users.username, body.username)).get()) throw new HttpError(409, 'That username is taken.');
    const row = db
      .insert(users)
      .values({ username: body.username, displayName: body.displayName || null, role: body.role, passwordHash: await hashPassword(body.password) })
      .returning()
      .get();
    if (body.libraryIds) ctx.access.setGrants(row.id, body.libraryIds);
    log.info(`User "${row.username}" created by ${request.user!.username}`);
    ctx.audit.record('user.created', { actor: request.user, ip: request.ip, target: row.username, detail: `role ${row.role}` });
    return userView(row);
  });

  app.put<{ Params: { id: string } }>('/api/users/:id', { preHandler: requireAdmin }, async (request) => {
    const id = parseId(request.params.id);
    const body = userUpdate.parse(request.body);
    const target = db.select().from(users).where(eq(users.id, id)).get();
    if (!target) throw notFound('User');
    const losingAdmin = target.role === 'admin' && !target.disabled && ((body.role && body.role !== 'admin') || body.disabled === true);
    if (losingAdmin) {
      if (id === request.user!.id) throw new HttpError(400, 'You cannot remove your own administrator access or disable yourself.');
      if (adminCount(ctx) <= 1) throw new HttpError(400, 'Velyx needs at least one active administrator.');
    }
    const patch: Partial<typeof users.$inferInsert> = { updatedAt: Date.now() };
    if (body.displayName !== undefined) patch.displayName = body.displayName || null;
    if (body.role) patch.role = body.role;
    if (body.disabled !== undefined) patch.disabled = body.disabled;
    if (body.password !== undefined) {
      const pErr = validatePassword(body.password);
      if (pErr) throw new HttpError(400, pErr);
      patch.passwordHash = await hashPassword(body.password);
    }
    const row = db.update(users).set(patch).where(eq(users.id, id)).returning().get();
    if (body.libraryIds !== undefined) ctx.access.setGrants(id, body.libraryIds);
    if (body.disabled || body.password !== undefined) ctx.sessions.destroyAllForUser(id, id === request.user!.id ? request.sessionToken : undefined);
    const changes = [
      body.role && body.role !== target.role ? `role ${target.role} → ${body.role}` : null,
      body.disabled !== undefined && body.disabled !== target.disabled ? (body.disabled ? 'disabled' : 'enabled') : null,
      body.displayName !== undefined && (body.displayName || null) !== target.displayName ? 'display name changed' : null,
      body.libraryIds !== undefined ? (body.libraryIds === null ? 'library access: all' : `library access: ${body.libraryIds.length} libraries`) : null,
    ].filter(Boolean);
    if (changes.length) ctx.audit.record('user.updated', { actor: request.user, ip: request.ip, target: target.username, detail: changes.join('; ') });
    if (body.password !== undefined) ctx.audit.record('user.password_reset', { actor: request.user, ip: request.ip, target: target.username });
    return userView(row);
  });

  app.delete<{ Params: { id: string } }>('/api/users/:id', { preHandler: requireAdmin }, async (request) => {
    const id = parseId(request.params.id);
    if (id === request.user!.id) throw new HttpError(400, 'You cannot delete your own account.');
    const target = db.select().from(users).where(eq(users.id, id)).get();
    if (!target) throw notFound('User');
    if (target.role === 'admin' && !target.disabled && adminCount(ctx) <= 1) throw new HttpError(400, 'Velyx needs at least one active administrator.');
    db.delete(users).where(eq(users.id, id)).run();
    for (const ext of ['png', 'jpg', 'webp']) fs.rmSync(path.join(ctx.config.avatarDir, `${id}.${ext}`), { force: true });
    log.info(`User "${target.username}" deleted by ${request.user!.username}`);
    ctx.audit.record('user.deleted', { actor: request.user, ip: request.ip, target: target.username });
    return { ok: true };
  });

  const userOr404 = (idParam: string) => {
    const u = db.select().from(users).where(eq(users.id, parseId(idParam))).get();
    if (!u) throw notFound('User');
    return u;
  };

  app.get<{ Params: { id: string } }>('/api/users/:id/sessions', { preHandler: requireAdmin }, async (request) => {
    const u = userOr404(request.params.id);
    return ctx.sessions.list(u.id, u.id === request.user!.id ? request.sessionToken : undefined);
  });

  app.delete<{ Params: { id: string; sid: string } }>('/api/users/:id/sessions/:sid', { preHandler: requireAdmin }, async (request) => {
    const u = userOr404(request.params.id);
    if (!ctx.sessions.revoke(u.id, sessionIdParam.parse(request.params.sid))) throw notFound('Session');
    ctx.audit.record('session.revoked', { actor: request.user, ip: request.ip, target: u.username });
    return { ok: true };
  });

  /** Signs the user out everywhere (for your own account: everywhere except this browser). */
  app.delete<{ Params: { id: string } }>('/api/users/:id/sessions', { preHandler: requireAdmin }, async (request) => {
    const u = userOr404(request.params.id);
    const n = ctx.sessions.destroyAllForUser(u.id, u.id === request.user!.id ? request.sessionToken : undefined);
    ctx.audit.record('session.revoked_all', { actor: request.user, ip: request.ip, target: u.username, detail: `${n} session(s)` });
    return { ok: true, revoked: n };
  });

  // ------------------------------------------------------------------ audit log
  const auditQuery = z.object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    action: z.string().regex(/^[a-z_.]{1,40}$/).optional(),
    user: z.coerce.number().int().positive().optional(),
  });

  app.get('/api/admin/audit', { preHandler: requireAdmin }, async (request) => {
    const q = auditQuery.parse(request.query);
    return ctx.audit.list({ page: q.page, limit: q.limit, action: q.action, actorId: q.user });
  });

  // ------------------------------------------------------------------ settings
  const settingsView = () => {
    const s = ctx.settings.get();
    const key = ctx.settings.tmdbKey();
    return {
      serverName: s.serverName,
      serverUrl: s.serverUrl || ctx.config.serverUrl,
      tmdbLanguage: ctx.settings.tmdbLanguage(),
      includeAdult: s.includeAdult,
      watchFolders: s.watchFolders,
      updateCheck: s.updateCheck,
      tmdb: {
        configured: key.length > 0,
        source: ctx.settings.tmdbKeySource(),
        // Never return the key itself — only a hint so admins can tell which key is active.
        hint: key ? `••••${key.slice(-4)}` : null,
      },
      version: APP_VERSION,
      mediaRoots: ctx.config.mediaRoots,
      scanIntervalMinutes: ctx.settings.scanIntervalMinutes(),
      scanIntervalSource: s.scanIntervalMinutes === null ? 'environment' : 'settings',
      scanIntervalDefault: ctx.config.scanIntervalMinutes,
      scanOnStartup: s.scanOnStartup,
      deferScansWhilePlaying: s.deferScansWhilePlaying,
      segmentDetection: s.segmentDetection,
    };
  };

  app.get('/api/admin/settings', { preHandler: requireAdmin }, async () => settingsView());

  app.put('/api/admin/settings', { preHandler: requireAdmin }, async (request) => {
    const body = settingsBody.parse(request.body);
    const wasConfigured = ctx.tmdb.configured;
    if (body.tmdbApiKey !== undefined && body.tmdbApiKey !== '') {
      let valid: boolean;
      try {
        valid = await ctx.tmdb.validateKey(body.tmdbApiKey);
      } catch (err) {
        throw new HttpError(502, `Could not reach TMDB to verify the key: ${(err as Error).message}`);
      }
      if (!valid) throw new HttpError(400, 'TMDB rejected this API key.');
    }
    const { tmdbApiKey, ...rest } = body;
    ctx.settings.update(rest);
    if (tmdbApiKey !== undefined) {
      if (tmdbApiKey === '') ctx.settings.delete('tmdbApiKey');
      else ctx.settings.update({ tmdbApiKey });
    }
    if (rest.watchFolders !== undefined) ctx.watcher.sync(rest.watchFolders);
    if (rest.scanIntervalMinutes !== undefined) ctx.scans.configureSchedule(ctx.settings.scanIntervalMinutes());
    if (rest.segmentDetection === true) ctx.segments.enqueuePending();
    if (rest.segmentDetection !== undefined) ctx.segments.poke();
    // Names of what changed only — never the values of keys.
    const tmdbChanges = [tmdbApiKey !== undefined ? (tmdbApiKey === '' ? 'API key removed' : 'API key changed') : null, rest.tmdbLanguage !== undefined ? `language ${rest.tmdbLanguage || 'default'}` : null, rest.includeAdult !== undefined ? `adult titles ${rest.includeAdult ? 'on' : 'off'}` : null].filter(Boolean);
    if (tmdbChanges.length) ctx.audit.record('tmdb.updated', { actor: request.user, ip: request.ip, detail: tmdbChanges.join('; ') });
    const serverChanges = (['serverName', 'serverUrl', 'watchFolders', 'updateCheck', 'scanIntervalMinutes', 'scanOnStartup', 'deferScansWhilePlaying', 'segmentDetection'] as const).filter((k) => rest[k] !== undefined);
    if (serverChanges.length) ctx.audit.record('settings.updated', { actor: request.user, ip: request.ip, detail: serverChanges.join(', ') });
    if (!wasConfigured && ctx.tmdb.configured) {
      log.info('TMDB configured — fetching metadata for existing libraries');
      ctx.scans.enqueueAll(false);
    }
    return settingsView();
  });

  // ------------------------------------------------------------------ metadata review / fix match
  app.get('/api/admin/review', { preHandler: requireAdmin }, async () => {
    const needsReview = or(eq(movies.matchStatus, 'unmatched'), eq(movies.matchStatus, 'pending'));
    const movieRows = db
      .select({ id: movies.id, title: movies.title, parsedTitle: movies.parsedTitle, parsedYear: movies.parsedYear, status: movies.matchStatus, confidence: movies.matchConfidence })
      .from(movies)
      .where(needsReview)
      .orderBy(movies.sortTitle)
      .limit(500)
      .all();
    const showRows = db
      .select({ id: shows.id, title: shows.title, parsedTitle: shows.parsedTitle, parsedYear: shows.parsedYear, status: shows.matchStatus, confidence: shows.matchConfidence })
      .from(shows)
      .where(or(eq(shows.matchStatus, 'unmatched'), eq(shows.matchStatus, 'pending')))
      .orderBy(shows.sortTitle)
      .limit(500)
      .all();
    const firstFile = (where: ReturnType<typeof eq>) => db.select({ path: mediaFiles.path }).from(mediaFiles).where(where).limit(1).get()?.path ?? null;
    return {
      tmdbConfigured: ctx.tmdb.configured,
      movies: movieRows.map((m) => ({ ...m, type: 'movie' as const, samplePath: firstFile(eq(mediaFiles.movieId, m.id)) })),
      shows: showRows.map((s) => ({
        ...s,
        type: 'show' as const,
        samplePath:
          db
            .select({ path: mediaFiles.path })
            .from(mediaFiles)
            .innerJoin(episodes, eq(episodes.id, mediaFiles.episodeId))
            .where(eq(episodes.showId, s.id))
            .limit(1)
            .get()?.path ?? null,
      })),
    };
  });

  app.get('/api/admin/match/search', { preHandler: requireAdmin }, async (request) => {
    const q = matchSearch.parse(request.query);
    if (!ctx.tmdb.configured) throw new HttpError(400, 'Add a TMDB API key in Admin → Metadata first.');
    const results = q.type === 'movie' ? await ctx.metadata.searchMovieCandidates(q.query, q.year ?? null) : await ctx.metadata.searchShowCandidates(q.query, q.year ?? null);
    return results.slice(0, 20);
  });

  app.post('/api/admin/match', { preHandler: requireAdmin }, async (request) => {
    const body = matchApply.parse(request.body);
    if (!ctx.tmdb.configured) throw new HttpError(400, 'Add a TMDB API key in Admin → Metadata first.');
    if (body.type === 'movie') {
      if (!db.select({ id: movies.id }).from(movies).where(eq(movies.id, body.id)).get()) throw notFound('Movie');
      const id = await ctx.metadata.applyMovie(body.id, body.tmdbId, 'manual', 1);
      const title = db.select({ title: movies.title }).from(movies).where(eq(movies.id, id)).get()?.title;
      ctx.audit.record('metadata.matched', { actor: request.user, ip: request.ip, target: title, detail: `movie → TMDB ${body.tmdbId}` });
      return { type: 'movie', id };
    }
    if (!db.select({ id: shows.id }).from(shows).where(eq(shows.id, body.id)).get()) throw notFound('Show');
    await ctx.metadata.applyShow(body.id, body.tmdbId, 'manual', 1);
    const title = db.select({ title: shows.title }).from(shows).where(eq(shows.id, body.id)).get()?.title;
    ctx.audit.record('metadata.matched', { actor: request.user, ip: request.ip, target: title, detail: `show → TMDB ${body.tmdbId}` });
    return { type: 'show', id: body.id };
  });

  app.post<{ Params: { type: string; id: string } }>('/api/admin/refresh/:type/:id', { preHandler: requireAdmin }, async (request) => {
    const id = parseId(request.params.id);
    if (!ctx.tmdb.configured) throw new HttpError(400, 'Add a TMDB API key in Admin → Metadata first.');
    const result = request.params.type === 'movie' ? await ctx.metadata.matchMovie(id, true) : await ctx.metadata.matchShow(id, true);
    if (result === 'failed') throw new HttpError(502, 'TMDB could not be reached. Cached metadata is unchanged.');
    ctx.audit.record('metadata.refreshed', { actor: request.user, ip: request.ip, target: `${request.params.type} ${id}` });
    return { result };
  });

  // ------------------------------------------------------------------ backup
  app.get('/api/admin/backup', { preHandler: requireAdmin }, async (request, reply) => {
    const file = createDatabaseSnapshot(ctx.db, ctx.config.backupDir);
    ctx.audit.record('backup.downloaded', { actor: request.user, ip: request.ip });
    const stream = fs.createReadStream(file);
    stream.on('close', () => fs.rm(file, { force: true }, () => undefined));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return reply
      .type('application/vnd.sqlite3')
      .header('Content-Disposition', `attachment; filename="velyx-${stamp}.db"`)
      .header('Cache-Control', 'no-store')
      .send(stream);
  });

  // ---- stored backups
  const backupSettingsBody = z.object({
    schedule: z.enum(['daily', 'weekly', 'off']).optional(),
    hour: z.number().int().min(0).max(23).optional(),
    keepDaily: z.number().int().min(1).max(60).optional(),
    keepWeekly: z.number().int().min(0).max(52).optional(),
    keepMonthly: z.number().int().min(0).max(36).optional(),
  });
  const backupView = () => {
    const s = ctx.settings.get();
    return {
      backups: ctx.backups.list(),
      schedule: { schedule: s.backupSchedule, hour: s.backupHour, keepDaily: s.backupKeepDaily, keepWeekly: s.backupKeepWeekly, keepMonthly: s.backupKeepMonthly },
      nextDue: ctx.backups.nextDue(),
      pendingRestore: pendingRestore(ctx.config.dataDir),
      folder: ctx.config.backupDir,
    };
  };
  const namedBackup = (name: string) => {
    const file = backupPath(ctx.config.backupDir, name);
    if (!file) throw notFound('Backup');
    return file;
  };

  app.get('/api/admin/backups', { preHandler: requireAdmin }, async () => backupView());

  app.post('/api/admin/backups', { preHandler: requireAdmin }, async (request) => {
    const created = ctx.backups.create('manual');
    ctx.audit.record('backup.created', { actor: request.user, ip: request.ip, target: created.name });
    return created;
  });

  app.put('/api/admin/backups/settings', { preHandler: requireAdmin }, async (request) => {
    const b = backupSettingsBody.parse(request.body);
    ctx.settings.update({ backupSchedule: b.schedule, backupHour: b.hour, backupKeepDaily: b.keepDaily, backupKeepWeekly: b.keepWeekly, backupKeepMonthly: b.keepMonthly });
    ctx.backups.rotate();
    ctx.audit.record('settings.updated', { actor: request.user, ip: request.ip, detail: 'backup schedule' });
    return backupView();
  });

  app.post<{ Params: { name: string } }>('/api/admin/backups/:name/verify', { preHandler: requireAdmin }, async (request) => verifyBackup(namedBackup(request.params.name)));

  app.get<{ Params: { name: string } }>('/api/admin/backups/:name/download', { preHandler: requireAdmin }, async (request, reply) => {
    const file = namedBackup(request.params.name);
    ctx.audit.record('backup.downloaded', { actor: request.user, ip: request.ip, target: request.params.name });
    return reply
      .type(file.endsWith('.tar.gz') ? 'application/gzip' : 'application/vnd.sqlite3')
      .header('Content-Disposition', `attachment; filename="${request.params.name}"`)
      .header('Cache-Control', 'no-store')
      .send(fs.createReadStream(file));
  });

  app.delete<{ Params: { name: string } }>('/api/admin/backups/:name', { preHandler: requireAdmin }, async (request) => {
    fs.rmSync(namedBackup(request.params.name), { force: true });
    ctx.audit.record('backup.deleted', { actor: request.user, ip: request.ip, target: request.params.name });
    return backupView();
  });

  /** Stages a restore; it is applied (after a safety copy) when Velyx restarts. */
  app.post<{ Params: { name: string } }>('/api/admin/backups/:name/restore', { preHandler: requireAdmin }, async (request) => {
    // Explicit confirmation guards against accidental restores.
    z.object({ confirm: z.literal(true) }).parse(request.body);
    try {
      stageRestore(namedBackup(request.params.name), ctx.config.dataDir, request.user!.username);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    return backupView();
  });

  app.delete('/api/admin/backups/restore/pending', { preHandler: requireAdmin }, async () => {
    cancelRestore(ctx.config.dataDir);
    return backupView();
  });
}
