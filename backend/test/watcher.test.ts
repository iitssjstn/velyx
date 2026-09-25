import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addLibrary, createTestEnv, setupAdmin, touch, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
beforeEach(async () => {
  env = await createTestEnv({ watchDebounceMs: 150 });
  env.ctx.settings.update({ watchFolders: true });
  admin = await setupAdmin(env.app);
});
afterEach(async () => {
  env.ctx.watcher.stop();
  await env.cleanup();
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function titles() {
  const res = await env.app.inject({ url: '/api/movies', headers: { cookie: admin } });
  return res.json().items.map((m: { title: string }) => m.title).sort();
}
async function settle() {
  await wait(700);
  await env.ctx.scans.whenIdle();
}

describe('automatic library updates (folder watching)', () => {
  it('picks up new and removed files without a manual scan', async () => {
    touch(path.join(env.mediaDir, 'movies', 'Alien (1979).mkv'));
    const lib = await addLibrary(env, admin, 'movies', 'movies');
    env.ctx.watcher.sync(true);
    expect(env.ctx.watcher.isWatching(lib.id)).toBe(true);

    touch(path.join(env.mediaDir, 'movies', 'Aliens (1986)', 'Aliens (1986).mkv'));
    await settle();
    expect(await titles()).toEqual(['Alien', 'Aliens']);

    fs.rmSync(path.join(env.mediaDir, 'movies', 'Aliens (1986)'), { recursive: true });
    await settle();
    expect(await titles()).toEqual(['Alien']);
  });

  it('ignores unrelated files and partial downloads', async () => {
    touch(path.join(env.mediaDir, 'movies', 'Alien (1979).mkv'));
    await addLibrary(env, admin, 'movies', 'movies');
    env.ctx.watcher.sync(true);
    const before = env.probeCalls.length;
    touch(path.join(env.mediaDir, 'movies', 'notes.txt'));
    touch(path.join(env.mediaDir, 'movies', 'Big Movie (2020).mkv.part'));
    await settle();
    expect(env.probeCalls.length).toBe(before);
  });

  it('can be switched off in the server settings and reports status per library', async () => {
    const lib = await addLibrary(env, admin, 'movies', 'movies');
    env.ctx.watcher.sync(true);
    let libs = (await env.app.inject({ url: '/api/libraries', headers: { cookie: admin } })).json().libraries;
    expect(libs[0]).toMatchObject({ id: lib.id, watching: true, watchError: null });
    const res = await env.app.inject({ method: 'PUT', url: '/api/admin/settings', headers: { cookie: admin }, payload: { watchFolders: false } });
    expect(res.json().watchFolders).toBe(false);
    libs = (await env.app.inject({ url: '/api/libraries', headers: { cookie: admin } })).json().libraries;
    expect(libs[0].watching).toBe(false);
    touch(path.join(env.mediaDir, 'movies', 'Heat (1995).mkv'));
    await settle();
    expect(await titles()).toEqual([]);
  });

  it('follows libraries that are added and removed', async () => {
    env.ctx.watcher.sync(true);
    const lib = await addLibrary(env, admin, 'movies', 'movies');
    expect(env.ctx.watcher.isWatching(lib.id)).toBe(true);
    await env.app.inject({ method: 'DELETE', url: `/api/libraries/${lib.id}`, headers: { cookie: admin } });
    expect(env.ctx.watcher.isWatching(lib.id)).toBe(false);
  });
});
