import os from 'node:os';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import fastifyCompress from '@fastify/compress';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import type { AppConfig } from './config.js';
import type { DB } from './db/client.js';
import { SESSION_COOKIE, SessionService, sessionCookieOptions, type SessionUser } from './auth/sessions.js';
import { SettingsService } from './services/settings.js';
import { TmdbClient, type FetchLike } from './services/tmdb.js';
import { OpenSubtitlesClient } from './services/opensubtitles.js';
import { HlsSessions } from './playback/hls.js';
import { workerFingerprintRunner, workerSeasonRunner } from './services/segments/season-runner.js';
import { APP_VERSION } from './version.js';
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
import { ffmpegAudioReader, SegmentDetector, type AudioReader } from './services/segments/detector.js';
import { SharedDetection } from './services/segments/shared.js';
import { ffmpegFrameReader, ffprobeChapterReader, type ChapterReader, type FrameReader } from './services/segments/readers.js';
import { PlaybackRegistry } from './playback/engine.js';
import { DirectPlayEngine } from './playback/direct-play.js';
import { RemuxEngine } from './playback/remux.js';
import { TranscodeEngine, TranscodingService, type EncoderSupport } from './playback/transcode.js';
import { createLogger } from './logger.js';
import { HttpError } from './http-error.js';
import { DEFAULT_LANGUAGE, hasTranslation, isLanguage, requestLanguage, tr } from './i18n/index.js';
import { registerRoutes } from './routes/index.js';
import { NotificationService } from './services/notifications.js';
import { CleanupScheduler } from './services/cleanup-scheduler.js';
import { CloudService } from './services/cloud.js';
import { UpnpService } from './services/upnp.js';
import { SeerrService } from './services/seerr.js';
import { isLoopback } from './services/relay-client.js';
import { libraries, subtitles as subtitleRows, users } from './db/schema.js';
import { castPath, verifyCastToken } from './services/cast.js';

const log = createLogger('http');
const SLOW_REQUEST_MS = 2000;
/** Responses that last as long as a transfer or a job (streams, backups): never "slow". */
const LONG_RUNNING = /^\/api\/(media\/\d+\/(stream|remux)|admin\/backups(\/.*)?)$/;

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    sessionToken: string | undefined;
    /** The device name of a Vidalune app session ("Pixel 8"); null for browsers. */
    appDevice: string | null;
    /** A Chromecast fetching with a cast token: the one file it may open. */
    castFile: number | null;
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
  /** Background intro and credits detection. */
  segments: SegmentDetector;
  /** Subtitle search and download (OpenSubtitles.com), when an API key is set. */
  openSubtitles: OpenSubtitlesClient;
  /** Messages for administrators (bell in the admin pages, optional Discord webhook). */
  notifications: NotificationService;
  /** Carries out own clean-up rules that plan deletions. */
  cleanupScheduler: CleanupScheduler;
  /** Link to a Vidalune account (opt-in). */
  cloud: CloudService;
  sharedDetection: SharedDetection;
  /** Opening a port on the router (opt-in). */
  upnp: UpnpService;
  /** Requests through Seerr (optional). */
  seerr: SeerrService;
  /** Converting video (opt-in) and the encoders this server has. */
  transcoding: TranscodingService;
  /** HLS pieces being made for players (the website). */
  hls: HlsSessions;
  startedAt: number;
}

/** More than 60 % of the processors in use (load average; always false where there is none). */
export function machineBusy(): boolean {
  return os.loadavg()[0] / Math.max(1, os.cpus().length) > 0.6;
}

export interface BuildOptions {
  /** Whether the machine counts as busy (tests). */
  machineBusy?: () => boolean;
  /** Pause after each read while someone watches (tests: shorter). */
  segmentPaceMs?: number;
  /** Where UPnP searches for the router (tests: a stand-in on localhost). */
  ssdp?: { host: string; port: number };
  prober?: Prober;
  fetchImpl?: FetchLike;
  tmdbMinIntervalMs?: number;
  /** Quiet period before a folder change triggers a scan (default 30 s). */
  watchDebounceMs?: number;
  /** Pause between scanned files while someone is watching (default 250 ms). */
  scanYieldMs?: number;
  /** Audio source for intro/credits detection (tests pass synthetic audio). */
  audioReader?: AudioReader;
  /** Checks which video encoders work (tests pass a stand-in). */
  encoderDetector?: (ffmpegPath: string) => Promise<EncoderSupport>;
  /** Video frames and chapters for intro/credits detection; null turns the source off (tests). */
  frameReader?: FrameReader | null;
  chapterReader?: ChapterReader | null;
  /** How often waiting intro/credits detection looks again (default 30 s). */
  segmentRetryMs?: number;
  /** The clock of the account service link (tests move it on). */
  cloudNow?: () => number;
}

export function createContext(config: AppConfig, db: DB, opts: BuildOptions = {}): AppContext {
  const settings = new SettingsService(db, config);
  const notifications = new NotificationService(db, settings, opts.fetchImpl);
  const libraryName = (id: number) => db.select({ name: libraries.name }).from(libraries).where(eq(libraries.id, id)).get()?.name ?? `#${id}`;
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
  const streams = new StreamTracker(db);
  const scans: ScanManager = new ScanManager(db, scanner, {
    playbackActive: () => streams.active().length > 0,
    deferWhilePlaying: () => settings.get().deferScansWhilePlaying,
    yieldMs: opts.scanYieldMs,
    // New episodes are analysed once scanning is done; own clean-up rules look at the new state.
    onIdle: () => {
      segments.enqueuePending();
      cleanupScheduler.run();
    },
    onScanDone: (libraryId, summary) => {
      if (summary.added > 0) notifications.notify('newMedia', { library: libraryName(libraryId), count: summary.added });
    },
    onScanFailed: (libraryId, message) => notifications.notify('scanFailed', { library: libraryName(libraryId), reason: message }),
  });
  const cloud = new CloudService({ baseUrl: config.cloudUrl, settings, version: APP_VERSION, fetchImpl: opts.fetchImpl, localPort: config.port, now: opts.cloudNow });
  const sharedDetection = new SharedDetection(db, cloud, () => settings.get().sharedDetection);
  const segments: SegmentDetector = new SegmentDetector(db, opts.audioReader ?? ffmpegAudioReader(config.ffmpegPath), {
    enabled: () => settings.get().segmentDetection,
    // Watching does not stop detection: it goes slower, and waits only when the machine is busy.
    busy: () => (scans.active ? 'scan' : streams.active().length > 0 && (opts.machineBusy ?? machineBusy)() ? 'playback' : null),
    pace: () => (streams.active().length > 0 ? (opts.segmentPaceMs ?? 3000) : 0),
    video: () => settings.get().segmentVideo,
    retryMs: opts.segmentRetryMs,
    shared: sharedDetection,
    // Built server: a season is calculated in a thread of its own, so the server keeps answering.
    runSeason: workerSeasonRunner(new URL('./season-worker.js', import.meta.url)),
    fingerprint: workerFingerprintRunner(new URL('./season-worker.js', import.meta.url)),
  }, {
    frames: opts.frameReader === null ? undefined : (opts.frameReader ?? ffmpegFrameReader(config.ffmpegPath)),
    chapters: opts.chapterReader === null ? undefined : (opts.chapterReader ?? ffprobeChapterReader(config.ffprobePath)),
  });
  const watcher = new LibraryWatcher(db, scans, opts.watchDebounceMs);
  const playback = new PlaybackRegistry();
  playback.register(new DirectPlayEngine());
  const transcoding = new TranscodingService(config.ffmpegPath, () => settings.get().transcoding, opts.encoderDetector);
  playback.register(new RemuxEngine(config.ffmpegPath, () => transcoding.current()));
  // Last: only what neither plays as it is nor after repackaging is converted, when that is on.
  playback.register(new TranscodeEngine(() => transcoding.current()));
  const subtitleExtractor = new EmbeddedSubtitleExtractor(config.ffmpegPath, config.subtitleCacheDir);
  const storage = new StorageService(db, config);
  // Critically low disk space pauses scans (which write artwork and rows); they resume on their own.
  const disk = new DiskMonitor(storage, (level, info) => {
    if (level === 'critical') scans.pause('low-disk');
    else scans.resume('low-disk');
    if (level !== 'ok') notifications.notify('storageLow', { disk: 'Vidalune data', free: `${(info.free / 1024 ** 3).toFixed(1)} GB` });
  });
  const backups = new BackupScheduler(
    db,
    config.backupDir,
    settings,
    () => (storage.dataDisk()?.level === 'critical' ? 'disk space is critically low' : null),
    (reason) => notifications.notify('backupFailed', { reason }),
  );
  const audit = new AuditLog(db);
  const cleanupScheduler: CleanupScheduler = new CleanupScheduler({
    db,
    settings,
    audit,
    notifications,
    playing: () => new Set(streams.active().map((s) => s.mediaFileId)),
    rescan: (libraryId) => scans.enqueue(libraryId),
  });
  // Subtitles come through vidalune.com. A key this server kept from before 0.18.1 is no longer used: forgotten.
  for (const k of ['openSubtitlesApiKey', 'openSubtitlesUsername', 'openSubtitlesPassword'] as const) if (settings.get()[k]) settings.delete(k);
  const openSubtitles = new OpenSubtitlesClient({ vidalune: cloud });
  return { config, db, settings, sessions, tmdb, images, metadata, scanner, scans, watcher, playback, subtitleExtractor, access: new LibraryAccess(db), audit, backups, storage, disk, streams, analyzer: new DetailAnalyzer(db, probe), updates: new UpdateChecker(config.updateUrl, () => settings.get().updateCheck, opts.fetchImpl), probe, segments, openSubtitles, notifications, cleanupScheduler, cloud, sharedDetection, upnp: new UpnpService({ settings, localPort: config.port, fetchImpl: opts.fetchImpl, ssdp: opts.ssdp }), seerr: new SeerrService({ settings, fetchImpl: opts.fetchImpl }), transcoding, hls: new HlsSessions(config.ffmpegPath, config.ffprobePath, path.join(config.cacheDir, 'hls')), startedAt: Date.now() };
}

export function requireUser(request: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void): void {
  if (!request.user) {
    reply.code(401).send({ error: tr(requestLanguage(request), 'Sign in to continue.') });
    return;
  }
  done();
}

export function requireAdmin(request: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void): void {
  if (!request.user) {
    reply.code(401).send({ error: tr(requestLanguage(request), 'Sign in to continue.') });
    return;
  }
  if (request.user.role !== 'admin') {
    reply.code(403).send({ error: tr(requestLanguage(request), 'Only administrators can do this.') });
    return;
  }
  done();
}

/**
 * Which proxies in front of Vidalune are believed about the visitor's address and HTTPS. A hop count
 * trusts exactly that many (e.g. 2 for Cloudflare + Nginx). Requests from this machine itself are
 * always believed: that is the Vidalune relay client, passing on who really asked.
 */
export function trustProxy(setting: AppConfig['trustProxy']): ((addr: string, hop: number) => boolean) | string[] {
  // A list of proxy addresses: Fastify's own "loopback" entry adds this machine.
  if (Array.isArray(setting)) return [...setting, 'loopback'];
  const configured = setting === true ? () => true : typeof setting === 'number' ? (_addr: string, hop: number) => hop < setting : () => false;
  return (addr, hop) => (hop === 0 && isLoopback(addr)) || configured(addr, hop);
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    trustProxy: trustProxy(ctx.config.trustProxy),
    bodyLimit: 4 * 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        // The HLS player (hls.js) prepares video pieces in a worker it starts from a blob.
        workerSrc: ["'self'", 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", 'data:'],
        // Google's Cast SDK (casting to a Chromecast from Chrome), loaded only when a player opens.
        scriptSrc: ["'self'", 'https://www.gstatic.com'],
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
  app.decorateRequest('appDevice', null);
  app.decorateRequest('castFile', null);

  // Resolve the session for every API request.
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    // A Chromecast (it cannot sign in): a short-lived token that opens one file's stream,
    // subtitles and artwork, for the user who cast it — never anything else, never with a cookie.
    const castToken = (request.query as { cast?: unknown } | undefined)?.cast;
    if (castToken !== undefined) {
      const claims = typeof castToken === 'string' ? verifyCastToken(ctx.config.sessionSecret, castToken) : null;
      const target = castPath(request.url.split('?')[0]);
      if (!claims || !target || (request.method !== 'GET' && request.method !== 'HEAD')) return;
      const allowed =
        target === 'image' ||
        ('fileId' in target && target.fileId === claims.fileId) ||
        ('subtitleId' in target && ctx.db.select({ file: subtitleRows.mediaFileId }).from(subtitleRows).where(eq(subtitleRows.id, target.subtitleId)).get()?.file === claims.fileId);
      if (!allowed) return;
      const u = ctx.db.select().from(users).where(eq(users.id, claims.userId)).get();
      if (!u || u.disabled) return;
      request.user = { id: u.id, username: u.username, displayName: u.displayName, role: u.role, avatarFile: u.avatarFile, language: isLanguage(u.language) ? u.language : DEFAULT_LANGUAGE };
      request.castFile = claims.fileId;
      request.appDevice = 'Chromecast';
      return;
    }
    // The Vidalune app sends its token as "Authorization: Bearer …" instead of a cookie. Only tokens
    // handed out to the app are accepted this way, never a browser's session.
    const auth = request.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const token = auth.slice(7).trim();
      const resolved = ctx.sessions.resolveSession(token, request.ip);
      if (resolved?.client === 'app') {
        request.sessionToken = token;
        request.user = resolved.user;
        request.appDevice = resolved.deviceName ?? 'Vidalune app';
      }
      return;
    }
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return;
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;
    const resolved = ctx.sessions.resolveSession(unsigned.value, request.ip);
    if (resolved?.client === 'app') return;
    request.sessionToken = unsigned.value;
    request.user = resolved?.user ?? null;
    // The session was extended on the server: renew the cookie too, or the browser would still
    // drop it when the original sign-in expires, however often Vidalune is used.
    if (resolved?.extended) reply.setCookie(SESSION_COOKIE, unsigned.value, sessionCookieOptions(ctx.config.cookieSecure, request.protocol, ctx.sessions.ttlMs));
  });

  // A Chromecast loads the stream and subtitles from its own page (another origin): allowed for
  // requests opened by a cast token only.
  app.addHook('onSend', async (request, reply) => {
    if (request.castFile === null) return;
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    reply.header('Access-Control-Allow-Origin', '*');
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
        return reply.code(403).send({ error: tr(requestLanguage(request), 'Invalid request origin.') });
      }
      const expected = request.headers['x-forwarded-host'] && ctx.config.trustProxy ? String(request.headers['x-forwarded-host']) : request.headers.host;
      if (host !== expected) return reply.code(403).send({ error: tr(requestLanguage(request), 'Cross-site requests are not allowed.') });
    }
    const ct = request.headers['content-type'];
    if (ct && !ct.startsWith('application/json')) return reply.code(415).send({ error: tr(requestLanguage(request), 'Requests must be JSON.') });
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
    const lang = requestLanguage(request);
    if (err instanceof ZodError) {
      const first = err.issues[0];
      if (!first) return reply.code(400).send({ error: tr(lang, 'Invalid input.') });
      const field = first.path.join('.') || 'input';
      // Messages written for Vidalune are translated; library defaults are replaced by a plain one.
      const message = lang === 'en' || hasTranslation(first.message) ? tr(lang, first.message) : tr(lang, 'This value is not valid.');
      return reply.code(400).send({ error: `${field}: ${message}` });
    }
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: tr(lang, err.message, err.params) });
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status < 500) return reply.code(status).send({ error: err.message && lang === 'en' ? err.message : tr(lang, 'Invalid request.') });
    log.error(`${request.method} ${request.url} failed`, err);
    const body: Record<string, unknown> = { error: tr(lang, 'Something went wrong.') };
    if (request.user?.role === 'admin') body.detail = { message: err.message, stack: err.stack };
    return reply.code(500).send(body);
  });

  // Text (JSON, subtitles, scripts) is sent compressed when the client accepts it. gzip only: cheap
  // enough for old hardware. Video, audio and images are already compressed and stay seekable.
  await app.register(fastifyCompress, { encodings: ['gzip'], threshold: 2048, customTypes: /^(?:application\/(?:json|javascript|manifest\+json)|text\/)/ });

  await registerRoutes(app, ctx);

  // ---- frontend (production build)
  const frontendDir = ctx.config.frontendDir;
  if (frontendDir && fs.existsSync(path.join(frontendDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: frontendDir,
      prefix: '/',
      wildcard: false,
      index: false,
      // The build writes .br and .gz next to scripts and styles: served as they are, no work per request.
      preCompressed: true,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
        else res.header('Cache-Control', 'no-cache');
      },
    });
    // index.html is tiny; reading it per request means a rebuilt frontend is picked up without a restart.
    const indexPath = path.join(frontendDir, 'index.html');
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.method !== 'GET') {
        return reply.code(404).send({ error: tr(requestLanguage(request), 'Not found.') });
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
    app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: tr(requestLanguage(_request), 'Not found.') }));
  }

  return app;
}
