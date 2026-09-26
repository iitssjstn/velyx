import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addLibrary, createTestEnv, createUser, rescan, setupAdmin, touch, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
let movieId: number;
let showId: number;
let episodeIds: number[];
let moviesLib: number;

beforeEach(async () => {
  env = await createTestEnv();
  admin = await setupAdmin(env.app);
  touch(path.join(env.mediaDir, 'movies', 'Dune (2021).mkv'));
  for (const f of ['S01E01.mkv', 'S01E02.mkv', 'S01E03.mkv', 'S02E01.mkv']) touch(path.join(env.mediaDir, 'tv', 'Reacher', f));
  moviesLib = (await addLibrary(env, admin, 'movies', 'movies')).id;
  await addLibrary(env, admin, 'shows', 'tv');
  movieId = (await get('/api/movies')).items[0].id;
  showId = (await get('/api/shows')).items[0].id;
  const s1 = await get(`/api/shows/${showId}/seasons/1`);
  const s2 = await get(`/api/shows/${showId}/seasons/2`);
  episodeIds = [...s1.episodes, ...s2.episodes].map((e: { id: number }) => e.id);
});
afterEach(() => env.cleanup());

async function get(url: string, cookie = admin) {
  return (await env.app.inject({ url, headers: { cookie } })).json();
}
async function post(url: string, payload: object, cookie = admin) {
  return env.app.inject({ method: 'POST', url, headers: { cookie }, payload });
}
const cw = async (cookie = admin) => (await get('/api/home', cookie)).continueWatching as Record<string, unknown>[];

describe('Continue Watching', () => {
  it('shows a started episode with its season, episode, position and percentage', async () => {
    await post('/api/progress', { episodeId: episodeIds[1], positionSec: 1934, durationSec: 2901 });
    expect(await cw()).toEqual([
      expect.objectContaining({ type: 'episode', id: episodeIds[1], title: 'Reacher', showId, seasonNumber: 1, episodeNumber: 2, upNext: false, progress: { positionSec: 1934, durationSec: 2901 }, percent: 67 }),
    ]);
  });

  it('lists each show once, with its most recently watched episode', async () => {
    await post('/api/progress', { episodeId: episodeIds[0], positionSec: 600, durationSec: 3000 });
    await new Promise((r) => setTimeout(r, 5));
    await post('/api/progress', { episodeId: episodeIds[2], positionSec: 900, durationSec: 3000 });
    const items = await cw();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: episodeIds[2], episodeNumber: 3 });
  });

  it('never shows finished media, and offers the next episode after one is finished', async () => {
    await post('/api/progress', { movieId, positionSec: 9000, durationSec: 9360 });
    expect(await cw()).toEqual([]);
    await post('/api/progress', { episodeId: episodeIds[2], positionSec: 2950, durationSec: 3000 });
    expect(await cw()).toEqual([expect.objectContaining({ id: episodeIds[3], seasonNumber: 2, episodeNumber: 1, upNext: true, progress: null, percent: 0 })]);
    // The last episode finished: nothing left to continue.
    await post('/api/progress', { episodeId: episodeIds[3], positionSec: 2950, durationSec: 3000 });
    expect(await cw()).toEqual([]);
  });

  it('Mark as Watched moves a show on to its next episode and removes a movie', async () => {
    await post('/api/progress', { movieId, positionSec: 1200, durationSec: 9360 });
    await post('/api/progress', { episodeId: episodeIds[0], positionSec: 800, durationSec: 3000 });
    expect(await cw()).toHaveLength(2);
    expect((await post('/api/progress/watched', { movieId, watched: true })).statusCode).toBe(200);
    expect((await post('/api/progress/watched', { episodeId: episodeIds[0], watched: true })).statusCode).toBe(200);
    expect(await cw()).toEqual([expect.objectContaining({ id: episodeIds[1], upNext: true })]);
  });

  it('Remove hides an item until it is watched again, without touching its progress', async () => {
    await post('/api/progress', { movieId, positionSec: 1200, durationSec: 9360 });
    await post('/api/home/continue/dismiss', { type: 'movie', id: movieId });
    expect(await cw()).toEqual([]);
    expect((await get(`/api/movies/${movieId}`)).progress).toMatchObject({ positionSec: 1200 });
    await new Promise((r) => setTimeout(r, 5));
    await post('/api/progress', { movieId, positionSec: 1300, durationSec: 9360 });
    expect(await cw()).toEqual([expect.objectContaining({ type: 'movie', id: movieId })]);
  });

  it('Start Over from the beginning does not leave a stale entry', async () => {
    await post('/api/progress', { movieId, positionSec: 4000, durationSec: 9360 });
    // Restarting saves an early position: barely started items are not listed.
    await post('/api/progress', { movieId, positionSec: 10, durationSec: 9360 });
    expect(await cw()).toEqual([]);
    await post('/api/progress', { movieId, positionSec: 95, durationSec: 9360 });
    expect(await cw()).toEqual([expect.objectContaining({ id: movieId, progress: { positionSec: 95, durationSec: 9360 } })]);
  });

  it('is per user', async () => {
    const anna = await createUser(env.app, admin, 'anna');
    await post('/api/progress', { movieId, positionSec: 1200, durationSec: 9360 });
    await post('/api/progress', { episodeId: episodeIds[1], positionSec: 700, durationSec: 3000 }, anna.cookie);
    expect((await cw()).map((c) => c.type)).toEqual(['movie']);
    expect((await cw(anna.cookie)).map((c) => c.id)).toEqual([episodeIds[1]]);
    // One user's Remove does not affect the other.
    await post('/api/home/continue/dismiss', { type: 'episode', id: episodeIds[1] }, anna.cookie);
    expect(await cw(anna.cookie)).toEqual([]);
    expect(await cw()).toHaveLength(1);
  });

  it('checks access for its actions', async () => {
    const anna = await createUser(env.app, admin, 'anna');
    // Limit anna to the TV library: the movie does not exist for her.
    const tv = (await get('/api/libraries')).libraries.find((l: { type: string }) => l.type === 'shows').id;
    await env.app.inject({ method: 'PUT', url: `/api/users/${anna.id}`, headers: { cookie: admin }, payload: { libraryIds: [tv] } });
    expect((await post('/api/home/continue/dismiss', { type: 'movie', id: movieId }, anna.cookie)).statusCode).toBe(404);
    expect((await post('/api/progress/watched', { movieId, watched: true }, anna.cookie)).statusCode).toBe(404);
    expect((await post('/api/home/continue/dismiss', { type: 'show', id: showId }, anna.cookie)).statusCode).toBe(400);
    expect((await env.app.inject({ method: 'POST', url: '/api/home/continue/dismiss', payload: { type: 'movie', id: movieId } })).statusCode).toBe(401);
  });

  it('keeps the entry when the file is replaced by a new version', async () => {
    await post('/api/progress', { movieId, positionSec: 1200, durationSec: 9360 });
    const dir = path.join(env.mediaDir, 'movies');
    fs.rmSync(path.join(dir, 'Dune (2021).mkv'));
    touch(path.join(dir, 'Dune (2021) 2160p.mkv'), 'x'.repeat(500));
    await rescan(env, moviesLib);
    expect(await cw()).toEqual([expect.objectContaining({ type: 'movie', title: 'Dune', progress: { positionSec: 1200, durationSec: 9360 } })]);
  });
});
