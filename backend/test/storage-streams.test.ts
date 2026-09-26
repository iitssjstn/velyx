import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { libraries, mediaFiles, movies } from '../src/db/schema.js';
import { DiskMonitor, diskLevel, type DiskInfo } from '../src/services/storage.js';
import { StreamTracker } from '../src/services/streams.js';
import { addLibrary, createTestEnv, createUser, setupAdmin, touch, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
beforeEach(async () => {
  env = await createTestEnv();
  admin = await setupAdmin(env.app);
});
afterEach(async () => {
  await env.cleanup();
});

const GB = 1024 ** 3;

describe('disk space', () => {
  it('classifies free space with the configured thresholds', () => {
    expect(diskLevel(50 * GB, 10 * GB, 2 * GB)).toBe('ok');
    expect(diskLevel(9 * GB, 10 * GB, 2 * GB)).toBe('low');
    expect(diskLevel(1 * GB, 10 * GB, 2 * GB)).toBe('critical');
  });

  it('pauses scans when space is critical and resumes when it recovers, but not a manual pause', () => {
    let disk: DiskInfo = { total: 100 * GB, free: 1 * GB, used: 99 * GB, level: 'critical' };
    const storage = { dataDisk: () => disk } as unknown as ConstructorParameters<typeof DiskMonitor>[0];
    const scans = env.ctx.scans;
    const monitor = new DiskMonitor(storage, (level) => (level === 'critical' ? scans.pause('low-disk') : scans.resume('low-disk')));
    monitor.check();
    expect(scans.state()).toMatchObject({ status: 'paused', paused: { reason: 'low-disk' } });
    disk = { ...disk, free: 50 * GB, level: 'ok' };
    monitor.check();
    expect(scans.state().paused).toBeNull();
    // An administrator's pause is not lifted by the disk monitor.
    scans.pause('manual');
    disk = { ...disk, free: 1 * GB, level: 'critical' };
    monitor.check();
    disk = { ...disk, free: 50 * GB, level: 'ok' };
    monitor.check();
    expect(scans.state().paused).toMatchObject({ reason: 'manual' });
    scans.resume('manual');
  });

  it('skips scheduled backups when space is critical', async () => {
    const { BackupScheduler } = await import('../src/services/backup-scheduler.js');
    const b = new BackupScheduler(env.ctx.db, env.ctx.config.backupDir, env.ctx.settings, () => 'disk space is critically low');
    expect(b.tick(new Date(Date.now() + 86_400_000))).toBeNull();
    expect(b.list()).toHaveLength(0);
  });
});

describe('storage report and cache cleanup', () => {
  it('reports Velyx storage and removes only unused cache files', async () => {
    const libId = env.ctx.db.insert(libraries).values({ name: 'm', type: 'movies', path: '/media/m' }).returning().get().id;
    const movie = env.ctx.db.insert(movies).values({ libraryId: libId, groupKey: 'a', title: 'A', sortTitle: 'a', parsedTitle: 'a', posterPath: '/keep.jpg' }).returning().get();
    const file = env.ctx.db.insert(mediaFiles).values({ libraryId: libId, movieId: movie.id, path: '/media/m/a.mkv', size: 1, mtimeMs: 5000 }).returning().get();
    const img = env.ctx.config.imageCacheDir;
    const subs = env.ctx.config.subtitleCacheDir;
    touch(path.join(img, 'w342', 'keep.jpg'), 'x'.repeat(100));
    touch(path.join(img, 'w1280', 'keep.jpg'), 'x'.repeat(100));
    touch(path.join(img, 'w342', 'gone.jpg'), 'x'.repeat(300));
    touch(path.join(subs, `${file.id}-3-5000.vtt`), 'WEBVTT');
    touch(path.join(subs, `${file.id}-3-4000.vtt`), 'WEBVTT old');
    touch(path.join(subs, '999-1-1.vtt'), 'WEBVTT orphan');

    const res = await env.app.inject({ url: '/api/admin/storage?refresh=1', headers: { cookie: admin } });
    const r = res.json();
    expect(r.cache.artwork).toMatchObject({ files: 3, bytes: 500, unusedFiles: 1, unusedBytes: 300 });
    expect(r.cache.subtitles).toMatchObject({ files: 3, unusedFiles: 2 });
    expect(r.velyx.database).toBeGreaterThan(0);
    expect(r.disk.total).toBeGreaterThan(0);

    const cleaned = (await env.app.inject({ method: 'POST', url: '/api/admin/storage/cleanup', headers: { cookie: admin }, payload: { target: 'artwork' } })).json();
    expect(cleaned).toMatchObject({ files: 1, bytes: 300 });
    expect(fs.existsSync(path.join(img, 'w342', 'keep.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(img, 'w342', 'gone.jpg'))).toBe(false);
    await env.app.inject({ method: 'POST', url: '/api/admin/storage/cleanup', headers: { cookie: admin }, payload: { target: 'subtitles' } });
    expect(fs.readdirSync(subs)).toEqual([`${file.id}-3-5000.vtt`]);
  });

  it('is admin-only', async () => {
    const user = await createUser(env.app, admin, 'viewer');
    expect((await env.app.inject({ url: '/api/admin/storage', headers: { cookie: user.cookie } })).statusCode).toBe(403);
    expect((await env.app.inject({ method: 'POST', url: '/api/admin/storage/cleanup', headers: { cookie: user.cookie }, payload: { target: 'artwork' } })).statusCode).toBe(403);
  });
});

describe('active streams', () => {
  it('tracks streams from requests and progress, and forgets idle ones', () => {
    const libId = env.ctx.db.insert(libraries).values({ name: 'm', type: 'movies', path: '/media/m' }).returning().get().id;
    const movie = env.ctx.db.insert(movies).values({ libraryId: libId, groupKey: 'i', title: 'Interstellar', sortTitle: 'interstellar', parsedTitle: 'i', year: 2014 }).returning().get();
    const file = env.ctx.db.insert(mediaFiles).values({ libraryId: libId, movieId: movie.id, path: '/media/m/i.mkv', size: 1, mtimeMs: 1, width: 1920, height: 1080, bitrate: 4_200_000, durationSec: 10140 }).returning().get();
    const t = new StreamTracker(env.ctx.db);
    const start = 1_000_000;
    t.touch({ id: 1, username: 'justin' }, file.id, 'direct', 'Firefox on Linux', start);
    t.touch({ id: 1, username: 'justin' }, file.id, 'direct', 'Firefox on Linux', start + 5000);
    t.progress(1, { movieId: movie.id }, 2592, start + 50_000);
    const [s] = t.active(start + 100_000);
    expect(s).toMatchObject({ username: 'justin', title: 'Interstellar', subtitle: '2014', mode: 'direct', width: 1920, bitrate: 4_200_000, positionSec: 2592, startedAt: start, device: 'Firefox on Linux' });
    expect(t.active(start + 200_000)).toHaveLength(0);
  });

  it('forgets finished streams without anyone opening the dashboard', () => {
    const libId = env.ctx.db.insert(libraries).values({ name: 'm', type: 'movies', path: '/media/m' }).returning().get().id;
    const ids = Array.from({ length: 50 }, (_, i) => {
      const movie = env.ctx.db.insert(movies).values({ libraryId: libId, groupKey: `g${i}`, title: `M${i}`, sortTitle: `m${i}`, parsedTitle: 'm' }).returning().get();
      return env.ctx.db.insert(mediaFiles).values({ libraryId: libId, movieId: movie.id, path: `/media/m/${i}.mkv`, size: 1, mtimeMs: 1 }).returning().get().id;
    });
    const t = new StreamTracker(env.ctx.db);
    // One stream every two minutes for 100 minutes: only the latest can still be active.
    ids.forEach((id, i) => t.touch({ id: 1, username: 'u' }, id, 'direct', null, i * 120_000));
    expect(t.size).toBe(1);
  });

  it('shows streams on the dashboard with CPU usage', async () => {
    touch(path.join(env.mediaDir, 'movies', 'Heat (1995).mkv'), 'x'.repeat(2048));
    await addLibrary(env, admin, 'movies', 'movies');
    const movie = (await env.app.inject({ url: '/api/movies', headers: { cookie: admin } })).json().items[0];
    const fileId = (await env.app.inject({ url: `/api/movies/${movie.id}`, headers: { cookie: admin } })).json().files[0].id;
    await env.app.inject({ url: `/api/media/${fileId}/stream`, headers: { cookie: admin, range: 'bytes=0-99', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/128.0 Safari/537.36' } });
    const d = (await env.app.inject({ url: '/api/admin/dashboard', headers: { cookie: admin } })).json();
    expect(d.streams).toHaveLength(1);
    expect(d.streams[0]).toMatchObject({ username: 'admin', title: 'Heat', mode: 'direct', device: 'Chrome on Windows' });
    expect(d.cpu).toHaveProperty('system');
    expect(d.disk.level).toMatch(/ok|low|critical/);
  });
});

describe('stream availability', () => {
  it('tells a missing file apart from one that cannot be decoded, and HEAD never starts a remux', async () => {
    const file = path.join(env.mediaDir, 'movies', 'Heat (1995).mkv');
    touch(file, 'x'.repeat(2048));
    await addLibrary(env, admin, 'movies', 'movies');
    const movie = (await env.app.inject({ url: '/api/movies', headers: { cookie: admin } })).json().items[0];
    const fileId = (await env.app.inject({ url: `/api/movies/${movie.id}`, headers: { cookie: admin } })).json().files[0].id;
    expect((await env.app.inject({ url: `/api/media/${fileId}/available`, headers: { cookie: admin } })).json()).toEqual({ available: true });
    const head = await env.app.inject({ method: 'HEAD', url: `/api/media/${fileId}/remux`, headers: { cookie: admin } });
    expect(head.statusCode).toBe(200);
    expect(env.ctx.playback.get('remux')).toMatchObject({ activeStreams: 0 });
    fs.rmSync(file);
    const gone = await env.app.inject({ url: `/api/media/${fileId}/available`, headers: { cookie: admin } });
    expect(gone.statusCode).toBe(404);
    expect(gone.json().error).toMatch(/no longer available/);
  });
});
