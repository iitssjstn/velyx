import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildCloudApp, SESSION_COOKIE } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db/client.js';
import { subtitleFiles } from '../src/db/schema.js';
import { searchParams } from '../src/subtitles.js';
// The Vidalune server's side: it searches and downloads through vidalune.com when it has no key.
import { CloudService } from '../../backend/src/services/cloud.js';
import { OpenSubtitlesClient, OpenSubtitlesError } from '../../backend/src/services/opensubtitles.js';
import type { CloudLink, SettingsService } from '../../backend/src/services/settings.js';
import type {} from '../../backend/src/app.js';

const SRT = '1\n00:00:01,000 --> 00:00:02,000\nHallo\n';

let dir: string;
let db: DB;
let app: FastifyInstance;
let cloud: CloudService;

/** OpenSubtitles as vidalune.com sees it: what it was asked, and with which key. */
const provider = { searches: [] as string[], downloads: 0, keys: new Set<string>(), quota: false };

async function setup(env: Record<string, string>) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-cloud-'));
  const config = loadConfig({ DATA_DIR: dir, PUBLIC_URL: 'https://vidalune.example', ...env }, { webDir: null });
  db = openDatabase(config.dbPath);
  Object.assign(provider, { searches: [], downloads: 0, keys: new Set(), quota: false });
  app = await buildCloudApp(config, db, {
    fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      provider.keys.add(new Headers(init?.headers).get('Api-Key') ?? '');
      if (url.pathname.endsWith('/login')) return Response.json({ token: 'tok', base_url: 'vip-api.opensubtitles.com' });
      if (url.pathname.endsWith('/subtitles')) {
        provider.searches.push(`${url.host}${url.pathname}?${url.searchParams}`);
        return Response.json({ data: [{ attributes: { language: 'nl', release: 'Show.S01E02.NL', download_count: 7, moviehash_match: true, files: [{ file_id: 42, file_name: 'a.srt' }] } }] });
      }
      if (url.pathname.endsWith('/download')) {
        if (provider.quota) return Response.json({ message: 'quota' }, { status: 406 });
        provider.downloads++;
        return Response.json({ link: 'https://dl.opensubtitles.example/42.srt' });
      }
      if (url.host === 'dl.opensubtitles.example') return new Response(SRT);
      return new Response('not found', { status: 404 });
    }) as typeof fetch,
  });
  const stored: { cloud: CloudLink | null } = { cloud: null };
  const settings = {
    get: () => ({ ...stored }),
    update: (patch: Partial<typeof stored>) => Object.assign(stored, patch),
    serverName: () => 'Thuis',
    serverUrl: () => '',
  } as unknown as SettingsService;
  cloud = new CloudService({
    baseUrl: 'https://vidalune.example',
    settings,
    version: '0.18.0',
    localPort: 0,
    fetchImpl: async (url, init) => {
      const res = await app.inject({ method: (init?.method ?? 'GET') as 'GET', url: new URL(String(url)).pathname, headers: init?.headers as Record<string, string>, payload: init?.body as string | undefined });
      return new Response(res.body, { status: res.statusCode, headers: { 'content-type': 'application/json' } });
    },
  });
  const client = new OpenSubtitlesClient({ getCredentials: () => ({ apiKey: '', username: '', password: '' }), vidalune: cloud, userAgent: 'test' });
  return { client, stored };
}

async function link() {
  const waiting = await cloud.link();
  const signUp = await app.inject({ method: 'POST', url: '/api/account', payload: { email: 'justin@example.com', password: 'correct-horse' } });
  const cookie = `${SESSION_COOKIE}=${signUp.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
  await app.inject({ method: 'POST', url: '/api/link', headers: { cookie }, payload: { code: waiting.code!.code } });
  await cloud.check();
}

const episode = { language: 'nl' as const, hash: '0123456789abcdef', type: 'episode' as const, parentTmdbId: 157741, season: 1, episode: 2 };

afterEach(async () => {
  cloud.shutdown();
  await app.close();
  db.$client.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('subtitles through vidalune.com', () => {
  it('lets a linked server without a key search and download with the key of vidalune.com, and keeps the files', async () => {
    const { client } = await setup({ OPENSUBTITLES_API_KEY: 'vip-key', OPENSUBTITLES_USERNAME: 'owner', OPENSUBTITLES_PASSWORD: 'secret' });
    // Registered but not linked to an account: not offered.
    await cloud.ensureRegistered();
    expect(client.via).toBeNull();
    const refused = await app.inject({ method: 'POST', url: '/api/subtitles/search', headers: { authorization: `Server ${'x'.repeat(10)}:${'y'.repeat(30)}` }, payload: episode });
    expect(refused.statusCode).toBe(401);

    await link();
    expect(client.via).toBe('vidalune');
    const found = await client.search(episode);
    expect(found).toEqual([expect.objectContaining({ fileId: 42, language: 'nl', release: 'Show.S01E02.NL', hashMatch: true, downloads: 7 })]);
    // Signed in with the VIP account: searches go to its own host, with the key of vidalune.com.
    expect(provider.searches).toEqual([`vip-api.opensubtitles.com/api/v1/subtitles?${searchParams(episode)}`]);
    expect([...provider.keys]).toEqual(['vip-key']);

    // The same question again is answered from vidalune.com.
    await client.search(episode);
    expect(provider.searches).toHaveLength(1);

    const first = await client.download(42);
    expect(first.data.toString()).toBe(SRT);
    // A second time (or another server): from vidalune.com, no download counted at OpenSubtitles.
    expect((await client.download(42)).data.toString()).toBe(SRT);
    expect(provider.downloads).toBe(1);
    expect(db.select().from(subtitleFiles).all()).toEqual([expect.objectContaining({ fileId: 42, served: 2 })]);
  });

  it('says when the daily limit is reached, and when vidalune.com has no key', async () => {
    const { client } = await setup({ OPENSUBTITLES_API_KEY: 'vip-key' });
    await link();
    provider.quota = true;
    await expect(client.download(77)).rejects.toMatchObject({ kind: 'quota' });

    await app.close();
    db.$client.close();
    fs.rmSync(dir, { recursive: true, force: true });
    cloud.shutdown();
    const { client: other } = await setup({});
    await link();
    expect((await app.inject({ method: 'GET', url: '/api/subtitles/status' })).statusCode).toBe(401);
    const err = await other.search(episode).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenSubtitlesError);
    expect(err).toMatchObject({ kind: 'not-configured' });
  });

  it('only accepts questions it can pass on', async () => {
    await setup({ OPENSUBTITLES_API_KEY: 'vip-key' });
    await link();
    const { serverId, secret } = (cloud as unknown as { deps: { settings: SettingsService } }).deps.settings.get().cloud!;
    const bad = await app.inject({ method: 'POST', url: '/api/subtitles/search', headers: { authorization: `Server ${serverId}:${secret}` }, payload: { language: 'nl', type: 'movie', query: 'x', hash: 'not-a-hash' } });
    expect(bad.statusCode).toBe(400);
    expect(provider.searches).toEqual([]);
    expect(searchParams({ language: 'nl', type: 'movie' })).toBeNull();
    expect(searchParams({ language: 'en', type: 'movie', tmdbId: 603, year: 1999 })!.toString()).toBe('languages=en&tmdb_id=603&type=movie&year=1999');
  });
});
