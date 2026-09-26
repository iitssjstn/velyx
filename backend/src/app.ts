import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import type { AppConfig } from './config.js';
import type { DB } from './db/client.js';
import { SESSION_COOKIE, SessionService, type SessionUser } from './auth/sessions.js';
import { SettingsService } from './services/settings.js';
import { TmdbClient, type FetchLike } from './services/tmdb.js';
import { ImageCache } from './services/images.js';
import { MetadataService } from './services/metadata.js';
import { LibraryScanner } from './services/scanner.js';
import { ScanManager } from './services/scan-manager.js';
import { LibraryWatcher } from './services/watcher.js';
import { createFfprobe, type Prober } from './services/probe.js';
import { limitProber, type LimitedProber } from './services/probe-queue.js';
import { EmbeddedSubtitleExtractor } from './services/subtitles.js';
import { LibraryAccess } from './services/access.js';
import { AuditLog } from './services/audit.js';
import { BackupScheduler } from './services/backup-scheduler.js';
import { DiskMonitor, StorageService } from './services/storage.js';
import { StreamTracker } from './services/streams.js';
import { DetailAnalyzer } from './services/compatibility-report.js';
import { UpdateChecker } from './services/updates.js';
import { PlaybackRegistry } from './playback/engine.js';
import { DirectPlayEngine } from './playback/direct-play.js';
import { RemuxEngine } from './playback/remux.js';
import { createLogger } from './logger.js';
import { HttpError } from './http-error.js';
import { registerRoutes } from './routes/index.js';

const log = createLogger('http');
const SLOW_REQUEST_MS = 2000;
/** Responses that last as long as a transfer or a job (streams, backups): never "slow". */
const LONG_RUNNING = /^\/api\/(media\/\d+\/(stream|remux)|admin\/backups(\/.*)?)$/;

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    sessionToken: string | undefined;
  }
}

export interface AppContext {
  config: AppConfig;
  db: DB;
  settings: SettingsService;
  sessions: SessionService;
  tmdb: TmdbClient;
  images: ImageCache;
  metadata: MetadataService;
  scanner: LibraryScanner;
  scans: ScanManager;
  watcher: LibraryWatcher;
  playback: PlaybackRegistry;
  subtitleExtractor: EmbeddedSubtitleExtractor;
  access: LibraryAccess;
  audit: AuditLog;
  backups: BackupScheduler;
  storage: StorageService;
  disk: DiskMonitor;
  streams: StreamTracker;
  analyzer: DetailAnalyzer;
  updates: UpdateChecker;
  /** FFprobe behind the shared concurrency limit. */
  probe: LimitedProber;
  startedAt: number;
}

export interface BuildOptions {
  prober?: Prober;
  fetchImpl?: FetchLike;
  tmdbMinIntervalMs?: number;
  /** Quiet period before a folder change triggers a scan (default 30 s). */
  watchDebounceMs?: number;
}

export function createContext(config: AppConfig, db: DB, opts: BuildOptions = {}): AppContext {
  const settings = new SettingsService(db, config);
  const sessions = new SessionService(db, config.sessionTtlDays);
  const tmdb = new TmdbClient({
    getApiKey: () => settings.tmdbKey(),
    getLanguage: () => settings.tmdbLanguage(),
    getIncludeAdult: () => settings.get().includeAdult,
    fetchImpl: opts.fetchImpl,
    minIntervalMs: opts.tmdbMinIntervalMs,
  });
  const images = new ImageCache(config.imageCacheDir, opts.fetchImpl);
  const metadata = new MetadataService(db, tmdb, images);
  const probe = limitProber(opts.prober ?? createFfprobe(config.ffprobePath), config.scanConcurrency);
  const scanner = new LibraryScanner(db, probe, metadata, config.scanConcurrency);
  const scans = new ScanManager(db, scanner);
  const watcher = new LibraryWatcher(db, scans, opts.watchDebounceMs);
  const playback = new PlaybackRegistry();
  playback.register(new DirectPlayEngine());
  playback.register(new RemuxEngine(config.ffmpegPath));
  const subtitleExtractor = new EmbeddedSubtitleExtractor(config.ffmpegPath, config.subtitleCacheDir);
  const storage = new StorageService(db, config);
  // Critically low disk space pauses scans (which write artwork and rows); they resume on their own.
  const disk = new DiskMonitor(storage, (level) => (level === 'critical' ? scans.pause('low-disk') : scans.resume('low-disk')));
  const backups = new BackupScheduler(db, config.backupDir, settings, () => (storage.dataDisk()?.level === 'critical' ? 'disk space is critically low' : null));
  return { config, db, settings, sessions, tmdb, images, metadata, scanner, scans, watcher, playback, subtitleExtractor, access: new LibraryAccess(db), audit: new AuditLog(db), backups, storage, disk, streams: new StreamTracker(db), analyzer: new DetailAnalyzer(db, probe), updates: new UpdateChecker(config.updateRepo, () => settings.get().updateCheck, opts.fetchImpl), probe, startedAt: Date.now() };
}

export function requireUser(request: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void): void {
  if (!request.user) {
    reply.code(401).send({ error: 'Sign in to continue.' });
    return;
  }
  done();
}

export function requireAdmin(request: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void): void {
  if (!request.user) {
    reply.code(401).send({ error: 'Sign in to continue.' });
    return;
  }
  if (request.user.role !== 'admin') {
    reply.code(403).send({ error: 'Only administrators can do this.' });
    return;
  }
  done();
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    // A hop count trusts exactly that many proxies in front of Velyx (e.g. 2 for Cloudflare + Nginx).
    trustProxy: typeof ctx.config.trustProxy === 'number' ? ((_addr: string, hop: number) => hop < (ctx.config.trustProxy as number)) : ctx.config.trustProxy,
    bodyLimit: 4 * 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", 'data:'],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts: false,
  });
  await app.register(cookie, { secret: ctx.config.sessionSecret });

  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', undefined);

  // Resolve the session for every API request.
  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/')) return;
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return;
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;
    request.sessionToken = unsigned.value;
    request.user = ctx.sessions.resolve(unsigned.value, request.ip);
  });

  // CSRF defence: state-changing API calls must come from our own origin. Combined with SameSite=Lax
  // cookies and JSON-only bodies this blocks cross-site form posts.
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
    const origin = request.headers.origin;
    if (origin) {
      let host: string;
      try {
        host = new URL(origin).host;
      } catch {
        return reply.code(403).send({ error: 'Invalid request origin.' });
      }
      const expected = request.headers['x-forwarded-host'] && ctx.config.trustProxy ? String(request.headers['x-forwarded-host']) : request.headers.host;
      if (host !== expected) return reply.code(403).send({ error: 'Cross-site requests are not allowed.' });
    }
    const ct = request.headers['content-type'];
    if (ct && !ct.startsWith('application/json')) return reply.code(415).send({ error: 'Requests must be JSON.' });
  });

  // Slow API calls are worth knowing about on old hardware. Streams and downloads last as long as
  // the transfer, so they are left out. At LOG_LEVEL=debug every API call is logged.
  app.addHook('onResponse', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    const ms = reply.elapsedTime;
    const path = request.url.split('?')[0];
    const line = `${request.method} ${path} ${reply.statusCode} ${ms.toFixed(0)}ms`;
    if (ms >= SLOW_REQUEST_MS && !LONG_RUNNING.test(path)) log.warn(`Slow request: ${line}`);
    else log.debug(line);
  });

  app.setErrorHandler((error, request, reply) => {
    const err = error as Error & { statusCode?: number; validation?: unknown };
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.code(400).send({ error: first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input.' });
    }
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: err.message });
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status < 500) return reply.code(status).send({ error: err.message || 'Invalid request.' });
    log.error(`${request.method} ${request.url} failed`, err);
    const body: Record<string, unknown> = { error: 'Something went wrong.' };
    if (request.user?.role === 'admin') body.detail = { message: err.message, stack: err.stack };
    return reply.code(500).send(body);
  });

  await registerRoutes(app, ctx);

  // ---- frontend (production build)
  const frontendDir = ctx.config.frontendDir;
  if (frontendDir && fs.existsSync(path.join(frontendDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: frontendDir,
      prefix: '/',
      wildcard: false,
      index: false,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
        else res.header('Cache-Control', 'no-cache');
      },
    });
    // index.html is tiny; reading it per request means a rebuilt frontend is picked up without a restart.
    const indexPath = path.join(frontendDir, 'index.html');
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.method !== 'GET') {
        return reply.code(404).send({ error: 'Not found.' });
      }
      let file: string;
      try {
        file = path.join(frontendDir, decodeURIComponent(request.url.split('?')[0]));
      } catch {
        file = '';
      }
      if (file.startsWith(frontendDir + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        return reply.sendFile(path.relative(frontendDir, file));
      }
      return reply.type('text/html').header('Cache-Control', 'no-cache').send(fs.readFileSync(indexPath, 'utf8'));
    });
  } else {
    app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Not found.' }));
  }

  return app;
}
