import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import type { DB } from '../db/client.js';
import { journalEntryCount } from '../db/client.js';
import { tr, type Language } from '../i18n/index.js';
import { createLogger } from '../logger.js';

const log = createLogger('backup');

/** Writes a consistent copy of the live SQLite database (safe while Velyx is running). */
export function createDatabaseSnapshot(db: DB, dir: string, name?: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name ?? `snapshot-${Date.now()}-${process.pid}.db`);
  db.$client.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  return target;
}

export function timestamp(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * Creates DATA_DIR/backups/velyx-backup-<timestamp>.tar.gz containing a database snapshot,
 * the session secret, avatars and the artwork/subtitle cache. Media files are never included.
 */
export function createFullBackup(db: DB, dataDir: string, backupDir: string): string {
  fs.mkdirSync(backupDir, { recursive: true });
  const staging = fs.mkdtempSync(path.join(backupDir, 'staging-'));
  try {
    const snapshot = createDatabaseSnapshot(db, staging);
    fs.renameSync(snapshot, path.join(staging, 'velyx.db'));
    const archive = path.join(backupDir, `velyx-backup-${timestamp()}.tar.gz`);
    const extras = ['.session-secret', 'avatars', 'cache'].filter((p) => fs.existsSync(path.join(dataDir, p)));
    const res = spawnSync('tar', ['-czf', archive, '-C', staging, 'velyx.db', '-C', dataDir, ...extras], { stdio: 'pipe' });
    if (res.status !== 0) throw new Error(`tar failed: ${res.stderr.toString()}`);
    return archive;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- listing

export type BackupKind = 'auto' | 'manual' | 'archive' | 'pre-migration' | 'pre-restore';

export interface BackupFile {
  name: string;
  kind: BackupKind;
  size: number;
  createdAt: number;
}

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(db|tar\.gz)$/;

export function kindOf(name: string): BackupKind | null {
  if (!NAME_RE.test(name)) return null;
  if (name.startsWith('velyx-auto-')) return 'auto';
  if (name.startsWith('velyx-manual-')) return 'manual';
  if (name.startsWith('velyx-backup-') && name.endsWith('.tar.gz')) return 'archive';
  if (name.startsWith('pre-migration-')) return 'pre-migration';
  if (name.startsWith('pre-restore-')) return 'pre-restore';
  return null;
}

export function listBackups(dir: string): BackupFile[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: BackupFile[] = [];
  for (const name of names) {
    const kind = kindOf(name);
    if (!kind) continue;
    try {
      const st = fs.statSync(path.join(dir, name));
      if (st.isFile()) out.push({ name, kind, size: st.size, createdAt: st.mtimeMs });
    } catch {
      /* removed meanwhile */
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** Resolves a backup name inside the backup folder, refusing anything that is not a plain backup file name. */
export function backupPath(dir: string, name: string): string | null {
  if (!kindOf(name) || name.includes('/') || name.includes('\\')) return null;
  const full = path.join(dir, name);
  return path.dirname(full) === path.resolve(dir) && fs.existsSync(full) ? full : null;
}

// ---------------------------------------------------------------- retention

export interface RetentionPolicy {
  daily: number;
  weekly: number;
  monthly: number;
}

function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)}`;
}

/**
 * Grandfather-father-son rotation: the newest backup of each of the last `daily` days, of the last
 * `weekly` ISO weeks and of the last `monthly` months is kept. Returns the names to keep.
 */
export function retainedBackups(backups: Pick<BackupFile, 'name' | 'createdAt'>[], policy: RetentionPolicy): Set<string> {
  const sorted = [...backups].sort((a, b) => b.createdAt - a.createdAt);
  const keep = new Set<string>();
  const pick = (bucket: (d: Date) => string, count: number) => {
    const seen = new Set<string>();
    for (const b of sorted) {
      if (seen.size >= count) break;
      const key = bucket(new Date(b.createdAt));
      if (seen.has(key)) continue;
      seen.add(key);
      keep.add(b.name);
    }
  };
  pick((d) => d.toISOString().slice(0, 10), policy.daily);
  pick(isoWeek, policy.weekly);
  pick((d) => d.toISOString().slice(0, 7), policy.monthly);
  return keep;
}

// ---------------------------------------------------------------- verification

export interface VerifyResult {
  ok: boolean;
  errors: string[];
  info: { size: number; migrations: number | null; users: number | null; movies: number | null; shows: number | null } | null;
}

const REQUIRED_TABLES = ['users', 'sessions', 'settings', 'libraries', 'movies', 'shows', 'seasons', 'episodes', 'media_files', 'watch_progress', 'favorites', '__drizzle_migrations'];

/** Extracts velyx.db from a full-backup archive into a temporary folder. */
function extractArchiveDb(archive: string): { file: string; cleanup: () => void } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-verify-'));
  const res = spawnSync('tar', ['-xzf', archive, '-C', tmp, 'velyx.db'], { stdio: 'pipe' });
  const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
  if (res.status !== 0) {
    cleanup();
    throw new Error(`The archive could not be read: ${res.stderr.toString().trim() || 'tar failed'}`);
  }
  return { file: path.join(tmp, 'velyx.db'), cleanup };
}

/**
 * Checks that a backup can be restored: the file exists, is a readable SQLite database that passes
 * PRAGMA integrity_check, has Velyx's tables, and is not from a newer Velyx than this one.
 */
export function verifyBackup(file: string, lang: Language = 'en'): VerifyResult {
  const errors: string[] = [];
  if (!fs.existsSync(file)) return { ok: false, errors: [tr(lang, 'The backup file does not exist.')], info: null };
  const size = fs.statSync(file).size;
  let dbFile = file;
  let cleanup = () => undefined as void;
  if (file.endsWith('.tar.gz')) {
    try {
      const x = extractArchiveDb(file);
      dbFile = x.file;
      cleanup = x.cleanup;
    } catch (err) {
      return { ok: false, errors: [(err as Error).message], info: { size, migrations: null, users: null, movies: null, shows: null } };
    }
  }
  let sqlite: Database.Database | null = null;
  try {
    sqlite = new Database(dbFile, { readonly: true, fileMustExist: true });
    const integrity = sqlite.pragma('integrity_check') as { integrity_check: string }[];
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok') {
      errors.push(tr(lang, 'SQLite integrity check failed: {detail}', { detail: integrity.slice(0, 3).map((r) => r.integrity_check).join('; ') }));
    }
    const tables = new Set((sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
    const missing = REQUIRED_TABLES.filter((t) => !tables.has(t));
    if (missing.length) errors.push(tr(lang, 'Not a complete Velyx database (missing: {tables}).', { tables: missing.join(', ') }));
    const count = (table: string) => (tables.has(table) ? (sqlite!.prepare(`SELECT count(*) AS n FROM "${table}"`).get() as { n: number }).n : null);
    const migrations = count('__drizzle_migrations');
    if (migrations !== null && migrations > journalEntryCount()) errors.push(tr(lang, 'This backup is from a newer version of Velyx. Update Velyx before restoring it.'));
    return { ok: errors.length === 0, errors, info: { size, migrations, users: count('users'), movies: count('movies'), shows: count('shows') } };
  } catch (err) {
    return { ok: false, errors: [tr(lang, 'Not a readable SQLite database: {error}', { error: (err as Error).message })], info: { size, migrations: null, users: null, movies: null, shows: null } };
  } finally {
    sqlite?.close();
    cleanup();
  }
}

// ---------------------------------------------------------------- restore

export const PENDING_RESTORE = 'restore-pending.db';

/**
 * Stages a backup to replace the database on the next start. Restoring under a running server
 * could lose writes or mix WAL files, so the swap happens in openDatabase() before anything uses
 * the database, after a safety copy of the current one.
 */
export function stageRestore(backupFile: string, dataDir: string, requestedBy: string, lang: Language = 'en'): void {
  const result = verifyBackup(backupFile, lang);
  if (!result.ok) throw new Error(tr(lang, 'The backup did not pass verification: {errors}', { errors: result.errors.join(' ') }));
  const target = path.join(dataDir, PENDING_RESTORE);
  if (backupFile.endsWith('.tar.gz')) {
    const x = extractArchiveDb(backupFile);
    try {
      fs.copyFileSync(x.file, target);
    } finally {
      x.cleanup();
    }
  } else {
    fs.copyFileSync(backupFile, target);
  }
  fs.writeFileSync(`${target}.json`, JSON.stringify({ source: path.basename(backupFile), requestedBy, requestedAt: Date.now() }));
  log.info(`Restore of ${path.basename(backupFile)} staged; it is applied when Velyx next starts`);
}

export function pendingRestore(dataDir: string): { source: string; requestedBy: string; requestedAt: number } | null {
  const target = path.join(dataDir, PENDING_RESTORE);
  if (!fs.existsSync(target)) return null;
  try {
    return JSON.parse(fs.readFileSync(`${target}.json`, 'utf8'));
  } catch {
    return { source: 'unknown', requestedBy: 'unknown', requestedAt: fs.statSync(target).mtimeMs };
  }
}

export function cancelRestore(dataDir: string): boolean {
  const target = path.join(dataDir, PENDING_RESTORE);
  if (!fs.existsSync(target)) return false;
  fs.rmSync(target, { force: true });
  fs.rmSync(`${target}.json`, { force: true });
  return true;
}

/**
 * Applies a staged restore (called before the database is opened). The current database is kept as
 * backups/pre-restore-<timestamp>.db. Returns what was restored, or null when nothing was pending.
 */
export function applyPendingRestore(dbPath: string, dataDir: string, backupDir: string): { source: string; requestedBy: string; safetyCopy: string | null } | null {
  const staged = path.join(dataDir, PENDING_RESTORE);
  if (!fs.existsSync(staged)) return null;
  const meta = pendingRestore(dataDir)!;
  const check = verifyBackup(staged);
  if (!check.ok) {
    fs.renameSync(staged, `${staged}.rejected`);
    fs.rmSync(`${staged}.json`, { force: true });
    throw new Error(`The staged restore failed verification and was not applied: ${check.errors.join(' ')}`);
  }
  let safetyCopy: string | null = null;
  if (fs.existsSync(dbPath)) {
    fs.mkdirSync(backupDir, { recursive: true });
    safetyCopy = path.join(backupDir, `pre-restore-${timestamp()}.db`);
    // Checkpoint the WAL into the main file so the copy is complete.
    const current = new Database(dbPath);
    try {
      current.pragma('wal_checkpoint(TRUNCATE)');
      current.exec(`VACUUM INTO '${safetyCopy.replace(/'/g, "''")}'`);
    } finally {
      current.close();
    }
  }
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbPath + suffix, { force: true });
  fs.renameSync(staged, dbPath);
  fs.rmSync(`${staged}.json`, { force: true });
  log.info(`Database restored from ${meta.source}${safetyCopy ? ` (previous database saved as ${path.basename(safetyCopy)})` : ''}`);
  return { source: meta.source, requestedBy: meta.requestedBy, safetyCopy };
}
