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
  if (!ctx.tmdb.configured) log.info('TMDB API key not set — metadata lookup disabled until one is added');
  const purged = ctx.sessions.purgeExpired();
  if (purged) log.info(`Removed ${purged} expired sessions`);

  const app = await buildApp(ctx);
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
  // Episodes added while Vidalune was off (or never analysed) get their intros/credits found later on.
  setTimeout(() => ctx.segments.enqueuePending(), 3 * 60 * 1000).unref();
  ctx.watcher.sync(ctx.settings.get().watchFolders);
  ctx.backups.start();
  ctx.disk.start();
  ctx.cleanupScheduler.start();
  ctx.cloud.start();
  // Opens the port on the router again after a restart (the lease may have run out).
  if (ctx.settings.get().upnp.enabled) void ctx.upnp.renew().then(() => ctx.upnp.start());
  // A backup missed while Vidalune was off runs shortly after start, not in the middle of it.
  setTimeout(() => ctx.backups.tick(), 2 * 60 * 1000).unref();
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

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Received ${signal}, shutting down`);
    ctx.scans.stop();
    ctx.segments.stop();
    ctx.streams.stop();
    ctx.watcher.stop();
    ctx.backups.stop();
    ctx.disk.stop();
    ctx.cleanupScheduler.stop();
    ctx.cloud.shutdown();
    ctx.upnp.stop();
    (ctx.playback.get('remux') as RemuxEngine | undefined)?.stopAll();
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
}

main().catch((err) => {
  log.error('Fatal startup error', err);
  process.exit(1);
});
