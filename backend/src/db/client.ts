import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';
import { createLogger } from '../logger.js';

const log = createLogger('database');

export type DB = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Works both from src/db (tsx) and dist/db (compiled): the folder lives in backend/drizzle.
  return path.resolve(here, '..', '..', 'drizzle');
}

/** Number of migrations this version of Velyx ships. */
export function journalEntryCount(folder = migrationsFolder()): number {
  const journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] };
  return journal.entries.length;
}

function appliedMigrationCount(sqlite: Database.Database): number {
  const hasTable = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'").get();
  if (!hasTable) return 0;
  return (sqlite.prepare('SELECT COUNT(*) AS c FROM __drizzle_migrations').get() as { c: number }).c;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

/** Keeps the newest few automatic pre-migration copies. */
function prunePreMigrationCopies(dir: string, keep = 5): void {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^pre-migration-\d+\.db$/.test(f))
      .sort()
      .reverse();
    for (const f of files.slice(keep)) fs.rmSync(path.join(dir, f), { force: true });
  } catch {
    /* backup folder missing: nothing to prune */
  }
}

export interface OpenDbOptions {
  /** Directory in which a safety copy is written before applying migrations to an existing DB. */
  backupDir?: string;
  /** Override the migrations folder (tests). */
  migrationsFolder?: string;
}

export function openDatabase(file: string, opts: OpenDbOptions = {}): DB {
  const isNew = file === ':memory:' || !fs.existsSync(file);
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  const folder = opts.migrationsFolder ?? migrationsFolder();
  const shipped = journalEntryCount(folder);
  const applied = appliedMigrationCount(sqlite);
  if (applied > shipped) {
    sqlite.close();
    throw new MigrationError(
      `The database was created by a newer version of Velyx (${applied} migrations, this version knows ${shipped}). Velyx will not start, to avoid damaging it. Update Velyx, or restore a backup made with this version.`,
    );
  }
  const pending = shipped - applied;
  let safetyCopy: string | null = null;
  if (pending > 0) {
    if (!isNew && opts.backupDir) {
      fs.mkdirSync(opts.backupDir, { recursive: true });
      safetyCopy = path.join(opts.backupDir, `pre-migration-${Date.now()}.db`);
      sqlite.exec(`VACUUM INTO '${safetyCopy.replace(/'/g, "''")}'`);
      log.info(`Backed up database to ${safetyCopy} before migrating`);
      prunePreMigrationCopies(opts.backupDir);
    }
    log.info(`Applying ${pending} database migration(s)`);
  }
  const db = drizzle(sqlite, { schema }) as DB;
  try {
    // Drizzle applies all pending migrations in one transaction: on error nothing is changed.
    migrate(db, { migrationsFolder: folder });
  } catch (err) {
    sqlite.close();
    throw new MigrationError(
      `Database migration failed: ${(err as Error).message}. The database was left unchanged and Velyx did not start.${safetyCopy ? ` A copy from before the upgrade is at ${safetyCopy}.` : ''}`,
    );
  }
  if (pending > 0) {
    const check = sqlite.pragma('quick_check') as { quick_check: string }[];
    if (check[0]?.quick_check !== 'ok') {
      sqlite.close();
      throw new MigrationError(`The database failed its consistency check after migrating: ${check[0]?.quick_check}. Restore the backup at ${safetyCopy ?? 'data/backups'}.`);
    }
    log.info(`Database upgraded (${pending} migration(s) applied)`);
  }
  log.info('Database connected');
  return db;
}
