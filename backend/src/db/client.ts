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

function pendingMigrationCount(sqlite: Database.Database): number {
  const journalPath = path.join(migrationsFolder(), 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
  const hasTable = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'")
    .get();
  if (!hasTable) return journal.entries.length;
  const row = sqlite.prepare('SELECT COUNT(*) AS c FROM __drizzle_migrations').get() as { c: number };
  return Math.max(0, journal.entries.length - row.c);
}

export interface OpenDbOptions {
  /** Directory in which a safety copy is written before applying migrations to an existing DB. */
  backupDir?: string;
}

export function openDatabase(file: string, opts: OpenDbOptions = {}): DB {
  const isNew = file === ':memory:' || !fs.existsSync(file);
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  const pending = pendingMigrationCount(sqlite);
  if (pending > 0) {
    if (!isNew && opts.backupDir) {
      fs.mkdirSync(opts.backupDir, { recursive: true });
      const target = path.join(opts.backupDir, `pre-migration-${Date.now()}.db`);
      sqlite.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
      log.info(`Backed up database to ${target} before migrating`);
    }
    log.info(`Applying ${pending} database migration(s)`);
  }
  const db = drizzle(sqlite, { schema }) as DB;
  migrate(db, { migrationsFolder: migrationsFolder() });
  log.info('Database connected');
  return db;
}
