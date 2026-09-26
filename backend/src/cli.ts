/**
 * Maintenance commands, run inside the container:
 *   docker compose exec velyx velyx backup                 full archive (database, avatars, cache)
 *   docker compose exec velyx velyx backup list            list backups
 *   docker compose exec velyx velyx backup verify [name]   verify one backup, or all of them
 *   docker compose exec velyx velyx restore <name|path>    restore on the next start
 *   docker compose exec velyx velyx restore --cancel       cancel a staged restore
 *   docker compose exec velyx velyx reset-password <username> <new-password>
 *   docker compose exec velyx velyx scan [--refresh-metadata]
 *   docker compose exec velyx velyx intros ["show title"|show-id] [season]
 */
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { loadConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { users } from './db/schema.js';
import { hashPassword, validatePassword } from './auth/password.js';
import { SessionService } from './auth/sessions.js';
import { backupPath, cancelRestore, createFullBackup, listBackups, stageRestore, verifyBackup } from './services/backup.js';
import { createContext } from './app.js';
import { episodes, shows } from './db/schema.js';
import { ffmpegAudioReader, SegmentDetector } from './services/segments/detector.js';
import { formatDiagnosis } from './services/segments/diagnose.js';
import { ffmpegFrameReader, ffprobeChapterReader } from './services/segments/readers.js';
import { setLogLevel } from './logger.js';

const HELP = `Velyx maintenance commands:
  backup                     create a full backup archive (database, avatars, cache)
  backup list                list backups in the data folder
  backup verify [name|path]  check backups can be restored (all when no name is given)
  restore <name|path>        restore a backup when Velyx next starts
  restore --cancel           cancel a staged restore
  reset-password <username> <new-password>
  scan [--refresh-metadata]
  intros                     list TV shows (for the next command)
  intros <show> [season]     explain intro/credits detection for one season (stores nothing;
                             --no-video skips the picture analysis)`;

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

async function run(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  let args = rest;
  const config = loadConfig();
  if (cmd !== 'scan') setLogLevel('warn');
  const resolve = (arg: string) => backupPath(config.backupDir, arg) ?? (fs.existsSync(arg) ? path.resolve(arg) : null);

  switch (cmd) {
    case 'backup': {
      if (args[0] === 'list') {
        const list = listBackups(config.backupDir);
        if (!list.length) console.log(`No backups in ${config.backupDir}`);
        for (const b of list) console.log(`${new Date(b.createdAt).toISOString().replace('T', ' ').slice(0, 19)}  ${b.kind.padEnd(13)} ${formatSize(b.size).padStart(9)}  ${b.name}`);
        return 0;
      }
      if (args[0] === 'verify') {
        const targets = args[1] ? [args[1]] : listBackups(config.backupDir).map((b) => b.name);
        if (!targets.length) {
          console.log('No backups to verify.');
          return 0;
        }
        let failed = 0;
        for (const t of targets) {
          const file = resolve(t);
          const r = file ? verifyBackup(file) : { ok: false, errors: ['Backup not found.'], info: null };
          if (!r.ok) failed++;
          const summary = r.info ? ` (${r.info.users ?? '?'} users, ${r.info.movies ?? '?'} movies, ${r.info.shows ?? '?'} shows)` : '';
          console.log(`${r.ok ? 'OK    ' : 'FAILED'}  ${path.basename(t)}${r.ok ? summary : `: ${r.errors.join(' ')}`}`);
        }
        return failed ? 1 : 0;
      }
      if (args[0]) {
        console.error(HELP);
        return 2;
      }
      const db = openDatabase(config.dbPath, { backupDir: config.backupDir });
      const file = createFullBackup(db, config.dataDir, config.backupDir);
      const r = verifyBackup(file);
      console.log(`Backup written to ${file}${r.ok ? ' (verified)' : ` — WARNING: verification failed: ${r.errors.join(' ')}`}`);
      return r.ok ? 0 : 1;
    }
    case 'restore': {
      if (args[0] === '--cancel') {
        console.log(cancelRestore(config.dataDir) ? 'Staged restore cancelled.' : 'No restore was staged.');
        return 0;
      }
      const file = args[0] ? resolve(args[0]) : null;
      if (!file) {
        console.error(args[0] ? `Backup "${args[0]}" not found.` : 'Usage: velyx restore <backup name or path>');
        return 2;
      }
      stageRestore(file, config.dataDir, 'CLI');
      console.log(`Restore of ${path.basename(file)} is staged. Restart Velyx to apply it:\n  docker compose restart velyx\nThe current database is kept as a pre-restore backup.`);
      return 0;
    }
    case 'reset-password': {
      const [username, password] = args;
      if (!username || !password) {
        console.error('Usage: velyx reset-password <username> <new-password>');
        return 2;
      }
      const err = validatePassword(password);
      if (err) {
        console.error(err);
        return 2;
      }
      const db = openDatabase(config.dbPath, { backupDir: config.backupDir });
      const user = db.select().from(users).where(eq(users.username, username)).get();
      if (!user) {
        console.error(`User "${username}" not found`);
        return 1;
      }
      db.update(users).set({ passwordHash: await hashPassword(password), disabled: false, updatedAt: Date.now() }).where(eq(users.id, user.id)).run();
      new SessionService(db, config.sessionTtlDays).destroyAllForUser(user.id);
      console.log(`Password for "${username}" updated and account enabled`);
      return 0;
    }
    case 'scan': {
      const db = openDatabase(config.dbPath, { backupDir: config.backupDir });
      const ctx = createContext(config, db);
      ctx.scans.enqueueAll(args.includes('--refresh-metadata'));
      await ctx.scans.whenIdle();
      return 0;
    }
    case 'intros': {
      const flags = args.filter((a) => a.startsWith('--'));
      args = args.filter((a) => !a.startsWith('--'));
      const db = openDatabase(config.dbPath, { backupDir: config.backupDir });
      const all = db.select({ id: shows.id, title: shows.title }).from(shows).orderBy(shows.sortTitle).all();
      if (!args[0]) {
        for (const s of all) console.log(`${String(s.id).padStart(5)}  ${s.title}`);
        return 0;
      }
      const q = args[0].toLowerCase();
      const show = all.find((s) => String(s.id) === args[0]) ?? all.find((s) => s.title.toLowerCase() === q) ?? all.find((s) => s.title.toLowerCase().includes(q));
      if (!show) {
        console.error(`No show matches "${args[0]}". Run "velyx intros" for the list.`);
        return 1;
      }
      const seasons = [...new Set(db.select({ s: episodes.seasonNumber }).from(episodes).where(eq(episodes.showId, show.id)).all().map((r) => r.s))].sort((a, b) => a - b);
      const season = args[1] !== undefined ? Number(args[1]) : (seasons.find((s) => s > 0) ?? seasons[0]);
      if (season === undefined || !seasons.includes(season)) {
        console.error(`${show.title} has seasons: ${seasons.join(', ') || 'none'}`);
        return 1;
      }
      console.error(`Analysing ${show.title} season ${season} (audio, chapters${flags.includes('--no-video') ? '' : ' and picture'})… nothing is stored`);
      const detector = new SegmentDetector(db, ffmpegAudioReader(config.ffmpegPath), { enabled: () => true, busy: () => null, video: () => !flags.includes('--no-video') }, { frames: ffmpegFrameReader(config.ffmpegPath), chapters: ffprobeChapterReader(config.ffprobePath) });
      console.log(formatDiagnosis(show.title, season, await detector.diagnose(show.id, season)));
      return 0;
    }
    default:
      console.log(HELP);
      return cmd ? 2 : 0;
  }
}

run().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
