import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addLibrary, createTestEnv, createUser, fakeProbe, setupAdmin, touch, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
let movieId: number;
let showId: number;
let episodeIds: number[];

beforeEach(async () => {
  env = await createTestEnv();
  admin = await setupAdmin(env.app);
  touch(path.join(env.mediaDir, 'movies', 'Dune (2021).mkv'));
  for (const f of ['S01E01.mkv', 'S01E02.mkv', 'S01E03.mkv', 'S01E04.mkv', 'S01E05.mkv', 'S01E06.mkv']) touch(path.join(env.mediaDir, 'tv', 'Reacher', f));
  await addLibrary(env, admin, 'movies', 'movies');
  await addLibrary(env, admin, 'shows', 'tv');
  movieId = (await get('/api/movies')).items[0].id;
  showId = (await get('/api/shows')).items[0].id;
  episodeIds = (await get(`/api/shows/${showId}/seasons/1`)).episodes.map((e: { id: number }) => e.id);
});
afterEach(() => env.cleanup());

async function get(url: string, cookie = admin) {
  return (await env.app.inject({ url, headers: { cookie } })).json();
}
async function post(url: string, payload: object, cookie = admin) {
  return env.app.inject({ method: 'POST', url, headers: { cookie }, payload });
}
const cw = async (cookie = admin) => (await get('/api/home', cookie)).continueWatching as Record<string, unknown>[];
const tick = () => new Promise((r) => setTimeout(r, 5));

describe('watching something again', () => {
  it('remembers where a watched movie was stopped, and lists it in Continue Watching', async () => {
    await post('/api/progress', { movieId, positionSec: 9000, durationSec: 9360 });
    expect((await get(`/api/movies/${movieId}`)).progress).toMatchObject({ completed: true, positionSec: 0 });
    // Played again and stopped halfway: it stays watched, with its own resume point.
    await post('/api/progress', { movieId, positionSec: 4000, durationSec: 9360 });
    expect((await get(`/api/movies/${movieId}`)).progress).toMatchObject({ completed: true, positionSec: 4000 });
    expect(await cw()).toEqual([expect.objectContaining({ type: 'movie', id: movieId, progress: { positionSec: 4000, durationSec: 9360 } })]);
  });

  it('counts a second full play, and starts the next play at the beginning again', async () => {
    await post('/api/progress', { movieId, positionSec: 9000, durationSec: 9360 });
    await post('/api/progress', { movieId, positionSec: 9100, durationSec: 9360 });
    await post('/api/progress', { movieId, positionSec: 9360, durationSec: 9360 });
    // Saves after the first finish (credits, the end) are the same play.
    expect((await get('/api/progress'))[0]).toMatchObject({ playCount: 1, positionSec: 0 });
    await post('/api/progress', { movieId, positionSec: 3000, durationSec: 9360 });
    await post('/api/progress', { movieId, positionSec: 9360, durationSec: 9360 });
    expect((await get('/api/progress'))[0]).toMatchObject({ playCount: 2, positionSec: 0, completed: true });
    expect(await cw()).toEqual([]);
  });

  it('never lists a finished play, also for progress saved by older versions', async () => {
    // Older versions kept the position at the end after the credits.
    await post('/api/progress', { movieId, positionSec: 9000, durationSec: 9360 });
    env.ctx.db.$client.prepare('UPDATE watch_progress SET position_sec = 9300').run();
    expect(await cw()).toEqual([]);
  });

  it('resumes a watched episode that is being watched again on the series page', async () => {
    for (const id of episodeIds) await post('/api/progress', { episodeId: id, positionSec: 2950, durationSec: 3000 });
    await post('/api/progress', { episodeId: episodeIds[2], positionSec: 1200, durationSec: 3000 });
    expect((await get(`/api/shows/${showId}`)).upNext).toMatchObject({ id: episodeIds[2], progress: { positionSec: 1200, completed: true } });
  });
});

describe('Continue Watching after watching an earlier episode again', () => {
  it('offers the first episode not seen yet, not one that was already watched', async () => {
    for (const id of episodeIds.slice(0, 5)) {
      await post('/api/progress', { episodeId: id, positionSec: 2950, durationSec: 3000 });
      await tick();
    }
    // Episode 2 watched once more, to the end.
    await post('/api/progress', { episodeId: episodeIds[1], positionSec: 1500, durationSec: 3000 });
    await tick();
    await post('/api/progress', { episodeId: episodeIds[1], positionSec: 2950, durationSec: 3000 });
    expect(await cw()).toEqual([expect.objectContaining({ id: episodeIds[5], episodeNumber: 6, upNext: true })]);
  });

  it('lists nothing once every episode after it has been watched', async () => {
    for (const id of episodeIds) await post('/api/progress', { episodeId: id, positionSec: 2950, durationSec: 3000 });
    await tick();
    await post('/api/progress', { episodeId: episodeIds[0], positionSec: 1500, durationSec: 3000 });
    await tick();
    await post('/api/progress', { episodeId: episodeIds[0], positionSec: 2950, durationSec: 3000 });
    expect(await cw()).toEqual([]);
  });
});

describe('signing in', () => {
  const login = (username: string, password: string) => env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });

  it('ignores the case of the username (phone keyboards capitalise the first letter)', async () => {
    await createUser(env.app, admin, 'anna', 'anna-password');
    const res = await login('Anna', 'anna-password');
    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe('anna');
    expect((await login('ANNA', 'wrong-password')).statusCode).toBe(401);
  });

  it('does not allow names that differ only in case', async () => {
    await createUser(env.app, admin, 'anna', 'anna-password');
    const res = await post('/api/users', { username: 'Anna', password: 'other-password', role: 'user' });
    expect(res.statusCode).toBe(409);
  });

  it('keeps accounts apart that already differ only in case', async () => {
    await createUser(env.app, admin, 'anna', 'anna-password');
    // Only possible in databases from before this check.
    const second = await createUser(env.app, admin, 'bert', 'bert-password');
    env.ctx.db.$client.prepare("UPDATE users SET username = 'Anna' WHERE id = ?").run(second.id);
    expect((await login('Anna', 'bert-password')).json().user.id).toBe(second.id);
    expect((await login('anna', 'anna-password')).statusCode).toBe(200);
    // Ambiguous without the exact case: not signed in.
    expect((await login('ANNA', 'anna-password')).statusCode).toBe(401);
  });
});

describe('libraries', () => {
  it('saving a library without changes does not fail', async () => {
    const lib = (await get('/api/libraries')).libraries[0];
    for (const payload of [{}, { path: lib.path }, { name: lib.name, path: lib.path }]) {
      const res = await env.app.inject({ method: 'PUT', url: `/api/libraries/${lib.id}`, headers: { cookie: admin }, payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(200);
      expect(res.json()).toMatchObject({ id: lib.id, name: lib.name, path: lib.path });
    }
    // Nothing was recorded as changed.
    expect((await get('/api/admin/audit')).items.filter((e: { action: string }) => e.action === 'library.updated')).toEqual([]);
  });
});

describe('series filters', () => {
  const titles = async (filter: string) => (await get(`/api/shows?filter=${filter}`)).items.map((s: { title: string }) => s.title);

  it('lists a series with a started episode under In progress', async () => {
    expect(await titles('in-progress')).toEqual([]);
    await post('/api/progress', { episodeId: episodeIds[0], positionSec: 900, durationSec: 3000 });
    expect(await titles('in-progress')).toEqual(['Reacher']);
    // Barely started (under 30 seconds) does not count.
    await post('/api/progress', { episodeId: episodeIds[0], positionSec: 10, durationSec: 3000 });
    expect(await titles('in-progress')).toEqual([]);
  });

  it('does not list a series as in progress or completed once every episode is watched', async () => {
    await post('/api/progress/watched', { showId, watched: true });
    expect(await titles('completed')).toEqual(['Reacher']);
    expect(await titles('in-progress')).toEqual([]);
  });
});

describe('subtitle choices', () => {
  it('carry the track title and language name, so tracks in the same language can be told apart', async () => {
    const sub = (index: number, title: string | null, isForced = false) => ({ index, codec: 'subrip', language: 'eng', title, isDefault: false, isForced, textBased: true });
    const own = await createTestEnv({ prober: async () => fakeProbe({ subtitleTracks: [sub(2, null), sub(3, 'SDH'), sub(4, 'Commentary'), sub(5, null, true)] }) });
    try {
      const cookie = await setupAdmin(own.app);
      touch(path.join(own.mediaDir, 'movies', 'Heat (1995).mkv'));
      touch(path.join(own.mediaDir, 'movies', 'Heat (1995).en.sdh.srt'), '1\n00:00:01,000 --> 00:00:02,000\nHi\n');
      await addLibrary(own, cookie, 'movies', 'movies');
      const movie = (await own.app.inject({ url: '/api/movies', headers: { cookie } })).json().items[0];
      const fileId = (await own.app.inject({ url: `/api/movies/${movie.id}`, headers: { cookie } })).json().files[0].id;
      const subs = (await own.app.inject({ url: `/api/media/${fileId}/subtitles`, headers: { cookie } })).json();
      expect(subs.map((s: Record<string, unknown>) => [s.kind, s.languageName, s.title, s.forced])).toEqual([
        ['external', 'English', 'SDH', false],
        ['embedded', 'English', null, false],
        ['embedded', 'English', 'SDH', false],
        ['embedded', 'English', 'Commentary', false],
        ['embedded', 'English', null, true],
      ]);
    } finally {
      await own.cleanup();
    }
  });
});

describe('staying signed in', () => {
  it('renews the session cookie when the session is extended, so daily use never signs out', async () => {
    const me = () => env.app.inject({ url: '/api/auth/me', headers: { cookie: admin } });
    // Used within the hour: nothing to renew.
    expect((await me()).cookies.find((c) => c.name === 'velyx_session')).toBeUndefined();
    env.ctx.db.$client.prepare('UPDATE sessions SET last_seen_at = ?').run(Date.now() - 2 * 60 * 60 * 1000);
    const res = await me();
    expect(res.statusCode).toBe(200);
    const renewed = res.cookies.find((c) => c.name === 'velyx_session');
    expect(renewed).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', maxAge: Math.floor(env.ctx.sessions.ttlMs / 1000) });
    // The same session: the renewed cookie keeps working.
    expect(`velyx_session=${renewed!.value}`).toBe(admin);
  });
});

describe('moving a library to another folder', () => {
  it('keeps what was watched, favorites and the watchlist', async () => {
    const fs = await import('node:fs');
    await post('/api/progress', { movieId, positionSec: 1200, durationSec: 9360 });
    await post('/api/favorites', { movieId });
    await post('/api/progress', { episodeId: episodeIds[0], positionSec: 2950, durationSec: 3000 });
    const libs = (await get('/api/libraries')).libraries as Array<{ id: number; type: string; path: string }>;
    for (const lib of libs) {
      const moved = `${lib.path}-moved`;
      fs.renameSync(lib.path, moved);
      const res = await env.app.inject({ method: 'PUT', url: `/api/libraries/${lib.id}`, headers: { cookie: admin }, payload: { path: moved } });
      expect(res.statusCode).toBe(200);
    }
    await env.ctx.scans.whenIdle();
    const movie = await get(`/api/movies/${movieId}`);
    expect(movie).toMatchObject({ favorite: true, progress: { positionSec: 1200 } });
    expect(movie.files[0].fileName).toBe('Dune (2021).mkv');
    expect((await get(`/api/shows/${showId}`)).watchedCount).toBe(1);
  });
});
