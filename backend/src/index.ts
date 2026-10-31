import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { applyPendingRestore } from './services/backup.js';
import { buildApp, createContext } from './app.js';
import { pruneOnlineSubtitleFiles } from './routes/online-subtitles.js';
import { checkBinary } from './services/probe.js';
import { createLogger } from './logger.js';
import { APP_VERSION } from './version.js';
import type { RemuxEngine } from './playback/remux.js';
import { DirectHttpsService } from './services/direct-https.js';
import { startTrayBridge } from './services/tray.js';
import { SHARED_SYNC_MS } from './services/segments/shared.js';

const log = createLogger('vidalune');

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundledFrontend = path.resolve(here, '..', '..', 'frontend', 'dist');
  const config = loadConfig(process.env, {
    ...(process.env.FRONTEND_DIR ? {} : { frontendDir: fs.existsSync(bundledFrontend) ? bundledFrontend : null }),
  });

  log.info(`Vidalune ${APP_VERSION} starting`);
  // A restore staged from the admin page or CLI is applied before anything opens the database.
  const restored = applyPendingRestore(config.dbPath, config.dataDir, config.backupDir);
  const db = openDatabase(config.dbPath, { backupDir: config.backupDir });
  const ctx = createContext(config, db);
  if (restored) ctx.audit.record('database.restored', { actorName: restored.requestedBy, target: restored.source, detail: restored.safetyCopy ? `previous database kept as ${restored.safetyCopy.split('/').pop()}` : null });

  const ffprobe = await checkBinary(config.ffprobePath);
  if (!ffprobe) log.warn(`FFprobe not found at "${config.ffprobePath}" — media analysis will fail`);
  if (ctx.tmdb.via === 'vidalune') log.info('Metadata through vidalune.com (no TMDB key of its own)');
  else if (!ctx.tmdb.configured) log.info('No TMDB API key and not linked to a Vidalune account — metadata lookup disabled until one of them is set up');
  const purged = ctx.sessions.purgeExpired();
  if (purged) log.info(`Removed ${purged} expired sessions`);

  const app = await buildApp(ctx);
  const directHttps = new DirectHttpsService({ app, cloud: ctx.cloud, dataDir: config.dataDir, port: config.directTlsPort, host: config.host });
  await app.listen({ port: config.port, host: config.host });
  log.info(`Vidalune started on http://${config.host}:${config.port}`);
  if (!config.frontendDir) log.warn('Frontend build not found — only the API is served');

  ctx.scans.configureSchedule(ctx.settings.scanIntervalMinutes());
  if (ctx.settings.get().scanOnStartup) {
    // After start-up has settled, look for files added while Vidalune was off.
    setTimeout(() => {
      log.info('Scanning libraries for changes made while Vidalune was off');
      ctx.scans.enqueueAll(false);
    }, 60 * 1000).unref();
  }
  if (ctx.tmdb.configured && !ctx.settings.get().collectionsBackfilled) {
    void ctx.metadata.backfillCollections().then((done) => {
      if (done) ctx.settings.update({ collectionsBackfilled: true });
    });
  }
  // Titles and descriptions in the other interface language for items matched before 0.13 (a few
  // hundred at a time, never during a scan; nothing to do once all have them).
  const translate = () => {
    if (ctx.tmdb.configured && !ctx.scans.active) void ctx.metadata.backfillTranslations();
  };
  setTimeout(translate, 5 * 60 * 1000).unref();
  setInterval(translate, 30 * 60 * 1000).unref();
  // Episodes added while Vidalune was off (or never analysed) get their intros/credits found later on.
  setTimeout(() => ctx.segments.enqueuePending(), 3 * 60 * 1000).unref();
  ctx.subtitlePrefetch.start();
  ctx.watcher.sync(ctx.settings.get().watchFolders);
  ctx.backups.start();
  ctx.disk.start();
  ctx.cleanupScheduler.start();
  ctx.cloud.start();
  directHttps.start();
  // A backup missed while Vidalune was off runs shortly after start, not in the middle of it.
  setTimeout(() => void ctx.backups.tick(), 2 * 60 * 1000).unref();
  ctx.streams.closeInterrupted();
  ctx.streams.start();
  ctx.streams.purgeHistory();
  void pruneOnlineSubtitleFiles(db, ctx.config.onlineSubtitleDir);
  const purgeTimer = setInterval(() => {
    ctx.sessions.purgeExpired();
    ctx.streams.purgeHistory();
    void pruneOnlineSubtitleFiles(db, ctx.config.onlineSubtitleDir);
  }, 6 * 60 * 60 * 1000);
  purgeTimer.unref();
  // Shared detection: what other servers found since and corrections made on vidalune.com, every
  // few hours (never at start-up itself), so a correction reaches every server within that time.
  setTimeout(() => void ctx.sharedDetection.syncAll(), 10 * 60 * 1000).unref();
  setInterval(() => void ctx.sharedDetection.syncAll(), SHARED_SYNC_MS).unref();

  let shuttingDown = false;
  let stopTray = () => {};
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Received ${signal}, shutting down`);
    stopTray();
    ctx.scans.stop();
    ctx.segments.stop();
    ctx.subtitlePrefetch.stop();
    ctx.streams.stop();
    ctx.watcher.stop();
    ctx.backups.stop();
    ctx.disk.stop();
    ctx.cleanupScheduler.stop();
    ctx.cloud.shutdown();
    directHttps.stop();
    (ctx.playback.get('remux') as RemuxEngine | undefined)?.stopAll();
    ctx.hls.stopAll();
    clearInterval(purgeTimer);
    try {
      await app.close();
    } finally {
      db.$client.close();
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  // Started by the Windows tray program: tell it who is watching, and stop when it says so.
  stopTray = startTrayBridge({
    statusFile: process.env.STATUS_FILE || undefined,
    stopOnStdinEnd: process.env.STOP_ON_STDIN_END === '1',
    watching: () => ctx.streams.active().length,
    stop: (reason) => void shutdown(reason),
  });
}

main().catch((err) => {
  log.error('Fatal startup error', err);
  process.exit(1);
});
