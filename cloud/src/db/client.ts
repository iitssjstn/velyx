import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
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
  // Works from src/db (tsx) and dist/db (compiled): the folder lives in cloud/drizzle.
  migrate(db, { migrationsFolder: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle') });
  return db;
}
