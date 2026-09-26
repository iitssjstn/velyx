import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { count, desc, eq, gt, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireAdmin } from '../app.js';
import { episodes, libraries, mediaFiles, movies, seasons, sessions, shows, users } from '../db/schema.js';
import { hashPassword, validatePassword, validateUsername } from '../auth/password.js';
import { validateLibraryPath } from '../services/paths.js';
import { checkBinary } from '../services/probe.js';
import { recentLogs } from '../logger.js';
import { APP_VERSION } from '../version.js';
import { HttpError, notFound, parseId } from '../http-error.js';
import { adminCount, publicUser } from './auth.js';
import { createDatabaseSnapshot } from '../services/backup.js';
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
});

const matchSearch = z.object({ type: z.enum(['movie', 'show']), query: z.string().trim().min(1).max(200), year: z.coerce.number().int().min(1870).max(2100).optional() });
const matchApply = z.object({ type: z.enum(['movie', 'show']), id: z.number().int().positive(), tmdbId: z.number().int().positive() });

function dirSize(dir: string): number {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else {
        try {
          total += fs.statSync(p).size;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return total;
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
        cacheBytes: dirSize(ctx.config.cacheDir),
        dataDisk: diskInfo(ctx.config.dataDir),
        libraries: libs.map((l) => ({ id: l.id, name: l.name, path: l.path, disk: diskInfo(l.path) })),
      },
      lastScanAt: lastScan,
      scan: ctx.scans.state(),
      duplicates,
    };
  });

  app.get('/api/admin/logs', { preHandler: requireAdmin }, async () => recentLogs().reverse());

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
    const res = db.delete(libraries).where(eq(libraries.id, id)).run();
    if (res.changes === 0) throw notFound('Library');
    log.info(`Library ${id} removed (media files on disk were not touched)`);
    ctx.watcher.sync(ctx.settings.get().watchFolders);
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { refreshMetadata?: boolean } }>('/api/libraries/:id/scan', { preHandler: requireAdmin }, async (request) => {
    const id = parseId(request.params.id);
    if (!db.select({ id: libraries.id }).from(libraries).where(eq(libraries.id, id)).get()) throw notFound('Library');
    const refresh = Boolean((request.body as { refreshMetadata?: boolean } | undefined)?.refreshMetadata);
    if (refresh && !ctx.tmdb.configured) throw new HttpError(400, 'Add a TMDB API key in Admin → Metadata to refresh metadata.');
    ctx.scans.enqueue(id, refresh);
    return { queued: true };
  });

  app.post('/api/libraries/scan-all', { preHandler: requireAdmin }, async () => {
    ctx.scans.enqueueAll(false);
    return { queued: true };
  });

  app.get('/api/libraries/scan-status', { preHandler: requireAdmin }, async () => ctx.scans.state());

  app.post('/api/libraries/scans/pause', { preHandler: requireAdmin }, async () => {
    ctx.scans.pause('manual');
    return ctx.scans.state();
  });

  app.post('/api/libraries/scans/resume', { preHandler: requireAdmin }, async () => {
    ctx.scans.resume('manual');
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
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/users/:id/sessions', { preHandler: requireAdmin }, async (request) => {
    const id = parseId(request.params.id);
    return db
      .select({ createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, userAgent: sessions.userAgent })
      .from(sessions)
      .where(eq(sessions.userId, id))
      .orderBy(desc(sessions.lastSeenAt))
      .all();
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
      tmdb: {
        configured: key.length > 0,
        source: ctx.settings.tmdbKeySource(),
        // Never return the key itself — only a hint so admins can tell which key is active.
        hint: key ? `••••${key.slice(-4)}` : null,
      },
      version: APP_VERSION,
      mediaRoots: ctx.config.mediaRoots,
      scanIntervalMinutes: ctx.config.scanIntervalMinutes,
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
      return { type: 'movie', id };
    }
    if (!db.select({ id: shows.id }).from(shows).where(eq(shows.id, body.id)).get()) throw notFound('Show');
    await ctx.metadata.applyShow(body.id, body.tmdbId, 'manual', 1);
    return { type: 'show', id: body.id };
  });

  app.post<{ Params: { type: string; id: string } }>('/api/admin/refresh/:type/:id', { preHandler: requireAdmin }, async (request) => {
    const id = parseId(request.params.id);
    if (!ctx.tmdb.configured) throw new HttpError(400, 'Add a TMDB API key in Admin → Metadata first.');
    const result = request.params.type === 'movie' ? await ctx.metadata.matchMovie(id, true) : await ctx.metadata.matchShow(id, true);
    if (result === 'failed') throw new HttpError(502, 'TMDB could not be reached. Cached metadata is unchanged.');
    return { result };
  });

  // ------------------------------------------------------------------ backup
  app.get('/api/admin/backup', { preHandler: requireAdmin }, async (_request, reply) => {
    const file = createDatabaseSnapshot(ctx.db, ctx.config.backupDir);
    const stream = fs.createReadStream(file);
    stream.on('close', () => fs.rm(file, { force: true }, () => undefined));
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return reply
      .type('application/vnd.sqlite3')
      .header('Content-Disposition', `attachment; filename="velyx-${stamp}.db"`)
      .header('Cache-Control', 'no-store')
      .send(stream);
  });
}
