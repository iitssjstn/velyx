import { afterEach, describe, expect, it } from 'vitest';
import { movies, shows } from '../src/db/schema.js';
import { pickTrailer, type TmdbVideo } from '../src/services/tmdb.js';
import { TrailerLookup } from '../src/services/trailers.js';
import { addLibrary, createTestEnv, createUser, setupAdmin, type TestEnv } from './helpers.js';

let env: TestEnv;
afterEach(async () => env?.cleanup());

const video = (v: Partial<TmdbVideo>): TmdbVideo => ({ key: 'abcdefghijk', name: 'Trailer', site: 'YouTube', type: 'Trailer', official: true, iso_639_1: 'en', size: 1080, published_at: '2020-01-01T00:00:00Z', ...v });

describe('trailers', () => {
  it('picks a YouTube trailer, in the viewer\'s language before English, official and sharpest first', () => {
    expect(pickTrailer([], 'nl')).toBeNull();
    // Only YouTube, only trailers and teasers, only well-formed video ids.
    expect(pickTrailer([video({ site: 'Vimeo' }), video({ type: 'Featurette' }), video({ key: 'bad key"><script>' })], 'en')).toBeNull();
    expect(pickTrailer([video({ key: 'teaser00001', type: 'Teaser' }), video({ key: 'trailer0001' })], 'en')?.key).toBe('trailer0001');
    expect(pickTrailer([video({ key: 'english0001' }), video({ key: 'dutch000001', iso_639_1: 'nl' })], 'nl')?.key).toBe('dutch000001');
    expect(pickTrailer([video({ key: 'fanmade0001', official: false }), video({ key: 'official001' })], 'en')?.key).toBe('official001');
    expect(pickTrailer([video({ key: 'sd000000001', size: 480 }), video({ key: 'hd000000001', size: 1080 })], 'en')?.key).toBe('hd000000001');
  });

  it('gives a movie\'s or show\'s trailer to who may see it, asking TMDB again only after an hour', async () => {
    const asked: string[] = [];
    env = await createTestEnv({
      tmdbKey: 'test-key',
      fetchImpl: async (url) => {
        const u = new URL(String(url));
        asked.push(u.pathname);
        if (u.pathname === '/3/movie/603/videos') return Response.json({ results: [video({ key: 'vKQi3bBA1y8', name: 'The Matrix trailer' })] });
        if (u.pathname === '/3/tv/1396/videos') return Response.json({ results: [] });
        return Response.json({}, { status: 404 });
      },
    });
    const admin = await setupAdmin(env.app);
    const lib = await addLibrary(env, admin, 'movies', 'films');
    const showLib = await addLibrary(env, admin, 'shows', 'series');
    const movie = env.ctx.db.insert(movies).values({ libraryId: lib.id, groupKey: 'matrix', title: 'The Matrix', sortTitle: 'matrix', parsedTitle: 'The Matrix', tmdbId: 603 }).returning().get();
    const unmatched = env.ctx.db.insert(movies).values({ libraryId: lib.id, groupKey: 'x', title: 'X', sortTitle: 'x', parsedTitle: 'X' }).returning().get();
    const show = env.ctx.db.insert(shows).values({ libraryId: showLib.id, groupKey: 'bb', title: 'Breaking Bad', sortTitle: 'breaking bad', parsedTitle: 'bb', tmdbId: 1396 }).returning().get();
    const get = (url: string, cookie = admin) => env.app.inject({ url, headers: { cookie } });

    expect((await get(`/api/movies/${movie.id}/trailer`)).json()).toEqual({ trailer: { key: 'vKQi3bBA1y8', name: 'The Matrix trailer' } });
    expect((await get(`/api/movies/${movie.id}/trailer`)).json().trailer.key).toBe('vKQi3bBA1y8');
    expect(asked.filter((p) => p === '/3/movie/603/videos')).toHaveLength(1);
    // Over an hour later: TMDB is asked whether there is a new one.
    let clock = Date.now();
    const lookup = new TrailerLookup(env.ctx.tmdb, env.ctx.seerr, () => clock);
    await lookup.get('movie', 603);
    clock += 59 * 60_000;
    await lookup.get('movie', 603);
    expect(asked.filter((p) => p === '/3/movie/603/videos')).toHaveLength(2);
    clock += 2 * 60_000;
    expect((await lookup.get('movie', 603)).trailer?.key).toBe('vKQi3bBA1y8');
    expect(asked.filter((p) => p === '/3/movie/603/videos')).toHaveLength(3);
    expect((await get(`/api/shows/${show.id}/trailer`)).json()).toEqual({ trailer: null });
    expect((await get(`/api/movies/${unmatched.id}/trailer`)).json()).toEqual({ trailer: null });

    // Signed in only, and only for titles in the user's libraries.
    expect((await env.app.inject({ url: `/api/movies/${movie.id}/trailer` })).statusCode).toBe(401);
    const user = await createUser(env.app, admin, 'kid');
    expect((await env.app.inject({ method: 'PUT', url: `/api/users/${user.id}`, headers: { cookie: admin }, payload: { libraryIds: [showLib.id] } })).statusCode).toBe(200);
    expect((await get(`/api/movies/${movie.id}/trailer`, user.cookie)).statusCode).toBe(404);
    expect((await get(`/api/movies/abc/trailer`)).statusCode).toBe(400);
  });

  it('gives the trailer of a title that is not in the library: from TMDB, or through Seerr without a TMDB key', async () => {
    const asked: string[] = [];
    const fetchImpl = async (url: string) => {
      const u = new URL(String(url));
      asked.push(`${u.host}${u.pathname}`);
      if (u.pathname === '/3/movie/604/videos') return Response.json({ results: [video({ key: 'tmdbreload1' })] });
      if (u.host === 'seerr.local:5055' && u.pathname === '/api/v1/movie/604')
        return Response.json({ id: 604, title: 'The Matrix Reloaded', relatedVideos: [{ site: 'YouTube', key: 'featurette1', type: 'Featurette', name: 'Making of' }, { site: 'YouTube', key: 'seerrtrail1', type: 'Trailer', name: 'Official trailer', size: 1080 }] });
      if (u.host === 'seerr.local:5055' && u.pathname === '/api/v1/tv/1399') return Response.json({ id: 1399, name: 'A Show', relatedVideos: [] });
      return Response.json({}, { status: 404 });
    };
    const seerr = { url: 'http://seerr.local:5055', apiKey: 'seerr-api-key-123456' };

    // With a TMDB key: TMDB, like the titles in the library.
    env = await createTestEnv({ tmdbKey: 'test-key', fetchImpl });
    let admin = await setupAdmin(env.app);
    env.ctx.settings.update({ seerr });
    expect((await env.app.inject({ url: '/api/seerr/movie/604/trailer', headers: { cookie: admin } })).json()).toEqual({ trailer: { key: 'tmdbreload1', name: 'Trailer' } });
    await env.cleanup();

    // Without one: the videos Seerr lists (a trailer, not a featurette).
    env = await createTestEnv({ tmdbKey: '', fetchImpl });
    admin = await setupAdmin(env.app);
    const get = (url: string, cookie: string | null = admin) => env.app.inject({ url, headers: cookie ? { cookie } : {} });
    expect((await get('/api/seerr/movie/604/trailer')).json()).toEqual({ trailer: null });
    env.ctx.settings.update({ seerr });
    expect((await get('/api/seerr/movie/604/trailer')).json()).toEqual({ trailer: { key: 'seerrtrail1', name: 'Official trailer' } });
    expect((await get('/api/seerr/tv/1399/trailer')).json()).toEqual({ trailer: null });
    expect(asked.filter((p) => p === 'seerr.local:5055/api/v1/movie/604')).toHaveLength(1);
    await get('/api/seerr/movie/604/trailer');
    expect(asked.filter((p) => p === 'seerr.local:5055/api/v1/movie/604')).toHaveLength(1);

    expect((await get('/api/seerr/movie/604/trailer', null)).statusCode).toBe(401);
    expect((await get('/api/seerr/person/604/trailer')).statusCode).toBe(400);
    expect((await get('/api/seerr/movie/abc/trailer')).statusCode).toBe(400);
  });
});
