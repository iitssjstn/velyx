import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { limitProber } from '../src/services/probe-queue.js';
import type { Prober } from '../src/services/probe.js';
import { libraries, mediaFiles, movies } from '../src/db/schema.js';
import { addLibrary, createTestEnv, createUser, fakeProbe, setupAdmin, touch, type TestEnv } from './helpers.js';

let env: TestEnv;
afterEach(async () => {
  await env?.cleanup();
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('FFprobe queue', () => {
  it('never runs more probes than the limit, across all callers', async () => {
    let running = 0;
    let peak = 0;
    const slow: Prober = async () => {
      running++;
      peak = Math.max(peak, running);
      await wait(5);
      running--;
      return fakeProbe();
    };
    const limited = limitProber(slow, 2);
    await Promise.all(Array.from({ length: 12 }, (_, i) => limited(`/f${i}.mkv`)));
    expect(peak).toBe(2);
    expect(limited.active).toBe(0);
    expect(limited.waiting).toBe(0);
  });

  it('lets playback probes skip ahead of queued scan work', async () => {
    const order: string[] = [];
    const slow: Prober = async (f) => {
      order.push(f);
      await wait(5);
      return fakeProbe();
    };
    const limited = limitProber(slow, 1);
    const background = Array.from({ length: 5 }, (_, i) => limited(`/scan${i}.mkv`));
    await wait(1);
    const play = limited.urgent('/play.mkv');
    await Promise.all([...background, play]);
    // The first scan probe was already running; the playback probe goes next.
    expect(order.slice(0, 2)).toEqual(['/scan0.mkv', '/play.mkv']);
    expect(order).toHaveLength(6);
    expect(limited.waiting).toBe(0);
  });

  it('defaults to one probe at a time and only probes changed files', async () => {
    let running = 0;
    let peak = 0;
    const calls: string[] = [];
    env = await createTestEnv({
      prober: async (f) => {
        calls.push(f);
        running++;
        peak = Math.max(peak, running);
        await wait(3);
        running--;
        return fakeProbe();
      },
    });
    expect(env.ctx.config.scanConcurrency).toBe(1);
    const admin = await setupAdmin(env.app);
    for (let i = 0; i < 6; i++) touch(path.join(env.mediaDir, 'movies', `Film ${i} (200${i}).mkv`));
    const lib = await addLibrary(env, admin, 'movies', 'movies');
    expect(peak).toBe(1);
    expect(calls).toHaveLength(6);
    // Unchanged files are not probed again; a changed one is.
    fs.appendFileSync(path.join(env.mediaDir, 'movies', 'Film 2 (2002).mkv'), 'more');
    env.ctx.scans.enqueue(lib.id);
    await env.ctx.scans.whenIdle();
    expect(calls).toHaveLength(7);
    expect(calls[6]).toContain('Film 2');
  });
});

describe('folder watcher batching', () => {
  it('runs one scan for a burst of file events', async () => {
    env = await createTestEnv({ watchDebounceMs: 200 });
    env.ctx.settings.update({ watchFolders: true });
    const admin = await setupAdmin(env.app);
    const lib = await addLibrary(env, admin, 'movies', 'movies');
    env.ctx.watcher.sync(true);
    const enqueue = env.ctx.scans.enqueue.bind(env.ctx.scans);
    let scans = 0;
    env.ctx.scans.enqueue = (id, refresh) => {
      scans++;
      return enqueue(id, refresh);
    };
    for (let i = 0; i < 20; i++) {
      touch(path.join(env.mediaDir, 'movies', `Copy ${i} (2010).mkv`));
      await wait(10);
    }
    await wait(600);
    await env.ctx.scans.whenIdle();
    expect(scans).toBe(1);
    const list = (await env.app.inject({ url: '/api/movies', headers: { cookie: admin } })).json();
    expect(list.total).toBe(20);
    expect(env.ctx.scans.state().lastSuccess?.libraryId).toBe(lib.id);
  });
});

describe('scan status', () => {
  it('pauses and resumes scanning, and reports progress', async () => {
    let release: (() => void) | null = null;
    env = await createTestEnv({
      prober: async () => {
        await new Promise<void>((r) => (release = r));
        return fakeProbe();
      },
    });
    const admin = await setupAdmin(env.app);
    touch(path.join(env.mediaDir, 'movies', 'A (2001).mkv'));
    touch(path.join(env.mediaDir, 'movies', 'B (2002).mkv'));
    const res = await env.app.inject({ method: 'POST', url: '/api/libraries', headers: { cookie: admin }, payload: { name: 'm', type: 'movies', path: path.join(env.mediaDir, 'movies') } });
    const libId = res.json().id;
    await wait(50);
    let state = (await env.app.inject({ url: '/api/libraries/scan-status', headers: { cookie: admin } })).json();
    expect(state.status).toBe('scanning');
    expect(state.running.progress).toMatchObject({ phase: 'analyzing', processed: 0, total: 2, currentFile: 'A (2001).mkv' });

    state = (await env.app.inject({ method: 'POST', url: '/api/libraries/scans/pause', headers: { cookie: admin } })).json();
    expect(state).toMatchObject({ status: 'paused', paused: { reason: 'manual' } });
    release!();
    await wait(50);
    // Halted after the first file.
    expect(env.ctx.scans.state().running?.progress.processed).toBe(1);

    await env.app.inject({ method: 'POST', url: '/api/libraries/scans/resume', headers: { cookie: admin } });
    await wait(20);
    release!();
    await env.ctx.scans.whenIdle();
    state = env.ctx.scans.state();
    expect(state.status).toBe('idle');
    expect(state.lastSuccess).toMatchObject({ libraryId: libId });
    expect(state.lastSuccess!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('picks up files added while a scan is already analysing', async () => {
    let release: (() => void) | null = null;
    env = await createTestEnv({
      prober: async () => {
        await new Promise<void>((r) => (release = r));
        return fakeProbe();
      },
    });
    const admin = await setupAdmin(env.app);
    const dir = path.join(env.mediaDir, 'movies');
    touch(path.join(dir, 'A (2001).mkv'));
    const res = await env.app.inject({ method: 'POST', url: '/api/libraries', headers: { cookie: admin }, payload: { name: 'm', type: 'movies', path: dir } });
    await wait(50);
    expect(env.ctx.scans.state().running?.progress.phase).toBe('analyzing');
    // Radarr drops a new file in; the watcher asks for a scan while the first one is busy.
    touch(path.join(dir, 'B (2002).mkv'));
    expect(env.ctx.scans.enqueue(res.json().id)).toBe(true);
    expect(env.ctx.scans.enqueue(res.json().id)).toBe(false); // already queued once
    const drain = setInterval(() => release?.(), 5);
    await env.ctx.scans.whenIdle();
    clearInterval(drain);
    const list = (await env.app.inject({ url: '/api/movies', headers: { cookie: admin } })).json();
    expect(list.items.map((m: { title: string }) => m.title).sort()).toEqual(['A', 'B']);
  });

  it('reports failed scans', async () => {
    env = await createTestEnv();
    const admin = await setupAdmin(env.app);
    const lib = await addLibrary(env, admin, 'movies', 'gone');
    fs.rmSync(lib.path, { recursive: true });
    env.ctx.scans.enqueue(lib.id);
    await env.ctx.scans.whenIdle();
    const state = env.ctx.scans.state();
    expect(state.status).toBe('failed');
    expect(state.lastFailure).toMatchObject({ libraryId: lib.id, message: expect.stringContaining('not available') });
  });

  it('only admins can pause scanning', async () => {
    env = await createTestEnv();
    const admin = await setupAdmin(env.app);
    await env.app.inject({ method: 'POST', url: '/api/users', headers: { cookie: admin }, payload: { username: 'viewer', password: 'viewer-password' } });
    const login = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'viewer', password: 'viewer-password' } });
    const cookie = `velyx_session=${login.cookies.find((c) => c.name === 'velyx_session')!.value}`;
    expect((await env.app.inject({ method: 'POST', url: '/api/libraries/scans/pause', headers: { cookie } })).statusCode).toBe(403);
  });
});

describe('scheduled and full scans', () => {
  const watching = (e: TestEnv) => {
    const lib = e.ctx.db.insert(libraries).values({ name: 'x', type: 'movies', path: '/media/x' }).returning().get().id;
    const m = e.ctx.db.insert(movies).values({ libraryId: lib, groupKey: 'g', title: 'Playing', sortTitle: 'playing', parsedTitle: 'p' }).returning().get();
    const f = e.ctx.db.insert(mediaFiles).values({ libraryId: lib, movieId: m.id, path: '/media/x/p.mkv', size: 1, mtimeMs: 1 }).returning().get();
    e.ctx.streams.touch({ id: 1, username: 'viewer' }, f.id, 'direct', null);
  };

  it('runs on the configured interval and waits for playback to end, but not forever', async () => {
    env = await createTestEnv();
    const started: number[] = [];
    const enqueueAll = env.ctx.scans.enqueueAll.bind(env.ctx.scans);
    env.ctx.scans.enqueueAll = (...args) => {
      started.push(Date.now());
      enqueueAll(...args);
    };
    const t0 = Date.now();
    env.ctx.scans.configureSchedule(60, t0);
    expect(env.ctx.scans.state().schedule).toMatchObject({ intervalMinutes: 60, nextAt: t0 + 3_600_000, waitingForPlayback: false });

    // Nobody watching: the scan starts and the next one is planned.
    env.ctx.scans.runSchedule(t0 + 3_600_000);
    expect(started).toHaveLength(1);
    expect(env.ctx.scans.state().schedule.nextAt).toBe(t0 + 7_200_000);

    // Someone is watching: wait, checking again in five minutes…
    watching(env);
    env.ctx.scans.runSchedule(t0 + 7_200_000);
    expect(started).toHaveLength(1);
    expect(env.ctx.scans.state().schedule).toMatchObject({ waitingForPlayback: true, nextAt: t0 + 7_200_000 + 300_000 });
    // …but at most one interval (here 60 minutes), then it runs anyway.
    env.ctx.scans.runSchedule(t0 + 7_200_000 + 3_600_000);
    expect(started).toHaveLength(2);
    expect(env.ctx.scans.state().schedule.waitingForPlayback).toBe(false);

    // With waiting switched off, it runs during playback.
    env.ctx.settings.update({ deferScansWhilePlaying: false });
    env.ctx.scans.runSchedule(t0 + 20_000_000);
    expect(started).toHaveLength(3);

    env.ctx.scans.configureSchedule(0);
    expect(env.ctx.scans.state().schedule).toMatchObject({ intervalMinutes: 0, nextAt: null });
    await env.ctx.scans.whenIdle();
  });

  it('gives way to playback between files', async () => {
    env = await createTestEnv({ scanYieldMs: 40 });
    const admin = await setupAdmin(env.app);
    for (let i = 0; i < 4; i++) touch(path.join(env.mediaDir, 'movies', `Film ${i} (200${i}).mkv`));
    watching(env);
    const t = Date.now();
    await addLibrary(env, admin, 'movies', 'movies');
    // Four files, each preceded by a 40 ms pause while someone is watching.
    expect(Date.now() - t).toBeGreaterThanOrEqual(150);
  });

  it('re-analyses every file on a full rescan only', async () => {
    env = await createTestEnv();
    const admin = await setupAdmin(env.app);
    for (let i = 0; i < 3; i++) touch(path.join(env.mediaDir, 'movies', `Film ${i} (200${i}).mkv`));
    const lib = await addLibrary(env, admin, 'movies', 'movies');
    const probes = () => env.probeCalls.length;
    expect(probes()).toBe(3);
    await env.app.inject({ method: 'POST', url: `/api/libraries/${lib.id}/scan`, headers: { cookie: admin }, payload: {} });
    await env.ctx.scans.whenIdle();
    expect(probes()).toBe(3);
    const res = await env.app.inject({ method: 'POST', url: `/api/libraries/${lib.id}/scan`, headers: { cookie: admin }, payload: { full: true } });
    expect(res.statusCode).toBe(200);
    await env.ctx.scans.whenIdle();
    expect(probes()).toBe(6);
    expect((await env.app.inject({ method: 'POST', url: `/api/libraries/${lib.id}/scan`, headers: { cookie: admin }, payload: { full: 'yes' } })).statusCode).toBe(400);
    await env.app.inject({ method: 'POST', url: '/api/libraries/scan-all', headers: { cookie: admin }, payload: { full: true } });
    await env.ctx.scans.whenIdle();
    expect(probes()).toBe(9);
  });

  it('lets admins set the interval, start-up scan and playback behaviour', async () => {
    env = await createTestEnv();
    const admin = await setupAdmin(env.app);
    const put = (payload: object, cookie = admin) => env.app.inject({ method: 'PUT', url: '/api/admin/settings', headers: { cookie }, payload });
    let s = (await env.app.inject({ url: '/api/admin/settings', headers: { cookie: admin } })).json();
    expect(s).toMatchObject({ scanIntervalMinutes: 360, scanIntervalSource: 'environment', scanOnStartup: false, deferScansWhilePlaying: true });
    s = (await put({ scanIntervalMinutes: 60, scanOnStartup: true, deferScansWhilePlaying: false })).json();
    expect(s).toMatchObject({ scanIntervalMinutes: 60, scanIntervalSource: 'settings', scanOnStartup: true, deferScansWhilePlaying: false });
    expect(env.ctx.scans.state().schedule.intervalMinutes).toBe(60);
    s = (await put({ scanIntervalMinutes: 0 })).json();
    expect(env.ctx.scans.state().schedule).toMatchObject({ intervalMinutes: 0, nextAt: null });
    // Back to the environment's value.
    s = (await put({ scanIntervalMinutes: null })).json();
    expect(s).toMatchObject({ scanIntervalMinutes: 360, scanIntervalSource: 'environment' });
    expect((await put({ scanIntervalMinutes: -5 })).statusCode).toBe(400);
    expect((await put({ scanIntervalMinutes: 1.5 })).statusCode).toBe(400);
    const viewer = await createUser(env.app, admin, 'viewer');
    expect((await put({ scanIntervalMinutes: 30 }, viewer.cookie)).statusCode).toBe(403);
    env.ctx.scans.configureSchedule(0);
  });
});
