import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { MigrationError, migrationsFolder, openDatabase } from '../src/db/client.js';
import { applyPendingRestore, createFullBackup, retainedBackups, stageRestore, verifyBackup } from '../src/services/backup.js';
import { backupDue, lastSlot } from '../src/services/backup-scheduler.js';
import { createTestEnv, createUser, setupAdmin, type TestEnv } from './helpers.js';

let env: TestEnv | null = null;
const tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-backup-test-'));
  tmpDirs.push(d);
  return d;
}
afterEach(async () => {
  await env?.cleanup();
  env = null;
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const DAY = 86_400_000;

describe('retention', () => {
  it('keeps 7 daily, 4 weekly and 3 monthly backups', () => {
    const start = Date.UTC(2026, 0, 1, 3);
    const backups = Array.from({ length: 150 }, (_, i) => ({ name: `b${i}`, createdAt: start + i * DAY }));
    const keep = retainedBackups(backups, { daily: 7, weekly: 4, monthly: 3 });
    const kept = backups.filter((b) => keep.has(b.name));
    // The newest 7 days are kept...
    for (let i = 143; i < 150; i++) expect(keep.has(`b${i}`)).toBe(true);
    // ...plus one per week and month, and nothing else.
    expect(kept.length).toBeLessThanOrEqual(7 + 4 + 3);
    expect(kept.length).toBeGreaterThanOrEqual(9);
    const oldest = Math.min(...kept.map((b) => b.createdAt));
    expect(start + 150 * DAY - oldest).toBeGreaterThan(60 * DAY);
  });

  it('schedules daily and weekly backups after the configured hour', () => {
    const now = new Date(2026, 8, 26, 10, 0);
    expect(lastSlot(now, 3).getHours()).toBe(3);
    expect(backupDue('daily', 3, null, now)).toBe(true);
    expect(backupDue('daily', 3, new Date(2026, 8, 26, 3, 5).getTime(), now)).toBe(false);
    expect(backupDue('daily', 3, new Date(2026, 8, 25, 23, 0).getTime(), now)).toBe(true);
    expect(backupDue('daily', 12, new Date(2026, 8, 25, 12, 30).getTime(), now)).toBe(false);
    expect(backupDue('weekly', 3, new Date(2026, 8, 22, 3, 0).getTime(), now)).toBe(false);
    expect(backupDue('weekly', 3, new Date(2026, 8, 19, 3, 0).getTime(), now)).toBe(true);
    expect(backupDue('off', 3, null, now)).toBe(false);
  });
});

describe('scheduled backups', () => {
  it('creates automatic backups when due and only rotates automatic ones', async () => {
    env = await createTestEnv();
    await setupAdmin(env.app);
    const dir = env.ctx.config.backupDir;
    // Old automatic backups from the last 20 days, plus a manual one that must survive.
    for (let i = 1; i <= 20; i++) {
      const f = path.join(dir, `velyx-auto-old-${String(i).padStart(2, '0')}.db`);
      fs.writeFileSync(f, 'x');
      const t = new Date(Date.now() - i * DAY);
      fs.utimesSync(f, t, t);
    }
    fs.writeFileSync(path.join(dir, 'velyx-manual-keep.db'), 'x');
    const created = env.ctx.backups.tick(new Date(Date.now() + DAY));
    expect(created?.kind).toBe('auto');
    expect(verifyBackup(path.join(dir, created!.name)).ok).toBe(true);
    const autos = env.ctx.backups.list().filter((b) => b.kind === 'auto');
    expect(autos.length).toBeLessThanOrEqual(7 + 4 + 3);
    expect(autos.length).toBeLessThan(21);
    expect(fs.existsSync(path.join(dir, 'velyx-manual-keep.db'))).toBe(true);
    // Not due again until the next slot.
    expect(env.ctx.backups.tick(new Date())).toBeNull();
  });
});

describe('verification', () => {
  it('accepts good backups and full archives', async () => {
    env = await createTestEnv();
    await setupAdmin(env.app);
    const snap = env.ctx.backups.create('manual');
    const r = verifyBackup(path.join(env.ctx.config.backupDir, snap.name));
    expect(r).toMatchObject({ ok: true, errors: [], info: { users: 1 } });
    const archive = createFullBackup(env.ctx.db, env.ctx.config.dataDir, env.ctx.config.backupDir);
    expect(verifyBackup(archive)).toMatchObject({ ok: true, info: { users: 1 } });
  });

  it('rejects corrupt, foreign and newer databases', () => {
    const dir = tmp();
    const junk = path.join(dir, 'junk.db');
    fs.writeFileSync(junk, Buffer.alloc(8192, 7));
    expect(verifyBackup(junk).ok).toBe(false);
    expect(verifyBackup(path.join(dir, 'missing.db')).errors[0]).toMatch(/does not exist/);

    const foreign = path.join(dir, 'foreign.db');
    new Database(foreign).exec('CREATE TABLE notes (id INTEGER)');
    expect(verifyBackup(foreign).errors.join(' ')).toMatch(/Not a complete Velyx database/);

    const newer = path.join(dir, 'newer.db');
    openDatabase(newer).$client.exec("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('future', 1)");
    expect(verifyBackup(newer).errors.join(' ')).toMatch(/newer version of Velyx/);

    // A damaged page inside an otherwise valid database fails the integrity check.
    const damaged = path.join(dir, 'damaged.db');
    const d = openDatabase(damaged);
    d.$client.exec("CREATE TABLE filler (t TEXT); WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 3000) INSERT INTO filler SELECT hex(randomblob(64)) FROM n;");
    d.$client.pragma('wal_checkpoint(TRUNCATE)');
    d.$client.close();
    const fd = fs.openSync(damaged, 'r+');
    fs.writeSync(fd, Buffer.alloc(4096, 0xff), 0, 4096, 4096 * 10);
    fs.closeSync(fd);
    expect(verifyBackup(damaged).ok).toBe(false);
  });
});

describe('restore', () => {
  it('restores a backup on the next start and keeps the previous database', async () => {
    env = await createTestEnv();
    const admin = await setupAdmin(env.app);
    const snap = env.ctx.backups.create('manual');
    await createUser(env.app, admin, 'late-user');
    const { dbPath, dataDir, backupDir } = env.ctx.config;
    stageRestore(path.join(backupDir, snap.name), dataDir, 'admin');
    await env.app.close();
    env.ctx.db.$client.close();
    const applied = applyPendingRestore(dbPath, dataDir, backupDir);
    expect(applied).toMatchObject({ source: snap.name, requestedBy: 'admin' });
    const db = openDatabase(dbPath);
    expect((db.$client.prepare('SELECT username FROM users').all() as { username: string }[]).map((u) => u.username)).toEqual(['admin']);
    // The database from before the restore still has the later user.
    const previous = new Database(applied!.safetyCopy!, { readonly: true });
    expect(previous.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 2 });
    previous.close();
    db.$client.close();
    env = null;
    fs.rmSync(dataDir, { recursive: true, force: true });
    // Nothing pending any more.
    expect(applyPendingRestore(dbPath, dataDir, backupDir)).toBeNull();
  });

  it('refuses to stage a backup that fails verification', () => {
    const dir = tmp();
    const junk = path.join(dir, 'velyx-manual-junk.db');
    fs.writeFileSync(junk, 'not a database');
    expect(() => stageRestore(junk, dir, 'x')).toThrow(/did not pass verification/);
    expect(fs.existsSync(path.join(dir, 'restore-pending.db'))).toBe(false);
  });
});

describe('migration safety', () => {
  it('refuses to open a database from a newer Velyx', () => {
    const file = path.join(tmp(), 'v.db');
    openDatabase(file).$client.exec("INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('future', 1)");
    expect(() => openDatabase(file)).toThrow(MigrationError);
    expect(() => openDatabase(file)).toThrow(/newer version of Velyx/);
  });

  it('leaves the database unchanged and stops when a migration fails', () => {
    const dir = tmp();
    const file = path.join(dir, 'v.db');
    const backups = path.join(dir, 'backups');
    openDatabase(file).$client.close();
    // A copy of the real migrations plus one that fails halfway through.
    const folder = path.join(dir, 'migrations');
    fs.cpSync(migrationsFolder(), folder, { recursive: true });
    const journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8'));
    journal.entries.push({ idx: journal.entries.length, version: '6', when: Date.now(), tag: '9999_broken', breakpoints: true });
    fs.writeFileSync(path.join(folder, 'meta', '_journal.json'), JSON.stringify(journal));
    fs.writeFileSync(path.join(folder, '9999_broken.sql'), 'CREATE TABLE half_done (id INTEGER);\n--> statement-breakpoint\nALTER TABLE does_not_exist ADD x INTEGER;');
    expect(() => openDatabase(file, { backupDir: backups, migrationsFolder: folder })).toThrow(/migration failed[\s\S]*left unchanged/i);
    const check = new Database(file, { readonly: true });
    expect(check.prepare("SELECT name FROM sqlite_master WHERE name = 'half_done'").get()).toBeUndefined();
    check.close();
    expect(fs.readdirSync(backups).some((f) => f.startsWith('pre-migration-'))).toBe(true);
  });
});

describe('backup API', () => {
  it('lists, creates, verifies, stages and deletes backups (admins only)', async () => {
    env = await createTestEnv();
    const admin = await setupAdmin(env.app);
    const user = await createUser(env.app, admin, 'viewer');
    const inject = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object, cookie = admin) => env!.app.inject({ method, url, headers: { cookie }, payload });
    expect((await inject('GET', '/api/admin/backups', undefined, user.cookie)).statusCode).toBe(403);
    const created = (await inject('POST', '/api/admin/backups')).json();
    expect(created.kind).toBe('manual');
    const view = (await inject('GET', '/api/admin/backups')).json();
    expect(view.backups.map((b: { name: string }) => b.name)).toContain(created.name);
    expect(view.schedule).toMatchObject({ schedule: 'daily', hour: 3, keepDaily: 7, keepWeekly: 4, keepMonthly: 3 });
    expect((await inject('POST', `/api/admin/backups/${created.name}/verify`)).json()).toMatchObject({ ok: true });
    expect((await inject('GET', `/api/admin/backups/${created.name}/download`)).rawPayload.subarray(0, 15).toString()).toBe('SQLite format 3');
    for (const bad of ['..%2Fvelyx.db', 'velyx.db', 'x.txt', '.hidden.db']) expect((await inject('POST', `/api/admin/backups/${bad}/verify`)).statusCode, bad).toBe(404);
    expect((await inject('POST', `/api/admin/backups/${created.name}/restore`, {})).statusCode).toBe(400);
    const staged = (await inject('POST', `/api/admin/backups/${created.name}/restore`, { confirm: true })).json();
    expect(staged.pendingRestore).toMatchObject({ source: created.name, requestedBy: 'admin' });
    expect((await inject('DELETE', '/api/admin/backups/restore/pending')).json().pendingRestore).toBeNull();
    const settings = (await inject('PUT', '/api/admin/backups/settings', { schedule: 'weekly', hour: 5 })).json();
    expect(settings.schedule).toMatchObject({ schedule: 'weekly', hour: 5 });
    expect((await inject('DELETE', `/api/admin/backups/${created.name}`)).json().backups).toHaveLength(0);
  });
});

describe('CLI', () => {
  it('lists and verifies backups', async () => {
    env = await createTestEnv();
    await setupAdmin(env.app);
    env.ctx.backups.create('manual');
    const run = (...args: string[]) =>
      execFileSync('npx', ['tsx', 'src/cli.ts', ...args], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, DATA_DIR: env!.ctx.config.dataDir, SESSION_SECRET: 'test-secret-test-secret-1234' }, encoding: 'utf8' });
    expect(run('backup', 'list')).toMatch(/manual .* velyx-manual-/);
    expect(run('backup', 'verify')).toMatch(/^OK +velyx-manual-.*\(1 users/m);
  }, 60000);
});
