import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addLibrary, createTestEnv, createUser, setupAdmin, touch, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
let movieId: number;
let showId: number;
let episodeIds: number[];

beforeEach(async () => {
  env = await createTestEnv();
  admin = await setupAdmin(env.app);
  touch(path.join(env.mediaDir, 'movies', 'Interstellar (2014).mkv'));
  touch(path.join(env.mediaDir, 'movies', '100% Wolf (2020).mkv'));
  touch(path.join(env.mediaDir, 'tv', 'Breaking Bad', 'S01E01.mkv'));
  touch(path.join(env.mediaDir, 'tv', 'Breaking Bad', 'S01E02.mkv'));
  touch(path.join(env.mediaDir, 'tv', 'Breaking Bad', 'S02E01.mkv'));
  await addLibrary(env, admin, 'movies', 'movies');
  await addLibrary(env, admin, 'shows', 'tv');
  movieId = (await get('/api/movies')).items.find((m: { title: string }) => m.title === 'Interstellar').id;
  showId = (await get('/api/shows')).items[0].id;
  const s1 = await get(`/api/shows/${showId}/seasons/1`);
  const s2 = await get(`/api/shows/${showId}/seasons/2`);
  episodeIds = [...s1.episodes, ...s2.episodes].map((e: { id: number }) => e.id);
});
afterEach(async () => {
  await env.cleanup();
});

async function get(url: string, cookie = admin) {
  return (await env.app.inject({ url, headers: { cookie } })).json();
}
async function post(url: string, payload: unknown, cookie = admin) {
  return env.app.inject({ method: 'POST', url, headers: { cookie }, payload: payload as object });
}

describe('watch progress', () => {
  it('saves and resumes the playback position', async () => {
    const res = await post('/api/progress', { movieId, positionSec: 2244, durationSec: 10140 });
    expect(res.json()).toMatchObject({ positionSec: 2244, completed: false });
    const m = await get(`/api/movies/${movieId}`);
    expect(m.progress).toMatchObject({ positionSec: 2244, durationSec: 10140, completed: false });
    const home = await get('/api/home');
    expect(home.continueWatching[0]).toMatchObject({ type: 'movie', id: movieId, progress: { positionSec: 2244 } });
  });

  it('marks items watched at 90% and resets the resume point', async () => {
    await post('/api/progress', { movieId, positionSec: 9200, durationSec: 10000 });
    const m = await get(`/api/movies/${movieId}`);
    expect(m.progress).toMatchObject({ completed: true, positionSec: 0 });
    const home = await get('/api/home');
    expect(home.continueWatching).toHaveLength(0);
    expect(home.recentlyWatched[0]).toMatchObject({ type: 'movie', id: movieId });
    const watched = await get('/api/movies?filter=watched');
    expect(watched.total).toBe(1);
    const unwatched = await get('/api/movies?filter=unwatched');
    expect(unwatched.total).toBe(1);
  });

  it('does not list barely started items in Continue Watching', async () => {
    await post('/api/progress', { movieId, positionSec: 5, durationSec: 10000 });
    expect((await get('/api/home')).continueWatching).toHaveLength(0);
  });

  it('offers the next episode after finishing one', async () => {
    await post('/api/progress', { episodeId: episodeIds[1], positionSec: 2900, durationSec: 3000 });
    const home = await get('/api/home');
    expect(home.continueWatching[0]).toMatchObject({ type: 'episode', id: episodeIds[2], showId });
    expect(home.continueWatching[0].subtitle).toContain('S2 E1');
    const show = await get(`/api/shows/${showId}`);
    expect(show.upNext).toMatchObject({ id: episodeIds[2] });
    expect(show.watchedCount).toBe(1);
  });

  it('marks whole seasons/shows as watched and unwatched', async () => {
    await post('/api/progress/watched', { showId, watched: true });
    let show = await get(`/api/shows/${showId}`);
    expect(show.watchedCount).toBe(3);
    await post('/api/progress/watched', { seasonId: show.seasons[0].id, watched: false });
    show = await get(`/api/shows/${showId}`);
    expect(show.watchedCount).toBe(1);
  });

  it('keeps progress separate per user', async () => {
    const bob = await createUser(env.app, admin, 'bob');
    await post('/api/progress', { movieId, positionSec: 600, durationSec: 6000 });
    const m = await get(`/api/movies/${movieId}`, bob.cookie);
    expect(m.progress).toBeNull();
  });

  it('validates the body', async () => {
    expect((await post('/api/progress', { positionSec: 5, durationSec: 10 })).statusCode).toBe(400);
    expect((await post('/api/progress', { movieId, episodeId: episodeIds[0], positionSec: 5, durationSec: 10 })).statusCode).toBe(400);
    expect((await post('/api/progress', { movieId: 99999, positionSec: 5, durationSec: 10 })).statusCode).toBe(404);
    expect((await post('/api/progress', { movieId, positionSec: -1, durationSec: 10 })).statusCode).toBe(400);
  });
});

describe('favorites', () => {
  it('adds and removes favorite movies and shows', async () => {
    expect((await post('/api/favorites', { movieId })).statusCode).toBe(200);
    expect((await post('/api/favorites', { showId })).statusCode).toBe(200);
    expect((await post('/api/favorites', { movieId })).statusCode).toBe(200); // idempotent
    let favs = await get('/api/favorites');
    expect(favs.map((f: { type: string }) => f.type).sort()).toEqual(['movie', 'show']);
    expect((await get(`/api/movies/${movieId}`)).favorite).toBe(true);
    expect((await get('/api/home')).favorites).toHaveLength(2);
    await env.app.inject({ method: 'DELETE', url: `/api/favorites/movie/${movieId}`, headers: { cookie: admin } });
    favs = await get('/api/favorites');
    expect(favs).toHaveLength(1);
    expect(favs[0].type).toBe('show');
  });

  it('rejects unknown items and does not leak between users', async () => {
    expect((await post('/api/favorites', { movieId: 12345 })).statusCode).toBe(404);
    const bob = await createUser(env.app, admin, 'bob');
    await post('/api/favorites', { movieId });
    expect(await get('/api/favorites', bob.cookie)).toHaveLength(0);
  });
});

describe('search and browsing', () => {
  it('finds movies, shows and episodes by partial title', async () => {
    const r = await get('/api/search?q=inter');
    expect(r.movies.map((m: { title: string }) => m.title)).toEqual(['Interstellar']);
    const s = await get('/api/search?q=bad');
    expect(s.shows[0].title).toBe('Breaking Bad');
  });

  it('treats search syntax and wildcards literally', async () => {
    expect((await get('/api/search?q=100%25')).movies.map((m: { title: string }) => m.title)).toEqual(['100% Wolf']);
    for (const q of ['%25', '_', '%22', '*', 'NOT', 'wolf%22 OR %22a', '%25%25%25']) {
      const res = await env.app.inject({ url: `/api/search?q=${q}`, headers: { cookie: admin } });
      expect(res.statusCode, q).toBe(200);
      expect(res.json().movies.length, q).toBeLessThan(2);
    }
  });

  it('matches words by prefix and falls back to substrings', async () => {
    expect((await get('/api/search?q=inter')).movies.map((m: { title: string }) => m.title)).toEqual(['Interstellar']);
    expect((await get('/api/search?q=stellar')).movies.map((m: { title: string }) => m.title)).toEqual(['Interstellar']);
    expect((await get('/api/search?q=bad')).shows.map((s: { title: string }) => s.title)).toEqual(['Breaking Bad']);
  });

  it('paginates and sorts', async () => {
    const page1 = await get('/api/movies?limit=1&page=1&sort=title');
    const page2 = await get('/api/movies?limit=1&page=2&sort=title');
    expect(page1.total).toBe(2);
    expect(page1.items[0].title).toBe('100% Wolf');
    expect(page2.items[0].title).toBe('Interstellar');
    expect((await env.app.inject({ url: '/api/movies?limit=5000', headers: { cookie: admin } })).statusCode).toBe(400);
  });

  it('returns 404 for unknown ids and 400 for malformed ones', async () => {
    expect((await env.app.inject({ url: '/api/movies/9999', headers: { cookie: admin } })).statusCode).toBe(404);
    expect((await env.app.inject({ url: '/api/movies/abc', headers: { cookie: admin } })).statusCode).toBe(400);
  });
});
