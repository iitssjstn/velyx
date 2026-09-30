import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, createUser, setupAdmin, type TestEnv } from './helpers.js';
import { libraries, movies } from '../src/db/schema.js';
import { requestState } from '../src/services/seerr.js';

// A stand-in for Seerr: its API, its key, and whether it answers at all.
const KEY = 'seerr-api-key-123456';
let reachable: boolean;
let slow: boolean;
let calls: Array<{ method: string; path: string; key: string | null; body: unknown }>;
/** Request id → [request status, media status]. */
let states: Map<number, [number, number]>;
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
  if (path === '/movie/603') return json({ id: 603, title: 'The Matrix', releaseDate: '1999-03-30', overview: 'A hacker learns…', posterPath: '/matrix.jpg', runtime: 136, genres: [{ name: 'Action' }, { name: 'Science Fiction' }] });
  if (path === '/movie/550') return json({ id: 550, title: 'Already Here', releaseDate: '1999-10-15', overview: '', posterPath: null, genres: [] });
  if (path === '/tv/1399') return json({ id: 1399, name: 'A Show', firstAirDate: '2011-04-17', overview: 'Families fight…', posterPath: '/show.jpg', genres: [{ name: 'Drama' }], seasons: [{ seasonNumber: 0, episodeCount: 5 }, { seasonNumber: 1, episodeCount: 10 }, { seasonNumber: 2, episodeCount: 10 }] });
  if (path === '/request' && method === 'POST') {
    const id = states.size + 100;
    states.set(id, [1, 2]);
    return json({ id, status: 1, media: { status: 2 } }, 201);
  }
  const m = /^\/request\/(\d+)$/.exec(path);
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
      { mediaType: 'movie', tmdbId: 603, title: 'The Matrix', year: 1999, overview: 'A hacker learns…', posterPath: '/matrix.jpg', state: null, inLibrary: false },
      { mediaType: 'tv', tmdbId: 1399, title: 'A Show', year: 2011, overview: 'Families fight…', posterPath: '/show.jpg', state: 'processing', inLibrary: false },
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
});
