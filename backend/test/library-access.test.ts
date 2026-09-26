import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addLibrary, createTestEnv, createUser, setupAdmin, touch, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
let kidsLib: number;
let moviesLib: number;
let tvLib: number;
let kidsMovieId: number;
let adultMovieId: number;
let showId: number;
let episodeId: number;

beforeEach(async () => {
  env = await createTestEnv();
  admin = await setupAdmin(env.app);
  touch(path.join(env.mediaDir, 'kids', 'Frozen (2013).mkv'));
  touch(path.join(env.mediaDir, 'movies', 'Heat (1995).mkv'));
  touch(path.join(env.mediaDir, 'tv', 'Severance', 'S01E01.mkv'));
  kidsLib = (await addLibrary(env, admin, 'movies', 'kids')).id;
  moviesLib = (await addLibrary(env, admin, 'movies', 'movies')).id;
  tvLib = (await addLibrary(env, admin, 'shows', 'tv')).id;
  const all = await get('/api/movies');
  kidsMovieId = all.items.find((m: { title: string }) => m.title === 'Frozen').id;
  adultMovieId = all.items.find((m: { title: string }) => m.title === 'Heat').id;
  showId = (await get('/api/shows')).items[0].id;
  episodeId = (await get(`/api/shows/${showId}/seasons/1`)).episodes[0].id;
});
afterEach(async () => {
  await env.cleanup();
});

async function get(url: string, cookie = admin) {
  return (await env.app.inject({ url, headers: { cookie } })).json();
}
async function status(url: string, cookie: string, method: 'GET' | 'POST' = 'GET', payload?: object) {
  return (await env.app.inject({ method, url, headers: { cookie }, payload })).statusCode;
}
async function grant(userId: number, libraryIds: number[] | null) {
  const res = await env.app.inject({ method: 'PUT', url: `/api/users/${userId}`, headers: { cookie: admin }, payload: { libraryIds } });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe('per-user library access', () => {
  it('gives new users every library by default', async () => {
    const user = await createUser(env.app, admin, 'viewer');
    expect((await get('/api/movies', user.cookie)).total).toBe(2);
    const users = await get('/api/users');
    expect(users.find((u: { id: number }) => u.id === user.id).libraryIds).toBeNull();
  });

  it('hides libraries the user was not granted everywhere', async () => {
    const kid = await createUser(env.app, admin, 'kid');
    const view = await grant(kid.id, [kidsLib]);
    expect(view.libraryIds).toEqual([kidsLib]);
    const c = kid.cookie;

    const list = await get('/api/movies', c);
    expect(list.total).toBe(1);
    expect(list.items[0].id).toBe(kidsMovieId);
    expect((await get('/api/shows', c)).total).toBe(0);
    expect((await get('/api/search?q=e', c)).movies.map((m: { id: number }) => m.id)).toEqual([kidsMovieId]);
    expect((await get('/api/search?q=Severance', c)).shows).toHaveLength(0);
    const home = await get('/api/home', c);
    expect(home.counts).toEqual({ movies: 1, shows: 0, libraries: 1 });
    expect(home.recentlyAdded.map((x: { id: number }) => x.id)).toEqual([kidsMovieId]);

    // Hidden items answer 404, including their files and streams.
    expect(await status(`/api/movies/${adultMovieId}`, c)).toBe(404);
    expect(await status(`/api/shows/${showId}`, c)).toBe(404);
    expect(await status(`/api/shows/${showId}/seasons/1`, c)).toBe(404);
    expect(await status(`/api/episodes/${episodeId}`, c)).toBe(404);
    const adultFile = (await get(`/api/movies/${adultMovieId}`)).files[0].id;
    expect(await status(`/api/media/${adultFile}/stream`, c)).toBe(404);
    expect(await status(`/api/media/${adultFile}/playback`, c, 'POST', {})).toBe(404);
    expect(await status('/api/progress', c, 'POST', { movieId: adultMovieId, positionSec: 10, durationSec: 100 })).toBe(404);
    expect(await status('/api/favorites', c, 'POST', { movieId: adultMovieId })).toBe(404);
    expect(await status('/api/watchlist', c, 'POST', { showId })).toBe(404);
    expect(await status('/api/progress/watched', c, 'POST', { showId, watched: true })).toBe(404);

    // Allowed items keep working.
    const kidsFile = (await get(`/api/movies/${kidsMovieId}`, c)).files[0].id;
    expect(await status(`/api/media/${kidsFile}/playback`, c, 'POST', {})).toBe(200);
  });

  it('drops saved items from lists once access is revoked', async () => {
    const user = await createUser(env.app, admin, 'viewer');
    await env.app.inject({ method: 'POST', url: '/api/favorites', headers: { cookie: user.cookie }, payload: { movieId: adultMovieId } });
    await env.app.inject({ method: 'POST', url: '/api/progress', headers: { cookie: user.cookie }, payload: { movieId: adultMovieId, positionSec: 600, durationSec: 6000 } });
    expect(await get('/api/favorites', user.cookie)).toHaveLength(1);
    expect((await get('/api/home', user.cookie)).continueWatching).toHaveLength(1);

    await grant(user.id, [kidsLib, tvLib]);
    expect(await get('/api/favorites', user.cookie)).toHaveLength(0);
    expect((await get('/api/home', user.cookie)).continueWatching).toHaveLength(0);

    // Restoring access brings everything back (nothing was deleted).
    await grant(user.id, null);
    expect(await get('/api/favorites', user.cookie)).toHaveLength(1);
  });

  it('an empty grant list shows nothing, and admins always see everything', async () => {
    const user = await createUser(env.app, admin, 'viewer');
    await grant(user.id, []);
    expect((await get('/api/movies', user.cookie)).total).toBe(0);
    expect((await get('/api/home', user.cookie)).counts).toEqual({ movies: 0, shows: 0, libraries: 0 });

    const other = await createUser(env.app, admin, 'boss', 'boss-password', 'admin');
    await grant(other.id, [kidsLib]);
    expect((await get('/api/movies', other.cookie)).total).toBe(2);
  });

  it('removes grants for deleted libraries', async () => {
    const user = await createUser(env.app, admin, 'viewer');
    await grant(user.id, [moviesLib, kidsLib]);
    await env.app.inject({ method: 'DELETE', url: `/api/libraries/${moviesLib}`, headers: { cookie: admin } });
    const users = await get('/api/users');
    expect(users.find((u: { id: number }) => u.id === user.id).libraryIds).toEqual([kidsLib]);
  });

  it('accepts library access when creating a user and ignores unknown ids', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { cookie: admin },
      payload: { username: 'guest', password: 'guest-password', libraryIds: [tvLib, 9999] },
    });
    expect(res.json().libraryIds).toEqual([tvLib]);
  });
});

describe('watchlist', () => {
  it('adds, lists and removes items', async () => {
    const user = await createUser(env.app, admin, 'viewer');
    const c = user.cookie;
    await env.app.inject({ method: 'POST', url: '/api/watchlist', headers: { cookie: c }, payload: { movieId: kidsMovieId } });
    await env.app.inject({ method: 'POST', url: '/api/watchlist', headers: { cookie: c }, payload: { showId } });
    // Adding twice is harmless.
    await env.app.inject({ method: 'POST', url: '/api/watchlist', headers: { cookie: c }, payload: { showId } });

    const list = await get('/api/watchlist', c);
    expect(list.map((x: { type: string; id: number }) => `${x.type}-${x.id}`)).toEqual([`show-${showId}`, `movie-${kidsMovieId}`]);
    expect((await get(`/api/movies/${kidsMovieId}`, c)).watchlist).toBe(true);
    expect((await get(`/api/shows/${showId}`, c)).watchlist).toBe(true);
    expect((await get('/api/home', c)).watchlist).toHaveLength(2);
    // Watchlists are personal.
    expect(await get('/api/watchlist')).toHaveLength(0);

    const del = await env.app.inject({ method: 'DELETE', url: `/api/watchlist/show/${showId}`, headers: { cookie: c } });
    expect(del.json()).toEqual({ watchlist: false });
    expect(await get('/api/watchlist', c)).toHaveLength(1);
  });

  it('removes a movie once it has been watched', async () => {
    await env.app.inject({ method: 'POST', url: '/api/watchlist', headers: { cookie: admin }, payload: { movieId: kidsMovieId } });
    await env.app.inject({ method: 'POST', url: '/api/watchlist', headers: { cookie: admin }, payload: { movieId: adultMovieId } });
    await env.app.inject({ method: 'POST', url: '/api/progress', headers: { cookie: admin }, payload: { movieId: kidsMovieId, positionSec: 95, durationSec: 100 } });
    await env.app.inject({ method: 'POST', url: '/api/progress/watched', headers: { cookie: admin }, payload: { movieId: adultMovieId, watched: true } });
    expect(await get('/api/watchlist')).toHaveLength(0);
  });

  it('removes a show when the whole show is marked watched', async () => {
    await env.app.inject({ method: 'POST', url: '/api/watchlist', headers: { cookie: admin }, payload: { showId } });
    await env.app.inject({ method: 'POST', url: '/api/progress/watched', headers: { cookie: admin }, payload: { showId, watched: true } });
    expect(await get('/api/watchlist')).toHaveLength(0);
  });
});
