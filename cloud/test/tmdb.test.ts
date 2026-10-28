import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildCloudApp, sessionCookieName } from '../src/app.js';

/** Over https the session cookie carries the __Host- prefix. */
const SESSION_COOKIE = sessionCookieName(true);
import { loadConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db/client.js';
import { questionKey, TMDB_TTL_MS } from '../src/tmdb.js';
import { tmdbCache } from '../src/db/schema.js';
// The Vidalune server's side: it asks vidalune.com when it has no TMDB key of its own.
import { CloudService } from '../../backend/src/services/cloud.js';
import { TmdbClient, TmdbError } from '../../backend/src/services/tmdb.js';
import type { CloudLink, SettingsService } from '../../backend/src/services/settings.js';
import type {} from '../../backend/src/app.js';

let dir: string;
let db: DB;
let app: FastifyInstance;
let cloud: CloudService;
let ceoCookie = '';

/** TMDB as vidalune.com sees it: what it was asked, and with which key. */
const tmdb = { asked: [] as string[], keys: new Set<string>() };

const matrix = { id: 603, title: 'The Matrix', original_title: 'The Matrix', release_date: '1999-03-31', overview: 'A hacker…', poster_path: '/matrix.jpg', popularity: 80 };

async function setup(ownKey = '') {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-cloud-'));
  const config = loadConfig({ DATA_DIR: dir, PUBLIC_URL: 'https://vidalune.example', CEO_EMAILS: 'ceo@example.com' }, { webDir: null });
  db = openDatabase(config.dbPath);
  Object.assign(tmdb, { asked: [], keys: new Set() });
  app = await buildCloudApp(config, db, {
    fetchImpl: (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const key = url.searchParams.get('api_key') ?? '';
      if (url.host !== 'api.themoviedb.org') return new Response('not found', { status: 404 });
      if (key === 'wrong-key') return Response.json({ status_message: 'Invalid API key' }, { status: 401 });
      tmdb.keys.add(key);
      url.searchParams.delete('api_key');
      tmdb.asked.push(`${url.pathname.replace('/3', '')}${url.search}`);
      if (url.pathname === '/3/configuration') return Response.json({ images: {} });
      if (url.pathname === '/3/search/movie') return Response.json({ results: [matrix] });
      if (url.pathname === '/3/movie/603') return Response.json({ ...matrix, runtime: 136 });
      return Response.json({ status_message: 'The resource you requested could not be found.' }, { status: 404 });
    }) as typeof fetch,
  });
  const stored: { cloud: CloudLink | null } = { cloud: null };
  const settings = { get: () => ({ ...stored }), update: (patch: Partial<typeof stored>) => Object.assign(stored, patch), serverName: () => 'Thuis', serverUrl: () => '' } as unknown as SettingsService;
  const direct: string[] = [];
  cloud = new CloudService({
    baseUrl: 'https://vidalune.example',
    settings,
    version: '0.19.59',
    localPort: 0,
    fetchImpl: async (url, init) => {
      if (String(url).startsWith('https://api.themoviedb.org')) {
        direct.push(String(url));
        return Response.json({ results: [] });
      }
      const res = await app.inject({ method: (init?.method ?? 'GET') as 'GET', url: new URL(String(url)).pathname, headers: init?.headers as Record<string, string>, payload: init?.body as string | undefined });
      return new Response(res.body, { status: res.statusCode, headers: { 'content-type': 'application/json' } });
    },
  });
  const ceo = await app.inject({ method: 'POST', url: '/api/account', payload: { email: 'ceo@example.com', password: 'correct-horse' } });
  ceoCookie = `${SESSION_COOKIE}=${ceo.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
  // Direct requests (with a key of its own) go through the same fetch as the server's other calls.
  const client = new TmdbClient({ getApiKey: () => ownKey, getLanguage: () => 'nl-NL', vidalune: cloud, minIntervalMs: 0, fetchImpl: (url, init) => (cloud as unknown as { deps: { fetchImpl: typeof fetch } }).deps.fetchImpl(url, init) });
  return { client, stored, direct };
}

async function link() {
  const waiting = await cloud.link();
  const signUp = await app.inject({ method: 'POST', url: '/api/account', payload: { email: 'justin@example.com', password: 'correct-horse' } });
  const cookie = `${SESSION_COOKIE}=${signUp.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
  await app.inject({ method: 'POST', url: '/api/link', headers: { cookie }, payload: { code: waiting.code!.code } });
  await cloud.check();
}

const setKey = (apiKey: string) => app.inject({ method: 'PUT', url: '/api/ceo/tmdb', headers: { cookie: ceoCookie }, payload: { apiKey } });

afterEach(async () => {
  cloud.shutdown();
  await app.close();
  db.$client.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('metadata through vidalune.com', () => {
  it('lets a linked server without a key get metadata with the key of vidalune.com, and reuses answers', async () => {
    const { client } = await setup();
    let available = 0;
    cloud.onTmdbAvailable = () => available++;
    // Registered but not linked: not offered.
    await cloud.ensureRegistered();
    expect(client.via).toBeNull();
    // Linked, but vidalune.com has no key yet.
    await link();
    expect(client.via).toBeNull();

    expect((await setKey('wrong-key')).statusCode).toBe(400);
    const saved = await setKey('ceo-tmdb-key');
    expect(saved.statusCode).toBe(200);
    // Never the key itself.
    expect(saved.body).not.toContain('ceo-tmdb-key');
    expect(saved.json()).toEqual({ configured: true, hint: '••••-key', kept: 0 });
    tmdb.asked.length = 0;

    // The server learns it at its next report, and then fetches what has no metadata yet.
    await cloud.check();
    expect(client.via).toBe('vidalune');
    expect(available).toBe(1);
    await cloud.check();
    expect(available).toBe(1);

    expect(await client.searchMovies('The Matrix', 1999)).toEqual([expect.objectContaining({ id: 603, title: 'The Matrix', year: 1999, posterPath: '/matrix.jpg' })]);
    expect((await client.movie(603)).runtime).toBe(136);
    expect(tmdb.asked).toEqual(['/search/movie?include_adult=false&language=nl-NL&query=The+Matrix&year=1999', '/movie/603?append_to_response=credits%2Cexternal_ids%2Ctranslations&language=nl-NL']);
    expect([...tmdb.keys]).toEqual(['ceo-tmdb-key']);

    // The same questions again (this server or another one): answered by vidalune.com.
    await client.searchMovies('The Matrix', 1999);
    await client.movie(603);
    expect(tmdb.asked).toHaveLength(2);

    // Ten minutes later TMDB is asked again (what was added there, such as new stills, comes through).
    expect(TMDB_TTL_MS).toBe(10 * 60 * 1000);
    db.update(tmdbCache).set({ fetchedAt: Date.now() - TMDB_TTL_MS - 1000 }).run();
    await client.movie(603);
    expect(tmdb.asked).toHaveLength(3);
    tmdb.asked.length = 2;

    // Something TMDB does not have stays TMDB's answer: a 404, as from TMDB itself.
    await expect(client.movie(999999)).rejects.toMatchObject({ status: 404 });
    await expect(client.movie(999999)).rejects.toBeInstanceOf(TmdbError);
    expect(tmdb.asked).toHaveLength(3);
  });

  it('passes on only the questions Vidalune asks', async () => {
    await setup();
    await link();
    await setKey('ceo-tmdb-key');
    const link0 = cloud as unknown as { deps: { settings: SettingsService } };
    const { serverId, secret } = link0.deps.settings.get().cloud!;
    const ask = (payload: unknown) => app.inject({ method: 'POST', url: '/api/tmdb', headers: { authorization: `Server ${serverId}:${secret}` }, payload: payload as object });
    tmdb.asked.length = 0;
    for (const bad of [
      { path: '/account', params: {} },
      { path: '/movie/603/account_states', params: {} },
      { path: '/movie/603', params: { api_key: 'mine' } },
      { path: '/movie/603', params: { append_to_response: 'images' } },
      { path: '/search/movie', params: {} },
      { path: '/movie/0603', params: {} },
      { path: '/../movie/603', params: {} },
    ]) expect((await ask(bad)).statusCode, JSON.stringify(bad)).toBe(400);
    expect(tmdb.asked).toEqual([]);
    const ok = await ask({ path: '/search/movie', params: { query: 'The Matrix', year: 1999, language: 'nl-NL' } });
    expect(ok.json()).toEqual({ status: 200, data: { results: [matrix] } });
  });

  it('keeps the same cache key for the same question, whatever order its parameters come in', () => {
    expect(questionKey({ path: '/search/tv', params: { query: 'Severance', language: 'en-US', first_air_date_year: 2022 } })).toBe(questionKey({ path: '/search/tv', params: { first_air_date_year: '2022', language: 'en-US', query: 'Severance' } }));
  });

  it('refuses a server that is not linked, and leaves the Control Center to the CEO', async () => {
    const { client } = await setup();
    await cloud.ensureRegistered();
    await setKey('ceo-tmdb-key');
    const { serverId, secret } = (cloud as unknown as { deps: { settings: SettingsService } }).deps.settings.get().cloud!;
    const refused = await app.inject({ method: 'POST', url: '/api/tmdb', headers: { authorization: `Server ${serverId}:${secret}` }, payload: { path: '/movie/603', params: {} } });
    expect(refused.statusCode).toBe(403);
    expect(client.via).toBeNull();
    await expect(client.movie(603)).rejects.toThrow('not configured');

    const signUp = await app.inject({ method: 'POST', url: '/api/account', payload: { email: 'someone@example.com', password: 'correct-horse' } });
    const cookie = `${SESSION_COOKIE}=${signUp.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
    expect((await app.inject({ method: 'GET', url: '/api/ceo/tmdb', headers: { cookie } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/ceo/tmdb', headers: { cookie }, payload: { apiKey: 'x' } })).statusCode).toBe(403);
  });

  it('uses a key of its own first, without asking vidalune.com', async () => {
    const { client, direct } = await setup('own-key');
    await link();
    await setKey('ceo-tmdb-key');
    await cloud.check();
    tmdb.asked.length = 0;
    expect(client.via).toBe('own');
    await client.searchMovies('The Matrix');
    expect(direct).toHaveLength(1);
    expect(direct[0]).toContain('api_key=own-key');
    expect(tmdb.asked).toEqual([]);
  });

  it('learns at once when asked (an admin page opening), not only at the next report, and not more than every 30 seconds', async () => {
    const { client } = await setup();
    let available = 0;
    cloud.onTmdbAvailable = () => available++;
    await link();
    expect(client.via).toBeNull();
    // Asked while vidalune.com has no key yet: still nothing, and the next 30 seconds it does not ask again.
    await cloud.refreshTmdb();
    await setKey('ceo-tmdb-key');
    await cloud.refreshTmdb();
    expect(client.via).toBeNull();
    (cloud as unknown as { tmdbAskedAt: number }).tmdbAskedAt -= 30_000;
    await cloud.refreshTmdb();
    expect(client.via).toBe('vidalune');
    expect(available).toBe(1);
  });

  it('stops offering it when the CEO turns it off', async () => {
    const { client } = await setup();
    await link();
    await setKey('ceo-tmdb-key');
    await cloud.check();
    expect(client.via).toBe('vidalune');
    expect((await app.inject({ method: 'DELETE', url: '/api/ceo/tmdb', headers: { cookie: ceoCookie } })).json()).toMatchObject({ configured: false, hint: null });
    await cloud.check();
    expect(client.via).toBeNull();
  });
});
