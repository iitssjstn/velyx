import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export type DB = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export function openDatabase(file: string): DB {
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema }) as DB;
  // The folder lives in cloud/drizzle: two levels up from src/db or dist/db, one from the release bundle.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const nested = path.resolve(here, '..', '..', 'drizzle');
  migrate(db, { migrationsFolder: fs.existsSync(path.join(nested, 'meta', '_journal.json')) ? nested : path.resolve(here, '..', 'drizzle') });
  return db;
}
