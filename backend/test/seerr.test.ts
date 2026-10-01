import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, createUser, setupAdmin, type TestEnv } from './helpers.js';
import { libraries, movies, shows } from '../src/db/schema.js';
import { requestState } from '../src/services/seerr.js';

// A stand-in for Seerr: its API, its key, and whether it answers at all.
const KEY = 'seerr-api-key-123456';
let reachable: boolean;
let slow: boolean;
let calls: Array<{ method: string; path: string; key: string | null; body: unknown }>;
/** Request id → [request status, media status]. */
let states: Map<number, [number, number]>;
/** Seerr's own record per title ("movie/603"): its id, status, requests and seasons. */
let media: Map<string, { id: number; status: number; requests: Array<{ id: number; status: number }>; seasons?: Array<{ seasonNumber: number; status: number }> }>;
const fakeSeerr = async (url: string, init?: RequestInit) => {
  const u = new URL(url);
  if (u.host !== 'seerr.local:5055') throw new Error('network disabled in tests');
  if (!reachable) throw new Error('connect ECONNREFUSED');
  if (slow) {
    const e = new Error('The operation was aborted due to timeout');
    e.name = 'TimeoutError';
    throw e;
  }
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  const path = u.pathname.replace('/api/v1', '');
  calls.push({ method, path: `${path}${u.search}`, key: headers['X-Api-Key'] ?? null, body });
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
  if (path === '/status') return json({ version: '3.0.0' });
  if (headers['X-Api-Key'] !== KEY) return json({ message: 'Unauthorized' }, 403);
  if (path === '/request' && method === 'GET') return json({ results: [] });
  if (path === '/search') {
    return json({
      page: 1,
      totalPages: 1,
      results: [
        { id: 603, mediaType: 'movie', title: 'The Matrix', releaseDate: '1999-03-30', overview: 'A hacker learns…', posterPath: '/matrix.jpg' },
        { id: 1399, mediaType: 'tv', name: 'A Show', firstAirDate: '2011-04-17', overview: 'Families fight…', posterPath: '/show.jpg', mediaInfo: { status: 3, requests: [{ status: 2 }] } },
        { id: 17419, mediaType: 'person', name: 'Somebody' },
      ],
    });
  }
  if (path.startsWith('/discover/')) {
    // Discover rows leave out mediaType for movie and tv lists (as Seerr does for some of them).
    const page = Number(u.searchParams.get('page'));
    if (path === '/discover/trending') return json({ page, totalPages: 3, results: [{ id: 550, mediaType: 'movie', title: 'Already Here', releaseDate: '1999-10-15', posterPath: null }, { id: 1399, mediaType: 'tv', name: 'A Show', firstAirDate: '2011-04-17', posterPath: '/show.jpg' }, { id: 1, mediaType: 'person', name: 'Somebody' }] });
    if (path === '/discover/movies/genre/28') return json({ page, totalPages: 400, results: [{ id: 603, title: 'The Matrix', releaseDate: '1999-03-30', posterPath: '/matrix.jpg' }] });
    if (path === '/discover/tv/upcoming') return json({ page, totalPages: 1, results: [{ id: 1400, name: 'Coming Soon', firstAirDate: '2027-01-01', posterPath: null }] });
  }
  const info = (key: string) => (media.has(key) ? { mediaInfo: media.get(key) } : {});
  if (path === '/movie/603/recommendations') return json({ page: 1, totalPages: 1, results: [{ id: 604, title: 'The Matrix Reloaded', releaseDate: '2003-05-15', posterPath: '/r.jpg' }, { id: 550, title: 'Already Here', releaseDate: '1999-10-15', posterPath: null }] });
  const mm = /^\/media\/(\d+)$/.exec(path);
  if (mm && method === 'DELETE') {
    for (const [k, v] of media) if (v.id === Number(mm[1])) media.delete(k);
    return new Response(null, { status: 204 });
  }
  if (path === '/movie/603') return json({ ...info('movie/603'), id: 603, title: 'The Matrix', releaseDate: '1999-03-30', overview: 'A hacker learns…', posterPath: '/matrix.jpg', runtime: 136, genres: [{ name: 'Action' }, { name: 'Science Fiction' }] });
  if (path === '/movie/550') return json({ id: 550, title: 'Already Here', releaseDate: '1999-10-15', overview: '', posterPath: null, genres: [] });
  if (path === '/tv/1399') return json({ ...info('tv/1399'), id: 1399, name: 'A Show', firstAirDate: '2011-04-17', overview: 'Families fight…', posterPath: '/show.jpg', genres: [{ name: 'Drama' }], seasons: [{ seasonNumber: 0, episodeCount: 5 }, { seasonNumber: 1, episodeCount: 10 }, { seasonNumber: 2, episodeCount: 10 }] });
  if (path === '/request' && method === 'POST') {
    const id = states.size + 100;
    states.set(id, [1, 2]);
    const key = `${body.mediaType}/${body.mediaId}`;
    const m = media.get(key) ?? { id: 900 + media.size, status: 2, requests: [] };
    m.requests.push({ id, status: 1 });
    if (Array.isArray(body.seasons)) m.seasons = [...(m.seasons ?? []), ...body.seasons.map((n: number) => ({ seasonNumber: n, status: 2 }))];
    media.set(key, m);
    return json({ id, status: 1, media: { status: 2 } }, 201);
  }
  const m = /^\/request\/(\d+)$/.exec(path);
  if (m && method === 'DELETE') {
    if (!states.delete(Number(m[1]))) return json({ message: 'Not found' }, 404);
    for (const v of media.values()) v.requests = v.requests.filter((r) => r.id !== Number(m[1]));
    return new Response(null, { status: 204 });
  }
  if (m) {
    const s = states.get(Number(m[1]));
    return s ? json({ id: Number(m[1]), status: s[0], media: { status: s[1] } }) : json({ message: 'Not found' }, 404);
  }
  return json({ message: 'Not found' }, 404);
};

let env: TestEnv;
let admin: string;
beforeEach(async () => {
  reachable = true;
  slow = false;
  calls = [];
  states = new Map();
  media = new Map();
  env = await createTestEnv({ fetchImpl: fakeSeerr });
  admin = await setupAdmin(env.app, 'justin');
});
afterEach(async () => env.cleanup());

const setUp = (payload: Record<string, unknown>, cookie = admin) => env.app.inject({ method: 'PUT', url: '/api/admin/seerr', headers: { cookie }, payload });

describe('Seerr', () => {
  it('turns Seerr states into what Vidalune shows', () => {
    expect(requestState(1, 2)).toBe('requested');
    expect(requestState(2, 3)).toBe('processing');
    expect(requestState(2, 2)).toBe('approved');
    expect(requestState(3, 2)).toBe('declined');
    expect(requestState(4, 2)).toBe('failed');
    expect(requestState(2, 4)).toBe('partiallyAvailable');
    expect(requestState(5, 5)).toBe('available');
    expect(requestState(undefined, undefined)).toBeNull();
  });

  it('is off until an administrator sets it up, and contacts nothing before', async () => {
    const viewer = await createUser(env.app, admin, 'viewer');
    expect((await env.app.inject({ url: '/api/seerr', headers: { cookie: viewer.cookie } })).json()).toEqual({ enabled: false });
    const search = await env.app.inject({ url: '/api/seerr/search?q=matrix', headers: { cookie: viewer.cookie } });
    expect(search.statusCode).toBe(409);
    expect(calls).toEqual([]);
    // Administrators only.
    expect((await setUp({ url: 'http://seerr.local:5055', apiKey: KEY }, viewer.cookie)).statusCode).toBe(403);
    expect((await env.app.inject({ url: '/api/admin/seerr', headers: { cookie: viewer.cookie } })).statusCode).toBe(403);
  });

  it('checks the address and key before saving them, and never gives the key back', async () => {
    expect((await setUp({ url: 'seerr.local', apiKey: KEY })).statusCode).toBe(400);
    const wrong = await setUp({ url: 'http://seerr.local:5055', apiKey: 'wrong-key-wrong-key' });
    expect(wrong.statusCode).toBe(502);
    expect(wrong.json().error).toMatch(/refused the API key/);
    reachable = false;
    expect((await setUp({ url: 'http://seerr.local:5055', apiKey: KEY })).json().error).toMatch(/Could not reach Seerr/);
    reachable = true;
    const ok = await setUp({ url: 'http://seerr.local:5055/', apiKey: KEY });
    expect(ok.json()).toEqual({ url: 'http://seerr.local:5055', hasKey: true, version: '3.0.0' });
    const shown = await env.app.inject({ url: '/api/admin/seerr', headers: { cookie: admin } });
    expect(shown.json()).toEqual({ url: 'http://seerr.local:5055', hasKey: true });
    expect(shown.body).not.toContain(KEY);
    // Off again.
    expect((await setUp({ url: '' })).json()).toMatchObject({ hasKey: false });
  });

  it('searches, shows details, requests and follows the request', async () => {
    await setUp({ url: 'http://seerr.local:5055', apiKey: KEY });
    const viewer = await createUser(env.app, admin, 'viewer');
    const lib = env.ctx.db.insert(libraries).values({ name: 'Films', type: 'movies', path: env.mediaDir }).returning().get();
    env.ctx.db.insert(movies).values({ libraryId: lib.id, groupKey: 'already-here', title: 'Already Here', sortTitle: 'already here', parsedTitle: 'Already Here', tmdbId: 550 }).run();

    const found = await env.app.inject({ url: '/api/seerr/search?q=matrix', headers: { cookie: viewer.cookie } });
    expect(found.json().results).toEqual([
      { mediaType: 'movie', tmdbId: 603, title: 'The Matrix', year: 1999, overview: 'A hacker learns…', posterPath: '/matrix.jpg', state: null, inLibrary: false, local: null },
      { mediaType: 'tv', tmdbId: 1399, title: 'A Show', year: 2011, overview: 'Families fight…', posterPath: '/show.jpg', state: 'processing', inLibrary: false, local: null },
    ]);
    expect(calls.at(-1)).toMatchObject({ key: KEY, path: '/search?query=matrix&page=1&language=en' });
    const show = await env.app.inject({ url: '/api/seerr/tv/1399', headers: { cookie: viewer.cookie } });
    expect(show.json()).toMatchObject({ title: 'A Show', genres: ['Drama'], seasons: [{ seasonNumber: 1, episodeCount: 10 }, { seasonNumber: 2, episodeCount: 10 }] });

    const made = await env.app.inject({ method: 'POST', url: '/api/seerr/requests', headers: { cookie: viewer.cookie }, payload: { mediaType: 'tv', tmdbId: 1399, seasons: [1] } });
    expect(made.json()).toMatchObject({ title: 'A Show', state: 'requested', mediaType: 'tv' });
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ mediaType: 'tv', mediaId: 1399, seasons: [1] });
    await env.app.inject({ method: 'POST', url: '/api/seerr/requests', headers: { cookie: viewer.cookie }, payload: { mediaType: 'movie', tmdbId: 603 } });
    // Already in the library: not requested.
    const have = await env.app.inject({ method: 'POST', url: '/api/seerr/requests', headers: { cookie: viewer.cookie }, payload: { mediaType: 'movie', tmdbId: 550 } });
    expect(have.statusCode).toBe(409);
    expect((await env.app.inject({ method: 'POST', url: '/api/seerr/requests', headers: { cookie: viewer.cookie }, payload: { mediaType: 'music', tmdbId: 1 } })).statusCode).toBe(400);

    // Everyone sees their own requests; the state follows Seerr (asked again after a few minutes).
    const list = async (cookie: string) => (await env.app.inject({ url: '/api/seerr/requests', headers: { cookie } })).json();
    expect((await list(viewer.cookie)).map((r: { title: string }) => r.title)).toEqual(['The Matrix', 'A Show']);
    expect(await list(admin)).toEqual([]);
    states.set(100, [2, 5]);
    const realNow = Date.now;
    Date.now = () => realNow() + 10 * 60_000;
    try {
      expect((await list(viewer.cookie)).find((r: { tmdbId: number }) => r.tmdbId === 1399).state).toBe('available');
    } finally {
      Date.now = realNow;
    }
  });

  it('says clearly when Seerr is slow or away, without breaking Vidalune', async () => {
    await setUp({ url: 'http://seerr.local:5055', apiKey: KEY });
    slow = true;
    const late = await env.app.inject({ url: '/api/seerr/search?q=matrix', headers: { cookie: admin } });
    expect(late.statusCode).toBe(502);
    expect(late.json().error).toMatch(/did not answer in time/);
    slow = false;
    reachable = false;
    expect((await env.app.inject({ url: '/api/seerr/search?q=matrix', headers: { cookie: admin } })).statusCode).toBe(502);
    // The requests list shows what was known.
    expect((await env.app.inject({ url: '/api/seerr/requests', headers: { cookie: admin } })).statusCode).toBe(200);
    expect((await env.app.inject({ url: '/api/home', headers: { cookie: admin } })).statusCode).toBe(200);
  });

  it('shows the catalog in rows, with what is already here opening the player', async () => {
    await setUp({ url: 'http://seerr.local:5055', apiKey: KEY });
    const lib = env.ctx.db.insert(libraries).values({ name: 'Films', type: 'movies', path: env.mediaDir }).returning().get();
    const hidden = env.ctx.db.insert(libraries).values({ name: 'Kids', type: 'movies', path: `${env.mediaDir}/kids` }).returning().get();
    const movie = env.ctx.db.insert(movies).values({ libraryId: lib.id, groupKey: 'already-here', title: 'Already Here', sortTitle: 'already here', parsedTitle: 'Already Here', tmdbId: 550 }).returning().get();
    env.ctx.db.insert(movies).values({ libraryId: hidden.id, groupKey: 'matrix', title: 'The Matrix', sortTitle: 'matrix', parsedTitle: 'The Matrix', tmdbId: 603 }).run();
    const show = env.ctx.db.insert(shows).values({ libraryId: lib.id, groupKey: 'a-show', title: 'A Show', sortTitle: 'a show', parsedTitle: 'A Show', tmdbId: 1399 }).returning().get();

    const row = async (query: string, cookie = admin) => env.app.inject({ url: `/api/seerr/discover?${query}`, headers: { cookie } });
    const trending = (await row('row=trending')).json();
    expect(trending.totalPages).toBe(3);
    expect(trending.results).toMatchObject([
      { mediaType: 'movie', tmdbId: 550, inLibrary: true, local: { type: 'movie', id: movie.id } },
      { mediaType: 'tv', tmdbId: 1399, inLibrary: true, local: { type: 'show', id: show.id } },
    ]);
    // Rows are kept for a while: the same row again does not ask Seerr.
    const asked = calls.length;
    await row('row=trending');
    expect(calls.length).toBe(asked);
    // A genre (the type comes from the row), in the interface language.
    const action = (await row('row=movies&genre=28&page=2')).json();
    expect(calls.at(-1)?.path).toBe('/discover/movies/genre/28?page=2&language=en');
    expect(action.totalPages).toBe(20);
    expect(action.results).toMatchObject([{ mediaType: 'movie', tmdbId: 603, title: 'The Matrix', inLibrary: true }]);
    expect((await row('row=upcomingTv')).json().results).toMatchObject([{ mediaType: 'tv', tmdbId: 1400, year: 2027, inLibrary: false, local: null }]);

    // Someone who may not see the Kids library: The Matrix is not "here" for them.
    const viewer = await createUser(env.app, admin, 'viewer');
    env.ctx.access.setGrants(viewer.id, [lib.id]);
    expect((await row('row=movies&genre=28&page=2', viewer.cookie)).json().results[0]).toMatchObject({ inLibrary: false, local: null });

    expect((await row('row=everything')).statusCode).toBe(400);
    expect((await row('row=trending&genre=28')).statusCode).toBe(400);
    expect((await row('row=trending&page=99')).statusCode).toBe(400);
    expect((await env.app.inject({ url: '/api/seerr/discover?row=trending' })).statusCode).toBe(401);
  });

  it('shows no catalog without Seerr', async () => {
    expect((await env.app.inject({ url: '/api/seerr/discover?row=trending', headers: { cookie: admin } })).statusCode).toBe(409);
    expect(calls).toEqual([]);
  });

  it('lets administrators see and cancel everyone’s requests (in Seerr and here)', async () => {
    await setUp({ url: 'http://seerr.local:5055', apiKey: KEY });
    const viewer = await createUser(env.app, admin, 'viewer');
    const made = await env.app.inject({ method: 'POST', url: '/api/seerr/requests', headers: { cookie: viewer.cookie }, payload: { mediaType: 'movie', tmdbId: 603 } });
    const other = await env.app.inject({ method: 'POST', url: '/api/seerr/requests', headers: { cookie: viewer.cookie }, payload: { mediaType: 'tv', tmdbId: 1399 } });
    // Only administrators.
    expect((await env.app.inject({ url: '/api/admin/seerr/requests', headers: { cookie: viewer.cookie } })).statusCode).toBe(403);
    expect((await env.app.inject({ method: 'DELETE', url: `/api/admin/seerr/requests/${made.json().id}`, headers: { cookie: viewer.cookie } })).statusCode).toBe(403);

    const all = (await env.app.inject({ url: '/api/admin/seerr/requests', headers: { cookie: admin } })).json();
    expect(all.map((r: { title: string; user: string }) => [r.title, r.user])).toEqual([['A Show', 'viewer'], ['The Matrix', 'viewer']]);

    const res = await env.app.inject({ method: 'DELETE', url: `/api/admin/seerr/requests/${made.json().id}`, headers: { cookie: admin } });
    expect(res.json()).toEqual({ ok: true, inSeerr: true });
    expect(calls.find((c) => c.method === 'DELETE')?.path).toBe('/request/100');
    expect(states.has(100)).toBe(false);
    expect((await env.app.inject({ url: '/api/seerr/requests', headers: { cookie: viewer.cookie } })).json().map((r: { title: string }) => r.title)).toEqual(['A Show']);
    expect((await env.app.inject({ method: 'DELETE', url: `/api/admin/seerr/requests/${made.json().id}`, headers: { cookie: admin } })).statusCode).toBe(404);

    // Already gone at Seerr: removed here all the same.
    states.clear();
    expect((await env.app.inject({ method: 'DELETE', url: `/api/admin/seerr/requests/${other.json().id}`, headers: { cookie: admin } })).json()).toEqual({ ok: true, inSeerr: false });
    expect((await env.app.inject({ url: '/api/admin/seerr/requests', headers: { cookie: admin } })).json()).toEqual([]);
    const audit = (await env.app.inject({ url: '/api/admin/audit?action=seerr.cancelled', headers: { cookie: admin } })).json();
    expect(JSON.stringify(audit)).toContain('The Matrix');
  });

  it('makes a cancelled title requestable again (not while someone else still wants it, never what is here)', async () => {
    await setUp({ url: 'http://seerr.local:5055', apiKey: KEY });
    const viewer = await createUser(env.app, admin, 'viewer');
    const other = await createUser(env.app, admin, 'other');
    const ask = (cookie: string) => env.app.inject({ method: 'POST', url: '/api/seerr/requests', headers: { cookie }, payload: { mediaType: 'movie', tmdbId: 603 } });
    const mine = (await ask(viewer.cookie)).json();
    const theirs = (await ask(other.cookie)).json();
    const state = async () => (await env.app.inject({ url: '/api/seerr/movie/603', headers: { cookie: viewer.cookie } })).json().state;
    expect(await state()).toBe('requested');
    // One of two requests cancelled: the title stays requested (the other one still counts).
    await env.app.inject({ method: 'DELETE', url: `/api/admin/seerr/requests/${mine.id}`, headers: { cookie: admin } });
    expect(media.has('movie/603')).toBe(true);
    // The last one cancelled: Seerr forgets it, and it can be requested again.
    await env.app.inject({ method: 'DELETE', url: `/api/admin/seerr/requests/${theirs.id}`, headers: { cookie: admin } });
    expect(media.has('movie/603')).toBe(false);
    expect(await state()).toBeNull();
    expect(calls.some((c) => c.method === 'DELETE' && /^\/media\/\d+$/.test(c.path))).toBe(true);
  });

  it('lets administrators reset a title stuck as requested, whoever asked for it', async () => {
    await setUp({ url: 'http://seerr.local:5055', apiKey: KEY });
    const viewer = await createUser(env.app, admin, 'viewer');
    await env.app.inject({ method: 'POST', url: '/api/seerr/requests', headers: { cookie: viewer.cookie }, payload: { mediaType: 'movie', tmdbId: 603 } });
    // Requested outside Vidalune too.
    media.get('movie/603')!.requests.push({ id: 555, status: 2 });
    states.set(555, [2, 3]);
    media.get('movie/603')!.status = 3;
    expect((await env.app.inject({ method: 'DELETE', url: '/api/admin/seerr/media/movie/603', headers: { cookie: viewer.cookie } })).statusCode).toBe(403);
    const res = await env.app.inject({ method: 'DELETE', url: '/api/admin/seerr/media/movie/603', headers: { cookie: admin } });
    expect(res.json()).toEqual({ ok: true, requests: 2 });
    expect(media.has('movie/603')).toBe(false);
    expect((await env.app.inject({ url: '/api/seerr/requests', headers: { cookie: viewer.cookie } })).json()).toEqual([]);
    expect(JSON.stringify((await env.app.inject({ url: '/api/admin/audit?action=seerr.reset', headers: { cookie: admin } })).json())).toContain('The Matrix');
    // What is available already stays.
    media.set('movie/603', { id: 950, status: 5, requests: [] });
    expect((await env.app.inject({ method: 'DELETE', url: '/api/admin/seerr/media/movie/603', headers: { cookie: admin } })).statusCode).toBe(409);
    expect(media.has('movie/603')).toBe(true);
  });

  it('shows a title removed from the library as not here (not "available" as Seerr still says), and lets it be requested again', async () => {
    await setUp({ url: 'http://seerr.local:5055', apiKey: KEY });
    const viewer = await createUser(env.app, admin, 'viewer');
    // Seerr still has the show as available; this server no longer has it (removed from disk).
    media.set('tv/1399', { id: 960, status: 5, requests: [], seasons: [{ seasonNumber: 1, status: 5 }, { seasonNumber: 2, status: 5 }] });
    const page = (await env.app.inject({ url: '/api/seerr/tv/1399', headers: { cookie: viewer.cookie } })).json();
    expect(page).toMatchObject({ inLibrary: false, state: null });
    expect(page.seasons.filter((x: { seasonNumber: number }) => x.seasonNumber > 0).map((x: { state: unknown }) => x.state)).toEqual([null, null]);
    // Requesting it makes Seerr forget its old record first.
    const r = await env.app.inject({ method: 'POST', url: '/api/seerr/requests', headers: { cookie: viewer.cookie }, payload: { mediaType: 'tv', tmdbId: 1399 } });
    expect(r.statusCode).toBe(200);
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/media/960')).toBe(true);

    // Back in a library: Seerr's answer stands again.
    const lib = env.ctx.db.insert(libraries).values({ name: 'Series', type: 'shows', path: `${env.mediaDir}/series` }).returning().get();
    env.ctx.db.insert(shows).values({ libraryId: lib.id, groupKey: 'a-show', title: 'A Show', sortTitle: 'a show', parsedTitle: 'A Show', tmdbId: 1399 }).run();
    media.set('tv/1399', { id: 961, status: 5, requests: [] });
    expect((await env.app.inject({ url: '/api/seerr/tv/1399', headers: { cookie: viewer.cookie } })).json()).toMatchObject({ inLibrary: true, state: 'available' });
  });

  it('requests only the seasons of a show that are still open, and shows similar titles', async () => {
    await setUp({ url: 'http://seerr.local:5055', apiKey: KEY });
    const viewer = await createUser(env.app, admin, 'viewer');
    const ask = (seasons: number[] | null) => env.app.inject({ method: 'POST', url: '/api/seerr/requests', headers: { cookie: viewer.cookie }, payload: { mediaType: 'tv', tmdbId: 1399, seasons } });
    expect((await ask([1])).statusCode).toBe(200);
    const d = (await env.app.inject({ url: '/api/seerr/tv/1399', headers: { cookie: viewer.cookie } })).json();
    expect(d.seasons.map((x: { seasonNumber: number; state: string | null }) => [x.seasonNumber, x.state])).toEqual([
      [1, 'requested'],
      [2, null],
    ]);
    // "All" now means the ones left.
    expect((await ask(null)).statusCode).toBe(200);
    expect(calls.filter((c) => c.path === '/request' && c.method === 'POST').at(-1)?.body).toMatchObject({ seasons: [2] });
    expect((await ask([1, 2])).statusCode).toBe(409);

    const similar = (await env.app.inject({ url: '/api/seerr/movie/603/recommendations', headers: { cookie: viewer.cookie } })).json();
    expect(similar.results.map((r: { title: string; mediaType: string }) => [r.title, r.mediaType])).toEqual([
      ['The Matrix Reloaded', 'movie'],
      ['Already Here', 'movie'],
    ]);
  });
});
