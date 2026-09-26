import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { limitProber } from '../src/services/probe-queue.js';
import type { Prober } from '../src/services/probe.js';
import { addLibrary, createTestEnv, fakeProbe, setupAdmin, touch, type TestEnv } from './helpers.js';

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
