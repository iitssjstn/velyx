import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, createUser, setupAdmin, type TestEnv } from './helpers.js';
import { episodes, libraries, mediaFiles, movies, seasons, shows } from '../src/db/schema.js';
import { downloadProgress, requestState } from '../src/services/seerr.js';

// A stand-in for Seerr: its API, its key, and whether it answers at all.
const KEY = 'seerr-api-key-123456';
let reachable: boolean;
let slow: boolean;
let calls: Array<{ method: string; path: string; key: string | null; body: unknown }>;
/** Request id → [request status, media status]. */
let states: Map<number, [number, number]>;
/** Request id → what Sonarr/Radarr are fetching for its title (Seerr's `downloadStatus`). */
let queue: Map<number, Array<{ size: number; sizeLeft: number; status: string; estimatedCompletionTime?: string }>>;
/** Seerr's own record per title ("movie/603"): its id, status, requests and seasons. */
let media: Map<string, { id: number; status: number; requests: Array<{ id: number; status: number; is4k?: boolean; seasons?: Array<{ seasonNumber: number }> }>; seasons?: Array<{ seasonNumber: number; status: number }>; downloadStatus?: Array<{ size: number; sizeLeft: number; status: string; episode?: { seasonNumber: number } }> }>;
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
    if (path === '/discover/movies/genre/28') return json({ page, totalPages: 400, results: [{ id: 603, title: 'The Matrix', releaseDate: '1999-03-30', voteAverage: 8.26, posterPath: '/matrix.jpg' }] });
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
    // As Seerr does: a request waiting for approval names its seasons; the title's own seasons change
    // only once it is approved.
    m.requests.push({ id, status: 1, ...(Array.isArray(body.seasons) ? { seasons: body.seasons.map((n: number) => ({ seasonNumber: n })) } : {}) });
    media.set(key, m);
    return json({ id, status: 1, media: { status: 2 } }, 201);
  }
  const m = /^\/request\/(\d+)$/.exec(path);
  const d = /^\/request\/(\d+)\/(approve|decline)$/.exec(path);
  if (d && method === 'POST') {
    const s = states.get(Number(d[1]));
    if (!s) return json({ message: 'Not found' }, 404);
    s[0] = d[2] === 'approve' ? 2 : 3;
    return json({ id: Number(d[1]), status: s[0], media: { status: s[1] } });
  }
  if (m && method === 'DELETE') {
    if (!states.delete(Number(m[1]))) return json({ message: 'Not found' }, 404);
    for (const v of media.values()) v.requests = v.requests.filter((r) => r.id !== Number(m[1]));
    return new Response(null, { status: 204 });
  }
  if (m) {
    const s = states.get(Number(m[1]));
    return s ? json({ id: Number(m[1]), status: s[0], media: { status: s[1], downloadStatus: queue.get(Number(m[1])) ?? [] } }) : json({ message: 'Not found' }, 404);
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
  queue = new Map();
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

  it('adds up what Sonarr or Radarr fetch for a title into one progress', () => {
    expect(downloadProgress(undefined)).toBeNull();
    expect(downloadProgress([])).toBeNull();
    // A show: two episodes at once; done when the last one is.
    expect(
      downloadProgress([
        { size: 1000, sizeLeft: 500, status: 'downloading', estimatedCompletionTime: '2026-10-28T12:00:00Z' },
        { size: 3000, sizeLeft: 500, status: 'queued', estimatedCompletionTime: '2026-10-28T12:30:00Z' },
      ]),
    ).toEqual({ fraction: 0.75, size: 4000, sizeLeft: 1000, eta: Date.parse('2026-10-28T12:30:00Z'), status: 'downloading', items: 2, seasons: [] });
    expect(downloadProgress([{ size: 0, sizeLeft: 0, status: 'Queued' }])).toMatchObject({ fraction: 0, eta: null, status: 'queued' });
    expect(downloadProgress([{ size: 10, sizeLeft: 10, status: 'paused' }])?.status).toBe('paused');
    expect(downloadProgress([{ size: 10, sizeLeft: 10, status: 'paused' }, { size: 10, sizeLeft: 10, status: 'warning' }])?.status).toBe('warning');
    // Of a show: which seasons (Sonarr names the episode; a season pack its first one).
    expect(
      downloadProgress([
        { size: 10, sizeLeft: 5, status: 'downloading', episode: { seasonNumber: 3 } },
        { size: 10, sizeLeft: 5, status: 'queued', episode: { seasonNumber: 2 } },
        { size: 10, sizeLeft: 5, status: 'queued', episode: { seasonNumber: 2 } },
        { size: 10, sizeLeft: 5, status: 'queued' },
      ])?.seasons,
    ).toEqual([2, 3]);
    // Nonsense from the queue never gives more than all or less than nothing.
    expect(downloadProgress([{ size: 100, sizeLeft: 400, status: 'downloading', estimatedCompletionTime: 'soon' }])).toMatchObject({ fraction: 0, sizeLeft: 100, eta: null });
  });

  it('shows how far fetching a request is, in the lists and on its page, and follows it while it runs', async () => {
    await setUp({ url: 'http://seerr.local:5055', apiKey: KEY });
    const viewer = await createUser(env.app, admin, 'viewer');
    await env.app.inject({ method: 'POST', url: '/api/seerr/requests', headers: { cookie: viewer.cookie }, payload: { mediaType: 'movie', tmdbId: 603 } });
    const list = async (cookie: string, url = '/api/seerr/requests') => (await env.app.inject({ url, headers: { cookie } })).json();
    // Waiting for approval: nothing is fetched, and Seerr is not asked yet.
    expect((await list(viewer.cookie))[0]).toMatchObject({ state: 'requested', download: null });

    states.set(100, [2, 3]);
    queue.set(100, [{ size: 4000, sizeLeft: 3000, status: 'downloading', estimatedCompletionTime: '2026-10-28T12:30:00Z' }]);
    const realNow = Date.now;
    let at = realNow() + 10 * 60_000;
    Date.now = () => at;
    try {
      expect((await list(viewer.cookie))[0]).toMatchObject({ state: 'processing', download: { fraction: 0.25, status: 'downloading', eta: Date.parse('2026-10-28T12:30:00Z') } });
      // Administrators see it too, without Seerr being asked again so soon.
      const asked = calls.filter((c) => c.path === '/request/100').length;
      expect((await list(admin, '/api/admin/seerr/requests'))[0]).toMatchObject({ title: 'The Matrix', download: { fraction: 0.25 } });
      expect(calls.filter((c) => c.path === '/request/100').length).toBe(asked);

      // A few seconds later it is asked again, while it is being fetched.
      queue.set(100, [{ size: 4000, sizeLeft: 1000, status: 'downloading' }]);
      at += 20_000;
      expect((await list(viewer.cookie))[0].download).toMatchObject({ fraction: 0.75, eta: null });

      // Done: available, and no progress any more.
      states.set(100, [2, 5]);
      queue.delete(100);
      at += 20_000;
      expect((await list(viewer.cookie))[0]).toMatchObject({ state: 'available', download: null });
    } finally {
      Date.now = realNow;
    }

    // The title's page shows it as well.
    media.set('movie/603', { id: 900, status: 3, requests: [{ id: 100, status: 2 }], downloadStatus: [{ size: 200, sizeLeft: 50, status: 'downloading' }] });
    expect((await env.app.inject({ url: '/api/seerr/movie/603', headers: { cookie: viewer.cookie } })).json().download).toMatchObject({ fraction: 0.75, items: 1 });
    media.delete('movie/603');
    expect((await env.app.inject({ url: '/api/seerr/movie/603', headers: { cookie: viewer.cookie } })).json().download).toBeNull();
  });

  it('shows how far fetching a title in the library is on its page, asking Seerr once per title every few seconds', async () => {
    await setUp({ url: 'http://seerr.local:5055', apiKey: KEY });
    const viewer = await createUser(env.app, admin, 'viewer');
    const progress = async (url = '/api/seerr/tv/1399/download') => (await env.app.inject({ url, headers: { cookie: viewer.cookie } })).json();
    // Nothing being fetched.
    expect(await progress()).toEqual({ download: null });

    // A new season of a show that is here: which season, and how far.
    media.set('tv/1399', { id: 901, status: 4, requests: [{ id: 101, status: 2, seasons: [{ seasonNumber: 2 }] }], downloadStatus: [{ size: 400, sizeLeft: 100, status: 'downloading', episode: { seasonNumber: 2 } }] });
    const realNow = Date.now;
    let at = realNow() + 60_000;
    Date.now = () => at;
    try {
      expect(await progress()).toMatchObject({ download: { fraction: 0.75, status: 'downloading', seasons: [2] } });
      // Everyone on the page shares the answer for a few seconds: Seerr is not asked again yet.
      const asked = calls.filter((c) => c.path.startsWith('/tv/1399')).length;
      const admins = (await env.app.inject({ url: '/api/seerr/tv/1399/download', headers: { cookie: admin } })).json();
      expect(admins.download.fraction).toBe(0.75);
      expect(calls.filter((c) => c.path.startsWith('/tv/1399')).length).toBe(asked);

      // Later: asked again, and done.
      media.get('tv/1399')!.downloadStatus = [];
      at += 20_000;
      expect(await progress()).toEqual({ download: null });

      // Seerr away: nothing to show, no error on the page.
      reachable = false;
      at += 20_000;
      expect(await progress()).toEqual({ download: null });
    } finally {
      Date.now = realNow;
    }
    // Only movies and shows, with a real TMDB id.
    expect((await env.app.inject({ url: '/api/seerr/music/1/download', headers: { cookie: viewer.cookie } })).statusCode).toBe(400);
    expect((await env.app.inject({ url: '/api/seerr/movie/abc/download', headers: { cookie: viewer.cookie } })).statusCode).toBe(400);
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
    // The saved key stays with its address: another host needs the key again.
    expect((await setUp({ url: 'http://seerr.local:5055' })).statusCode).toBe(200);
    const before = calls.length;
    const elsewhere = await setUp({ url: 'http://attacker.example:5055' });
    expect(elsewhere.statusCode).toBe(400);
    expect(calls.length).toBe(before);
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

  it('hides Seerr from a user an administrator turned it off for, everywhere, and never for administrators', async () => {
    await setUp({ url: 'http://seerr.local:5055', apiKey: KEY });
    const viewer = await createUser(env.app, admin, 'reviewer');
    const status = async (cookie: string) => (await env.app.inject({ url: '/api/seerr', headers: { cookie } })).json();
    expect(await status(viewer.cookie)).toEqual({ enabled: true });

    const off = await env.app.inject({ method: 'PUT', url: `/api/users/${viewer.id}`, headers: { cookie: admin }, payload: { seerrAccess: false } });
    expect(off.json().seerrAccess).toBe(false);
    expect(await status(viewer.cookie)).toEqual({ enabled: false });
    const before = calls.length;
    for (const url of ['/api/seerr/search?q=matrix', '/api/seerr/discover?row=trending&page=1', '/api/seerr/movie/603', '/api/seerr/movie/603/trailer', '/api/seerr/movie/603/recommendations', '/api/seerr/movie/603/download', '/api/seerr/requests'])
      expect((await env.app.inject({ url, headers: { cookie: viewer.cookie } })).statusCode, url).toBe(403);
    expect((await env.app.inject({ method: 'POST', url: '/api/seerr/requests', headers: { cookie: viewer.cookie }, payload: { mediaType: 'movie', tmdbId: 603 } })).statusCode).toBe(403);
    // Nothing reached Seerr for them.
    expect(calls.length).toBe(before);

    // Administrators always see it; a user cannot turn it back on for themselves.
    expect(await status(admin)).toEqual({ enabled: true });
    expect((await env.app.inject({ method: 'PUT', url: `/api/users/${viewer.id}`, headers: { cookie: viewer.cookie }, payload: { seerrAccess: true } })).statusCode).toBe(403);

    await env.app.inject({ method: 'PUT', url: `/api/users/${viewer.id}`, headers: { cookie: admin }, payload: { seerrAccess: true } });
    expect(await status(viewer.cookie)).toEqual({ enabled: true });
    expect((await env.app.inject({ url: '/api/seerr/search?q=matrix', headers: { cookie: viewer.cookie } })).statusCode).toBe(200);
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
    expect(action.results).toMatchObject([{ mediaType: 'movie', tmdbId: 603, title: 'The Matrix', rating: 8.3, inLibrary: true }]);
    expect((await row('row=upcomingTv')).json().results).toMatchObject([{ mediaType: 'tv', tmdbId: 1400, year: 2027, inLibrary: false, local: null }]);

    // Someone who may not see the Kids library: The Matrix is not "here" for them.
    const viewer = await createUser(env.app, admin, 'viewer');
    env.ctx.access.setGrants(viewer.id, [lib.id]);
    expect((await row('row=movies&genre=28&page=2', viewer.cookie)).json().results[0]).toMatchObject({ inLibrary: false, local: null });
    // Nor is it fetched twice, but without saying it is in a library.
    const matrix = await env.app.inject({ method: 'POST', url: '/api/seerr/requests', headers: { cookie: viewer.cookie }, payload: { mediaType: 'movie', tmdbId: 603 } });
    expect(matrix.json().error).toBe('This cannot be requested.');

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

  it('lets administrators approve or decline a request waiting in Seerr', async () => {
    await setUp({ url: 'http://seerr.local:5055', apiKey: KEY });
    const viewer = await createUser(env.app, admin, 'viewer');
    const made = (await env.app.inject({ method: 'POST', url: '/api/seerr/requests', headers: { cookie: viewer.cookie }, payload: { mediaType: 'movie', tmdbId: 603 } })).json();
    const other = (await env.app.inject({ method: 'POST', url: '/api/seerr/requests', headers: { cookie: viewer.cookie }, payload: { mediaType: 'tv', tmdbId: 1399 } })).json();
    const decide = (id: number, action: string, cookie = admin) => env.app.inject({ method: 'POST', url: `/api/admin/seerr/requests/${id}/${action}`, headers: { cookie } });
    // Only administrators, and only approve or decline.
    expect((await decide(made.id, 'approve', viewer.cookie)).statusCode).toBe(403);
    expect((await decide(made.id, 'delete')).statusCode).toBe(400);
    expect((await decide(999, 'approve')).statusCode).toBe(404);
    expect(calls.some((c) => c.path.endsWith('/approve') || c.path.endsWith('/delete'))).toBe(false);

    const ok = await decide(made.id, 'approve');
    expect(ok.json()).toMatchObject({ id: made.id, state: 'approved', title: 'The Matrix' });
    expect(calls.find((c) => c.path === '/request/100/approve')?.method).toBe('POST');
    expect((await decide(other.id, 'decline')).json()).toMatchObject({ state: 'declined' });
    const all = (await env.app.inject({ url: '/api/admin/seerr/requests', headers: { cookie: admin } })).json();
    expect(all.map((r: { title: string; state: string }) => [r.title, r.state])).toEqual([['A Show', 'declined'], ['The Matrix', 'approved']]);
    const audit = JSON.stringify((await env.app.inject({ url: '/api/admin/audit?action=seerr.approved', headers: { cookie: admin } })).json());
    expect(audit).toContain('The Matrix');

    // Gone at Seerr: said so, and marked removed here.
    states.clear();
    expect((await decide(made.id, 'approve')).statusCode).toBe(404);
    expect((await env.app.inject({ url: '/api/admin/seerr/requests', headers: { cookie: admin } })).json().find((r: { id: number }) => r.id === made.id).state).toBe('removed');
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

  it('lets the other seasons of a show be requested when one season is here', async () => {
    await setUp({ url: 'http://seerr.local:5055', apiKey: KEY });
    const viewer = await createUser(env.app, admin, 'viewer');
    // Season 1 is on this server (with a file); Seerr never fetched anything of it.
    const lib = env.ctx.db.insert(libraries).values({ name: 'Series', type: 'shows', path: `${env.mediaDir}/series` }).returning().get();
    const show = env.ctx.db.insert(shows).values({ libraryId: lib.id, groupKey: 'a-show', title: 'A Show', sortTitle: 'a show', parsedTitle: 'A Show', tmdbId: 1399 }).returning().get();
    const s1 = env.ctx.db.insert(seasons).values({ showId: show.id, seasonNumber: 1 }).returning().get();
    const ep = env.ctx.db.insert(episodes).values({ showId: show.id, seasonId: s1.id, seasonNumber: 1, episodeNumber: 1 }).returning().get();
    env.ctx.db.insert(mediaFiles).values({ libraryId: lib.id, episodeId: ep.id, path: `${env.mediaDir}/series/A Show/S01E01.mkv`, size: 1, mtimeMs: 1 }).run();
    // Season 2 has an episode row but no file: it is not here.
    const s2 = env.ctx.db.insert(seasons).values({ showId: show.id, seasonNumber: 2 }).returning().get();
    env.ctx.db.insert(episodes).values({ showId: show.id, seasonId: s2.id, seasonNumber: 2, episodeNumber: 1 }).run();

    const page = (await env.app.inject({ url: '/api/seerr/tv/1399', headers: { cookie: viewer.cookie } })).json();
    expect(page.inLibrary).toBe(true);
    expect(page.seasons.map((x: { seasonNumber: number; state: string | null }) => [x.seasonNumber, x.state])).toEqual([
      [1, 'available'],
      [2, null],
    ]);
    const ask = (seasons: number[] | null) => env.app.inject({ method: 'POST', url: '/api/seerr/requests', headers: { cookie: viewer.cookie }, payload: { mediaType: 'tv', tmdbId: 1399, seasons } });
    // What is here is not asked for again.
    const here = await ask([1]);
    expect(here.statusCode).toBe(409);
    expect(here.json().error).toBe('This is already in the library.');
    // "All" means the seasons that are not here.
    expect((await ask(null)).statusCode).toBe(200);
    expect(calls.filter((c) => c.path === '/request' && c.method === 'POST').at(-1)?.body).toMatchObject({ seasons: [2] });
    const after = (await env.app.inject({ url: '/api/seerr/tv/1399', headers: { cookie: viewer.cookie } })).json();
    expect(after.seasons.map((x: { state: string | null }) => x.state)).toEqual(['available', 'requested']);
    const again = await ask([2]);
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('This has already been requested.');

    // Someone who may not see that library is not told what is in it.
    const other = await createUser(env.app, admin, 'other');
    env.ctx.access.setGrants(other.id, [lib.id + 1000]);
    const theirs = (await env.app.inject({ url: '/api/seerr/tv/1399', headers: { cookie: other.cookie } })).json();
    expect(theirs.inLibrary).toBe(false);
    expect(theirs.seasons[0].state).not.toBe('available');
    const hidden = await env.app.inject({ method: 'POST', url: '/api/seerr/requests', headers: { cookie: other.cookie }, payload: { mediaType: 'tv', tmdbId: 1399, seasons: [1] } });
    expect(hidden.statusCode).toBe(409);
    expect(hidden.json().error).toBe('This cannot be requested.');
  });

  it('tells a show\'s page whether seasons are left to request (for its button), without asking Seerr on every visit', async () => {
    await setUp({ url: 'http://seerr.local:5055', apiKey: KEY });
    const viewer = await createUser(env.app, admin, 'viewer');
    const lib = env.ctx.db.insert(libraries).values({ name: 'Series', type: 'shows', path: `${env.mediaDir}/series` }).returning().get();
    const show = env.ctx.db.insert(shows).values({ libraryId: lib.id, groupKey: 'a-show', title: 'A Show', sortTitle: 'a show', parsedTitle: 'A Show', tmdbId: 1399 }).returning().get();
    const here = (n: number) => {
      const season = env.ctx.db.insert(seasons).values({ showId: show.id, seasonNumber: n }).returning().get();
      const ep = env.ctx.db.insert(episodes).values({ showId: show.id, seasonId: season.id, seasonNumber: n, episodeNumber: 1 }).returning().get();
      env.ctx.db.insert(mediaFiles).values({ libraryId: lib.id, episodeId: ep.id, path: `${env.mediaDir}/series/A Show/S0${n}E01.mkv`, size: 1, mtimeMs: 1 }).run();
    };
    const isOpen = async (cookie = viewer.cookie) => (await env.app.inject({ url: '/api/seerr/tv/1399/open', headers: { cookie } })).json().open;
    const seerrCalls = () => calls.filter((c) => c.path.startsWith('/tv/1399')).length;
    here(1);
    // Season 1 here, season 2 not: the button stays.
    expect(await isOpen()).toBe(true);
    expect(seerrCalls()).toBe(1);
    // Season 2 arrives (a scan): looked up here at once, Seerr is not asked again.
    here(2);
    expect(await isOpen()).toBe(false);
    expect(seerrCalls()).toBe(1);
  });

  it('hides the button once every season left is requested, and keeps it when Seerr is away', async () => {
    await setUp({ url: 'http://seerr.local:5055', apiKey: KEY });
    const viewer = await createUser(env.app, admin, 'viewer');
    const isOpen = async (cookie = viewer.cookie) => (await env.app.inject({ url: '/api/seerr/tv/1399/open', headers: { cookie } })).json().open;
    expect(await isOpen()).toBe(true);
    // Requesting forgets what was kept, so the page knows straight away.
    expect((await env.app.inject({ method: 'POST', url: '/api/seerr/requests', headers: { cookie: viewer.cookie }, payload: { mediaType: 'tv', tmdbId: 1399, seasons: [1, 2] } })).statusCode).toBe(200);
    expect(await isOpen()).toBe(false);
    // Seerr away with nothing kept: the button stays, as before.
    await env.app.inject({ method: 'DELETE', url: `/api/admin/seerr/media/tv/1399`, headers: { cookie: admin } });
    reachable = false;
    expect(await isOpen()).toBe(true);
    // Only for people who may use Seerr.
    reachable = true;
    await env.app.inject({ method: 'PUT', url: `/api/users/${viewer.id}`, headers: { cookie: admin }, payload: { seerrAccess: false } });
    expect((await env.app.inject({ url: '/api/seerr/tv/1399/open', headers: { cookie: viewer.cookie } })).statusCode).toBe(403);
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
    // Every season asked for and none approved yet: nothing left to request, so the page offers no button.
    const all = (await env.app.inject({ url: '/api/seerr/tv/1399', headers: { cookie: viewer.cookie } })).json();
    expect(all.seasons.map((x: { state: string | null }) => x.state)).toEqual(['requested', 'requested']);
    // A 4K request (not Vidalune's) and a declined one leave a season open.
    media.set('tv/1399', { id: 970, status: 2, requests: [{ id: 1, status: 1, is4k: true, seasons: [{ seasonNumber: 1 }] }, { id: 2, status: 3, seasons: [{ seasonNumber: 2 }] }] });
    const other = (await env.app.inject({ url: '/api/seerr/tv/1399', headers: { cookie: viewer.cookie } })).json();
    expect(other.seasons.map((x: { state: string | null }) => x.state)).toEqual([null, 'declined']);

    const similar = (await env.app.inject({ url: '/api/seerr/movie/603/recommendations', headers: { cookie: viewer.cookie } })).json();
    expect(similar.results.map((r: { title: string; mediaType: string }) => [r.title, r.mediaType])).toEqual([
      ['The Matrix Reloaded', 'movie'],
      ['Already Here', 'movie'],
    ]);
  });
});
