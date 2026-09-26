import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { addLibrary, createTestEnv, createUser, fakeProbe, setupAdmin, touch, type TestEnv } from './helpers.js';
import { mediaFiles, movies, users, watchProgress } from '../src/db/schema.js';
import { cleanupCandidates, effectiveRules } from '../src/services/cleanup.js';
import { DEFAULT_CLEANUP_RULES } from '../src/services/settings.js';

let env: TestEnv;
let admin: string;
let root: string;
const DAY = 86_400_000;
const GB = 1024 ** 3;

beforeEach(async () => {
  // Heights come from the file name, so a movie can have a 4K and a 720p version.
  env = await createTestEnv({ prober: async (file) => fakeProbe({ height: /2160p/.test(file) ? 2160 : /720p/.test(file) ? 720 : 1080 }) });
  admin = await setupAdmin(env.app, 'justin');
  root = path.join(env.mediaDir, 'films');
  for (const f of ['Heat (1995)/Heat.1995.2160p.mkv', 'Heat (1995)/Heat.1995.720p.mkv', 'Alien (1979)/Alien.1979.mkv', 'Dune (2021)/Dune.2021.mkv', 'Zodiac (2007)/Zodiac.2007.mkv']) touch(path.join(root, f), 'x'.repeat(100));
  await addLibrary(env, admin, 'movies', 'films');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await env.cleanup();
});

const db = () => env.ctx.db;
const fileOf = (name: string) => db().select().from(mediaFiles).all().find((f) => f.path.endsWith(name))!;
const get = (url: string, cookie = admin) => env.app.inject({ url, headers: { cookie } });
const post = (url: string, payload: object, cookie = admin) => env.app.inject({ method: 'POST', url, headers: { cookie }, payload });
const put = (url: string, payload: object) => env.app.inject({ method: 'PUT', url, headers: { cookie: admin }, payload });

/** Alien: old and never watched. Dune: huge. Zodiac: watched long ago. Heat: two versions. */
function scenario() {
  const now = Date.now();
  const me = db().select().from(users).where(eq(users.username, 'justin')).get()!;
  db().update(mediaFiles).set({ addedAt: now - 10 * DAY }).run();
  db().update(mediaFiles).set({ addedAt: now - 400 * DAY }).where(eq(mediaFiles.id, fileOf('Alien.1979.mkv').id)).run();
  db().update(mediaFiles).set({ size: 60 * GB }).where(eq(mediaFiles.id, fileOf('Dune.2021.mkv').id)).run();
  const zodiac = fileOf('Zodiac.2007.mkv');
  db().insert(watchProgress).values({ userId: me.id, movieId: zodiac.movieId, positionSec: 9000, durationSec: 9000, completed: true, playCount: 1, updatedAt: now - 800 * DAY }).run();
  // Heat was watched recently, so only its extra version is a suggestion.
  db().insert(watchProgress).values({ userId: me.id, movieId: fileOf('Heat.1995.2160p.mkv').movieId, positionSec: 100, durationSec: 9000, updatedAt: now - DAY }).run();
}

describe('clean-up suggestions', () => {
  it('suggests files per rule, with readable reasons, and never the best version', () => {
    scenario();
    const rules = { ...DEFAULT_CLEANUP_RULES, stale: { enabled: true, days: 730 } };
    const { candidates } = cleanupCandidates(db(), rules);
    const by = Object.fromEntries(candidates.map((c) => [path.basename(c.path), c.reasons.map((r) => r.rule)]));
    expect(by).toEqual({ 'Alien.1979.mkv': ['unwatched'], 'Dune.2021.mkv': ['large'], 'Zodiac.2007.mkv': ['stale'], 'Heat.1995.720p.mkv': ['duplicates'] });
    // Largest first; the reasons say why.
    expect(path.basename(candidates[0].path)).toBe('Dune.2021.mkv');
    const heat = candidates.find((c) => c.path.endsWith('720p.mkv'))!;
    expect(heat.reasons[0].text).toBe('Another version exists: 4K, Heat.1995.2160p.mkv');
    const alien = candidates.find((c) => c.path.endsWith('Alien.1979.mkv'))!;
    expect(alien).toMatchObject({ title: 'Alien', started: false, watchedBy: 0, lastWatchedAt: null, href: `/movies/${alien.href!.split('/').pop()}` });
    expect(alien.reasons[0].text).toBe('Never watched, added 13 months ago');
    const zodiac = candidates.find((c) => c.path.endsWith('Zodiac.2007.mkv'))!;
    expect(zodiac).toMatchObject({ started: true, watchedBy: 1 });
    // Rules that are off suggest nothing.
    expect(cleanupCandidates(db(), { ...rules, large: { enabled: false, gb: 50 } }).candidates.some((c) => c.path.endsWith('Dune.2021.mkv'))).toBe(false);
  });

  it('fills in rules missing from older settings', () => {
    expect(effectiveRules({ large: { enabled: false, gb: 20 } } as never)).toEqual({ ...DEFAULT_CLEANUP_RULES, large: { enabled: false, gb: 20 } });
  });

  it('keeps files the admin chose to keep out of the list until they change', async () => {
    scenario();
    const alien = fileOf('Alien.1979.mkv');
    expect((await post('/api/admin/cleanup/keep', { fileIds: [alien.id] })).json()).toEqual({ kept: 1 });
    let list = (await get('/api/admin/cleanup')).json();
    expect(list.items.some((c: { fileId: number }) => c.fileId === alien.id)).toBe(false);
    expect(list.summary.kept).toBe(1);
    expect((await get('/api/admin/cleanup/kept')).json()).toMatchObject([{ fileId: alien.id, decidedBy: 'justin' }]);
    // Replaced by another file of a different size: suggested again.
    db().update(mediaFiles).set({ size: 12345 }).where(eq(mediaFiles.id, alien.id)).run();
    list = (await get('/api/admin/cleanup')).json();
    expect(list.items.some((c: { fileId: number }) => c.fileId === alien.id)).toBe(true);
    db().update(mediaFiles).set({ size: 100 }).where(eq(mediaFiles.id, alien.id)).run();
    await env.app.inject({ method: 'DELETE', url: `/api/admin/cleanup/kept/${alien.id}`, headers: { cookie: admin } });
    expect((await get('/api/admin/cleanup')).json().summary.kept).toBe(0);
  });

  it('lists, filters and pages suggestions and saves the rules', async () => {
    scenario();
    const all = (await get('/api/admin/cleanup')).json();
    expect(all.total).toBe(3); // stale is off by default
    expect(all.summary.counts.large).toEqual({ files: 1, bytes: 60 * GB });
    expect(all.deletion).toMatchObject({ enabled: false, libraries: [{ name: 'films', writable: true }] });
    expect((await get('/api/admin/cleanup?rule=duplicates')).json().items.map((c: { path: string }) => path.basename(c.path))).toEqual(['Heat.1995.720p.mkv']);
    expect((await get('/api/admin/cleanup?limit=2&page=2')).json().items).toHaveLength(1);
    expect((await get('/api/admin/cleanup?rule=bogus')).statusCode).toBe(400);
    const saved = await put('/api/admin/cleanup/settings', { rules: { ...DEFAULT_CLEANUP_RULES, stale: { enabled: true, days: 365 } } });
    expect(saved.json().rules.stale).toEqual({ enabled: true, days: 365 });
    expect((await get('/api/admin/cleanup')).json().total).toBe(4);
    expect((await put('/api/admin/cleanup/settings', { rules: { ...DEFAULT_CLEANUP_RULES, large: { enabled: true, gb: 0 } } })).statusCode).toBe(400);
  });
});

describe('deleting', () => {
  it('is off by default and needs an explicit confirmation', async () => {
    scenario();
    const alien = fileOf('Alien.1979.mkv');
    expect((await post('/api/admin/cleanup/delete', { fileIds: [alien.id], confirm: true })).statusCode).toBe(403);
    await put('/api/admin/cleanup/settings', { deletion: true });
    expect((await post('/api/admin/cleanup/delete', { fileIds: [alien.id] })).statusCode).toBe(400);
    expect((await post('/api/admin/cleanup/delete', { fileIds: [alien.id], confirm: 'yes' })).statusCode).toBe(400);
    expect(fs.existsSync(path.join(root, 'Alien (1979)/Alien.1979.mkv'))).toBe(true);
  });

  it('deletes only reviewed suggestions, logs each file and updates the library', async () => {
    scenario();
    await put('/api/admin/cleanup/settings', { deletion: true });
    const heat720 = fileOf('Heat.1995.720p.mkv');
    const heat4k = fileOf('Heat.1995.2160p.mkv');
    const res = (await post('/api/admin/cleanup/delete', { fileIds: [heat720.id, heat4k.id], confirm: true })).json();
    expect(res.results).toEqual([
      expect.objectContaining({ fileId: heat720.id, ok: true }),
      expect.objectContaining({ fileId: heat4k.id, ok: false, error: 'This file is not a clean-up suggestion (any more).' }),
    ]);
    expect(fs.existsSync(path.join(root, 'Heat (1995)/Heat.1995.720p.mkv'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'Heat (1995)/Heat.1995.2160p.mkv'))).toBe(true);
    await env.ctx.scans.whenIdle();
    expect(db().select().from(mediaFiles).where(eq(mediaFiles.id, heat720.id)).get()).toBeUndefined();
    expect(db().select().from(movies).where(eq(movies.title, 'Heat')).get()).toBeTruthy();
    const audit = JSON.stringify((await get('/api/admin/audit')).json());
    expect(audit).toContain('cleanup.deleted');
    expect(audit).toContain('Heat.1995.720p.mkv');
    expect(audit).toContain('deleting files allowed');
  });

  it('refuses files outside the library, read-only folders and files being watched', async () => {
    scenario();
    await put('/api/admin/cleanup/settings', { deletion: true });
    // A row pointing outside the library folder is never deleted.
    const outside = path.join(env.dir, 'outside.mkv');
    touch(outside);
    const alien = fileOf('Alien.1979.mkv');
    db().update(mediaFiles).set({ path: outside }).where(eq(mediaFiles.id, alien.id)).run();
    let r = (await post('/api/admin/cleanup/delete', { fileIds: [alien.id], confirm: true })).json();
    expect(r.results[0]).toMatchObject({ ok: false, error: 'The file was not found inside its library folder.' });
    expect(fs.existsSync(outside)).toBe(true);

    // Someone is watching Dune.
    const dune = fileOf('Dune.2021.mkv');
    const me = db().select().from(users).where(eq(users.username, 'justin')).get()!;
    env.ctx.streams.touch(me, dune.id, 'direct', null);
    r = (await post('/api/admin/cleanup/delete', { fileIds: [dune.id], confirm: true })).json();
    expect(r.results[0]).toMatchObject({ ok: false, error: 'Someone is watching this file right now.' });

    // A read-only mount.
    const heat720 = fileOf('Heat.1995.720p.mkv');
    const access = fs.accessSync;
    vi.spyOn(fs, 'accessSync').mockImplementation((p, mode) => {
      if (mode === fs.constants.W_OK) throw Object.assign(new Error('EROFS'), { code: 'EROFS' });
      return access(p, mode);
    });
    r = (await post('/api/admin/cleanup/delete', { fileIds: [heat720.id], confirm: true })).json();
    expect(r.results[0]).toMatchObject({ ok: false, error: 'The library folder is read-only. Mount it without :ro to allow deleting.' });
    expect((await get('/api/admin/cleanup')).json().deletion.libraries[0].writable).toBe(false);
    expect(fs.existsSync(path.join(root, 'Heat (1995)/Heat.1995.720p.mkv'))).toBe(true);
  });

  it('is for administrators only', async () => {
    const user = await createUser(env.app, admin, 'viewer');
    expect((await get('/api/admin/cleanup', user.cookie)).statusCode).toBe(403);
    expect((await post('/api/admin/cleanup/delete', { fileIds: [1], confirm: true }, user.cookie)).statusCode).toBe(403);
    expect((await post('/api/admin/cleanup/keep', { fileIds: [1] }, user.cookie)).statusCode).toBe(403);
    expect((await env.app.inject({ method: 'PUT', url: '/api/admin/cleanup/settings', headers: { cookie: user.cookie }, payload: { deletion: true } })).statusCode).toBe(403);
  });
});
