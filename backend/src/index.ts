import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { buildApp, createContext } from './app.js';
import { checkBinary } from './services/probe.js';
import { createLogger } from './logger.js';
import { APP_VERSION } from './version.js';
import type { RemuxEngine } from './playback/remux.js';

const log = createLogger('velyx');

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundledFrontend = path.resolve(here, '..', '..', 'frontend', 'dist');
  const config = loadConfig(process.env, {
    ...(process.env.FRONTEND_DIR ? {} : { frontendDir: fs.existsSync(bundledFrontend) ? bundledFrontend : null }),
  });

  log.info(`Velyx ${APP_VERSION} starting`);
  const db = openDatabase(config.dbPath, { backupDir: config.backupDir });
  const ctx = createContext(config, db);

  const ffprobe = await checkBinary(config.ffprobePath);
  if (!ffprobe) log.warn(`FFprobe not found at "${config.ffprobePath}" — media analysis will fail`);
  if (!ctx.tmdb.configured) log.info('TMDB API key not set — metadata lookup disabled until one is added');
  const purged = ctx.sessions.purgeExpired();
  if (purged) log.info(`Removed ${purged} expired sessions`);

  const app = await buildApp(ctx);
  await app.listen({ port: config.port, host: config.host });
  log.info(`Velyx started on http://${config.host}:${config.port}`);
  if (!config.frontendDir) log.warn('Frontend build not found — only the API is served');

  ctx.scans.startSchedule(config.scanIntervalMinutes);
  ctx.watcher.sync(ctx.settings.get().watchFolders);
  const purgeTimer = setInterval(() => ctx.sessions.purgeExpired(), 6 * 60 * 60 * 1000);
  purgeTimer.unref();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Received ${signal}, shutting down`);
    ctx.scans.stop();
    ctx.watcher.stop();
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
