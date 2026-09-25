import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { DB } from '../db/client.js';

/** Writes a consistent copy of the live SQLite database (safe while Velyx is running). */
export function createDatabaseSnapshot(db: DB, dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `snapshot-${Date.now()}-${process.pid}.db`);
  db.$client.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  return target;
}

/**
 * Creates DATA_DIR/backups/velyx-backup-<timestamp>.tar.gz containing a database snapshot,
 * the session secret, avatars and the artwork/subtitle cache. Media files are never included.
 */
export function createFullBackup(db: DB, dataDir: string, backupDir: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const staging = fs.mkdtempSync(path.join(backupDir, 'staging-'));
  try {
    const snapshot = createDatabaseSnapshot(db, staging);
    fs.renameSync(snapshot, path.join(staging, 'velyx.db'));
    const archive = path.join(backupDir, `velyx-backup-${stamp}.tar.gz`);
    const extras = ['.session-secret', 'avatars', 'cache'].filter((p) => fs.existsSync(path.join(dataDir, p)));
    const res = spawnSync('tar', ['-czf', archive, '-C', staging, 'velyx.db', '-C', dataDir, ...extras], { stdio: 'pipe' });
    if (res.status !== 0) throw new Error(`tar failed: ${res.stderr.toString()}`);
    return archive;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
