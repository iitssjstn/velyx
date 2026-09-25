import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { addLibrary, createTestEnv, rescan, setupAdmin, touch, type TestEnv } from './helpers.js';
import { createMockTmdb, type MockTmdb } from './tmdb-mock.js';

let env: TestEnv;
let tmdb: MockTmdb;
let admin: string;

async function start(withKey = true) {
  tmdb = createMockTmdb();
  env = await createTestEnv({ fetchImpl: tmdb.fetch, tmdbKey: withKey ? 'test-key' : '' });
  admin = await setupAdmin(env.app);
}
afterEach(async () => {
  await env.cleanup();
});
const get = async (url: string) => (await env.app.inject({ url, headers: { cookie: admin } })).json();

describe('TMDB metadata', () => {
  it('matches movies using title + year and stores genres, cast and director', async () => {
    await start();
    touch(path.join(env.mediaDir, 'movies', 'Interstellar.2014.1080p.BluRay.x264.mkv'));
    await addLibrary(env, admin, 'movies', 'movies');
    const [card] = (await get('/api/movies')).items;
    const m = await get(`/api/movies/${card.id}`);
    expect(m).toMatchObject({ title: 'Interstellar', year: 2014, tmdbId: 157336, imdbId: 'tt157336', director: 'Christopher Nolan', runtime: 169 });
    expect(m.match.status).toBe('matched');
    expect(m.match.confidence).toBeGreaterThan(0.9);
    expect(m.genres.map((g: { name: string }) => g.name)).toEqual(expect.arrayContaining(['Drama', 'Science Fiction']));
    expect(m.cast[0]).toMatchObject({ name: 'Matthew McConaughey', role: 'Cooper' });
    const genres = await get('/api/genres');
    expect(genres.length).toBe(3);
  });

  it('caches artwork locally and serves it without hitting TMDB again', async () => {
    await start();
    touch(path.join(env.mediaDir, 'movies', 'Interstellar (2014).mkv'));
    await addLibrary(env, admin, 'movies', 'movies');
    const cached = path.join(env.ctx.config.cacheDir, 'images', 'w342', '157336-poster.jpg');
    expect(fs.existsSync(cached)).toBe(true);
    const before = tmdb.calls.length;
    const img = await env.app.inject({ url: '/api/images/w342/157336-poster.jpg', headers: { cookie: admin } });
    expect(img.statusCode).toBe(200);
    expect(tmdb.calls.length).toBe(before);
  });

  it('keeps working from the local cache when TMDB is offline', async () => {
    await start();
    touch(path.join(env.mediaDir, 'movies', 'Interstellar (2014).mkv'));
    const lib = await addLibrary(env, admin, 'movies', 'movies');
    tmdb.offline = true;
    await rescan(env, lib.id);
    const [card] = (await get('/api/movies')).items;
    expect(card).toMatchObject({ title: 'Interstellar', posterPath: '/157336-poster.jpg' });
    const img = await env.app.inject({ url: '/api/images/w342/157336-poster.jpg', headers: { cookie: admin } });
    expect(img.statusCode).toBe(200);
    const home = await env.app.inject({ url: '/api/home', headers: { cookie: admin } });
    expect(home.statusCode).toBe(200);
  });

  it('does not search TMDB for unchanged items on rescans', async () => {
    await start();
    touch(path.join(env.mediaDir, 'movies', 'Interstellar (2014).mkv'));
    const lib = await addLibrary(env, admin, 'movies', 'movies');
    const before = tmdb.calls.length;
    await rescan(env, lib.id);
    expect(tmdb.calls.length).toBe(before);
  });

  it('leaves ambiguous items for review and supports Fix Match', async () => {
    await start();
    touch(path.join(env.mediaDir, 'movies', 'Some Obscure Film (1950).mkv'));
    await addLibrary(env, admin, 'movies', 'movies');
    const review = await get('/api/admin/review');
    expect(review.movies).toHaveLength(1);
    expect(review.movies[0]).toMatchObject({ status: 'unmatched', parsedTitle: 'Some Obscure Film', parsedYear: 1950 });
    const search = await get('/api/admin/match/search?type=movie&query=matrix&year=1999');
    expect(search[0]).toMatchObject({ id: 603, title: 'The Matrix', year: 1999 });
    expect(search[0].confidence).toBeGreaterThan(search[1].confidence);
    const fix = await env.app.inject({
      method: 'POST',
      url: '/api/admin/match',
      headers: { cookie: admin },
      payload: { type: 'movie', id: review.movies[0].id, tmdbId: 603 },
    });
    expect(fix.statusCode).toBe(200);
    const m = await get(`/api/movies/${fix.json().id}`);
    expect(m).toMatchObject({ title: 'The Matrix', tmdbId: 603 });
    expect(m.match.status).toBe('manual');
    expect((await get('/api/admin/review')).movies).toHaveLength(0);
  });

  it('merges duplicates that resolve to the same TMDB movie', async () => {
    await start();
    touch(path.join(env.mediaDir, 'movies', 'Interstellar (2014).mkv'));
    touch(path.join(env.mediaDir, 'movies', 'Interstellar IMAX edition 2014', 'movie.mkv'));
    await addLibrary(env, admin, 'movies', 'movies');
    const list = await get('/api/movies');
    expect(list.total).toBe(1);
    const m = await get(`/api/movies/${list.items[0].id}`);
    expect(m.files).toHaveLength(2);
  });

  it('matches shows and fills in season and episode metadata', async () => {
    await start();
    const root = path.join(env.mediaDir, 'tv');
    touch(path.join(root, 'Breaking Bad', 'Season 01', 'Breaking.Bad.S01E01.mkv'));
    touch(path.join(root, 'Breaking Bad', 'Season 01', 'Breaking.Bad.S01E02.mkv'));
    const lib = await addLibrary(env, admin, 'shows', 'tv');
    const [card] = (await get('/api/shows')).items;
    const show = await get(`/api/shows/${card.id}`);
    expect(show).toMatchObject({ title: 'Breaking Bad', network: 'AMC', status: 'Ended', tmdbId: 1396, imdbId: 'tt0903747' });
    expect(show.cast[0].name).toBe('Bryan Cranston');
    const s1 = await get(`/api/shows/${card.id}/seasons/1`);
    expect(s1.episodes[0]).toMatchObject({ title: 'Episode title 1x1', runtime: 58, stillPath: '/still-1-1.jpg' });
    expect(fs.existsSync(path.join(env.ctx.config.cacheDir, 'images', 'w300', 'still-1-1.jpg'))).toBe(true);

    // a new episode in an already matched show only refreshes that season
    touch(path.join(root, 'Breaking Bad', 'Season 01', 'Breaking.Bad.S01E03.mkv'));
    tmdb.calls.length = 0;
    await rescan(env, lib.id);
    expect(tmdb.calls.some((c) => c.startsWith('/3/search'))).toBe(false);
    expect(tmdb.calls.some((c) => c.startsWith('/3/tv/1396/season/1'))).toBe(true);
    const again = await get(`/api/shows/${card.id}/seasons/1`);
    expect(again.episodes[2].title).toBe('Episode title 1x3');
  });

  it('refresh metadata re-fetches matched items', async () => {
    await start();
    touch(path.join(env.mediaDir, 'movies', 'The Matrix (1999).mkv'));
    const lib = await addLibrary(env, admin, 'movies', 'movies');
    tmdb.calls.length = 0;
    const res = await env.app.inject({ method: 'POST', url: `/api/libraries/${lib.id}/scan`, headers: { cookie: admin }, payload: { refreshMetadata: true } });
    expect(res.statusCode).toBe(200);
    await env.ctx.scans.whenIdle();
    expect(tmdb.calls.some((c) => c.startsWith('/3/movie/603'))).toBe(true);
  });

  it('works without a TMDB key using file names', async () => {
    await start(false);
    touch(path.join(env.mediaDir, 'movies', 'Interstellar.2014.mkv'));
    await addLibrary(env, admin, 'movies', 'movies');
    const [card] = (await get('/api/movies')).items;
    expect(card).toMatchObject({ title: 'Interstellar', year: 2014, posterPath: null });
    expect(tmdb.calls).toHaveLength(0);
  });

  it('validates keys when saving settings and triggers a metadata scan', async () => {
    await start(false);
    touch(path.join(env.mediaDir, 'movies', 'Interstellar (2014).mkv'));
    await addLibrary(env, admin, 'movies', 'movies');
    const bad = await env.app.inject({ method: 'PUT', url: '/api/admin/settings', headers: { cookie: admin }, payload: { tmdbApiKey: 'wrong' } });
    expect(bad.statusCode).toBe(400);
    const ok = await env.app.inject({ method: 'PUT', url: '/api/admin/settings', headers: { cookie: admin }, payload: { tmdbApiKey: 'test-key' } });
    expect(ok.json().tmdb).toMatchObject({ configured: true, source: 'settings' });
    await env.ctx.scans.whenIdle();
    const [card] = (await get('/api/movies')).items;
    expect(card.posterPath).toBe('/157336-poster.jpg');
  });

  it('never sends the TMDB key to the browser', async () => {
    await start();
    touch(path.join(env.mediaDir, 'movies', 'Interstellar (2014).mkv'));
    await addLibrary(env, admin, 'movies', 'movies');
    for (const url of ['/api/home', '/api/movies', '/api/server/info', '/api/admin/settings', '/api/admin/dashboard']) {
      const res = await env.app.inject({ url, headers: { cookie: admin } });
      expect(res.body, url).not.toContain('test-key');
    }
  });
});
