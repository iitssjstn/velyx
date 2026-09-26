import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectionItems, collections, credits, genres, libraries, mediaFiles, movieGenres, movies, people } from '../src/db/schema.js';
import { rankCandidates } from '../src/services/recommendations.js';
import { addLibrary, createTestEnv, createUser, setupAdmin, touch, type TestEnv } from './helpers.js';
import path from 'node:path';

let env: TestEnv;
let admin: string;
beforeEach(async () => {
  env = await createTestEnv();
  admin = await setupAdmin(env.app);
});
afterEach(async () => {
  await env.cleanup();
});

const get = async (url: string, cookie = admin) => {
  const res = await env.app.inject({ url, headers: { cookie } });
  expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
  return res.json();
};
const send = (method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: object, cookie = admin) => env.app.inject({ method, url, headers: { cookie }, payload });

function seed() {
  const db = env.ctx.db;
  const lib = db.insert(libraries).values({ name: 'm', type: 'movies', path: '/media/m' }).returning().get().id;
  const add = (title: string, year: number, extra: Partial<typeof movies.$inferInsert> = {}, file: Partial<typeof mediaFiles.$inferInsert> = {}) => {
    const m = db.insert(movies).values({ libraryId: lib, groupKey: title, title, sortTitle: title.toLowerCase(), parsedTitle: title, year, matchStatus: 'matched', posterPath: `/${title}.jpg`, ...extra }).returning().get();
    db.insert(mediaFiles).values({ libraryId: lib, movieId: m.id, path: `/media/m/${title}.mkv`, size: 1, mtimeMs: 1, width: 1920, height: 1080, videoRange: 'SDR', ...file }).run();
    return m.id;
  };
  return { lib, add };
}

describe('smart collections', () => {
  it('evaluates built-in filters per viewer and hides empty ones', async () => {
    const { add } = seed();
    const heat = add('Heat', 1995, { rating: 8.3, runtime: 170 });
    add('Clerks', 1994, { rating: 7.7, runtime: 92 });
    add('Dune', 2021, { rating: 8.0, runtime: 155 }, { width: 3840, height: 2160, videoRange: 'HDR10' });
    const list = await get('/api/collections/smart');
    const byKey = Object.fromEntries(list.map((c: { key: string; count: number }) => [c.key, c.count]));
    expect(byKey).toMatchObject({ 'recently-added': 3, unwatched: 3, 'top-rated': 2, '4k': 1, '1080p': 2, hdr: 1, short: 1, 'decade-1990': 2 });
    expect(byKey.favorites).toBeUndefined();
    expect(byKey['decade-2020']).toBeUndefined(); // only one movie from the 2020s
    const fourK = list.find((c: { key: string }) => c.key === '4k');
    expect(fourK).toMatchObject({ name: '4K Movies', kind: 'movies', query: { resolution: '4k' }, posterPath: '/Dune.jpg', custom: false });

    const viewer = await createUser(env.app, admin, 'viewer');
    await send('POST', '/api/progress', { movieId: heat, positionSec: 95, durationSec: 100 }, viewer.cookie);
    await send('POST', '/api/favorites', { movieId: heat }, viewer.cookie);
    const mine = Object.fromEntries((await get('/api/collections/smart', viewer.cookie)).map((c: { key: string; count: number }) => [c.key, c.count]));
    expect(mine).toMatchObject({ unwatched: 2, favorites: 1 });
    // The browse API gives the same items as the count.
    expect((await get('/api/movies?maxRuntime=95')).total).toBe(1);
  });

  it('lets admins save their own smart collections, validated', async () => {
    seed().add('Alien', 1979, { rating: 8.5 });
    const viewer = await createUser(env.app, admin, 'viewer');
    expect((await send('POST', '/api/collections/smart', { name: 'x', kind: 'movies', query: { minRating: '8' } }, viewer.cookie)).statusCode).toBe(403);
    expect((await send('POST', '/api/collections/smart', { name: 'Bad', kind: 'movies', query: { page: '2' } })).statusCode).toBe(400);
    expect((await send('POST', '/api/collections/smart', { name: 'Bad', kind: 'movies', query: { resolution: '8k' } })).statusCode).toBe(400);
    const created = (await send('POST', '/api/collections/smart', { name: 'Seventies classics', kind: 'movies', query: { yearFrom: '1970', yearTo: '1979', minRating: '8' } })).json();
    const smart = (await get('/api/collections/smart', viewer.cookie)).find((c: { id: number | null }) => c.id === created.id);
    expect(smart).toMatchObject({ name: 'Seventies classics', count: 1, custom: true });
    // Smart collections are not listed as regular collections and cannot hold items.
    expect((await get('/api/collections')).some((c: { id: number }) => c.id === created.id)).toBe(false);
    expect((await send('POST', `/api/collections/${created.id}/items`, { movieId: 1 })).statusCode).toBe(400);
    expect((await send('DELETE', `/api/collections/${created.id}`)).statusCode).toBe(200);
  });
});

describe('More Like This', () => {
  it('ranks by collection, director, cast and genres, deterministically', () => {
    const cand = (o: Partial<{ genres: number; cast: number; director: number; collection: number; year: number | null; rating: number | null }>) => ({ genres: 0, cast: 0, director: 0, collection: 0, year: null, rating: null, ...o });
    const ranked = rankCandidates(
      { year: 2000 },
      new Map([
        [1, cand({ genres: 1 })], // too weak on its own
        [2, cand({ genres: 2, year: 2003 })],
        [3, cand({ collection: 1, genres: 1 })],
        [4, cand({ director: 1, cast: 1 })],
      ]),
      10,
    );
    expect(ranked.map((r) => r.id)).toEqual([3, 4, 2]);
  });

  it('suggests related movies the viewer can see', async () => {
    const { add } = seed();
    const db = env.ctx.db;
    const matrix = add('The Matrix', 1999);
    const reloaded = add('The Matrix Reloaded', 2003);
    const johnWick = add('John Wick', 2014);
    const notebook = add('The Notebook', 2004);
    const scifi = db.insert(genres).values({ name: 'Science Fiction' }).returning().get().id;
    const action = db.insert(genres).values({ name: 'Action' }).returning().get().id;
    const romance = db.insert(genres).values({ name: 'Romance' }).returning().get().id;
    for (const [m, g] of [[matrix, scifi], [matrix, action], [reloaded, scifi], [reloaded, action], [johnWick, action], [notebook, romance]] as const) db.insert(movieGenres).values({ movieId: m, genreId: g }).run();
    const keanu = db.insert(people).values({ tmdbId: 6384, name: 'Keanu Reeves' }).returning().get().id;
    for (const m of [matrix, reloaded, johnWick]) db.insert(credits).values({ movieId: m, personId: keanu, kind: 'cast', role: 'Lead', sortOrder: 0 }).run();
    const coll = db.insert(collections).values({ kind: 'auto', tmdbId: 2344, name: 'The Matrix Collection', sortTitle: 'matrix collection' }).returning().get().id;
    for (const m of [matrix, reloaded]) db.insert(collectionItems).values({ collectionId: coll, movieId: m }).run();

    const similar = await get(`/api/movies/${matrix}/similar`);
    expect(similar.map((c: { title: string }) => c.title)).toEqual(['The Matrix Reloaded', 'John Wick']);
    expect((await env.app.inject({ url: `/api/movies/99999/similar`, headers: { cookie: admin } })).statusCode).toBe(404);
  });
});

describe('Continue Watching and watched controls', () => {
  beforeEach(async () => {
    touch(path.join(env.mediaDir, 'movies', 'Heat (1995).mkv'));
    touch(path.join(env.mediaDir, 'tv', 'Severance', 'S01E01.mkv'));
    touch(path.join(env.mediaDir, 'tv', 'Severance', 'S01E02.mkv'));
    touch(path.join(env.mediaDir, 'tv', 'Severance', 'S02E01.mkv'));
    await addLibrary(env, admin, 'movies', 'movies');
    await addLibrary(env, admin, 'shows', 'tv');
  });

  it('removes items from Continue Watching until they are watched again', async () => {
    const movieId = (await get('/api/movies')).items[0].id;
    await send('POST', '/api/progress', { movieId, positionSec: 600, durationSec: 6000 });
    expect((await get('/api/home')).continueWatching).toHaveLength(1);
    await send('POST', '/api/home/continue/dismiss', { type: 'movie', id: movieId });
    expect((await get('/api/home')).continueWatching).toHaveLength(0);
    // Progress is kept.
    expect((await get(`/api/movies/${movieId}`)).progress.positionSec).toBe(600);
    await new Promise((r) => setTimeout(r, 5));
    await send('POST', '/api/progress', { movieId, positionSec: 700, durationSec: 6000 });
    expect((await get('/api/home')).continueWatching).toHaveLength(1);
  });

  it('dismisses a show via its next-up episode', async () => {
    const show = (await get('/api/shows')).items[0];
    const eps = (await get(`/api/shows/${show.id}/seasons/1`)).episodes;
    await send('POST', '/api/progress', { episodeId: eps[0].id, positionSec: 95, durationSec: 100 });
    const cw = (await get('/api/home')).continueWatching;
    expect(cw[0]).toMatchObject({ type: 'episode', id: eps[1].id, subtitle: expect.stringMatching(/^Next: S1 E2/) });
    await send('POST', '/api/home/continue/dismiss', { type: 'episode', id: eps[1].id });
    expect((await get('/api/home')).continueWatching).toHaveLength(0);
  });

  it('marks seasons and whole series watched and unwatched, including partly watched ones', async () => {
    const show = (await get('/api/shows')).items[0];
    const detail = await get(`/api/shows/${show.id}`);
    const s1 = detail.seasons.find((s: { seasonNumber: number }) => s.seasonNumber === 1);
    const eps = (await get(`/api/shows/${show.id}/seasons/1`)).episodes;
    await send('POST', '/api/progress/watched', { episodeId: eps[0].id, watched: true });
    // Partly watched season → unwatch all of it.
    await send('POST', '/api/progress/watched', { seasonId: s1.id, watched: false });
    expect((await get(`/api/shows/${show.id}`)).watchedCount).toBe(0);
    await send('POST', '/api/progress/watched', { seasonId: s1.id, watched: true });
    expect((await get(`/api/shows/${show.id}`)).watchedCount).toBe(2);
    await send('POST', '/api/progress/watched', { showId: show.id, watched: true });
    expect((await get(`/api/shows/${show.id}`)).watchedCount).toBe(3);
    await send('POST', '/api/progress/watched', { showId: show.id, watched: false });
    expect((await get(`/api/shows/${show.id}`)).watchedCount).toBe(0);
  });
});

describe('language preferences', () => {
  it('stores preferences per account and validates them', async () => {
    const viewer = await createUser(env.app, admin, 'viewer');
    expect(await get('/api/account/preferences', viewer.cookie)).toEqual({ audioLanguage: '', subtitleLanguage: '', subtitleFallback: '', subtitleMode: 'remember' });
    const saved = (await send('PUT', '/api/account/preferences', { audioLanguage: 'NL', subtitleLanguage: 'nl', subtitleFallback: 'en', subtitleMode: 'foreign' }, viewer.cookie)).json();
    expect(saved).toEqual({ audioLanguage: 'nl', subtitleLanguage: 'nl', subtitleFallback: 'en', subtitleMode: 'foreign' });
    expect((await get('/api/account/preferences')).subtitleMode).toBe('remember');
    expect((await send('PUT', '/api/account/preferences', { subtitleMode: 'sometimes' }, viewer.cookie)).statusCode).toBe(400);
    expect((await send('PUT', '/api/account/preferences', { audioLanguage: 'dutch!' }, viewer.cookie)).statusCode).toBe(400);
  });
});
