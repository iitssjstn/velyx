import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrationsFolder, openDatabase } from '../src/db/client.js';
import { movieHash, rankSubtitles, type OnlineSubtitle } from '../src/services/opensubtitles.js';
import { addLibrary, createTestEnv, createUser, setupAdmin, touch, type TestEnv } from './helpers.js';

const SRT = '1\n00:00:01,000 --> 00:00:03,500\nHallo daar\n\n2\n00:00:05,000 --> 00:00:06,000\nTot ziens\n';

interface Call {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A stand-in for api.opensubtitles.com. */
function fakeOpenSubtitles() {
  const calls: Call[] = [];
  const state = { validKey: 'good-key', quota: false, downloadBody: SRT, results: [] as unknown[] };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const headers = Object.fromEntries(Object.entries((init.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ url, method: init.method ?? 'GET', headers, body: init.body ? JSON.parse(String(init.body)) : null });
    if (url.hostname === 'dl.opensubtitles.test') return new Response(state.downloadBody, { status: 200 });
    if (url.hostname !== 'api.opensubtitles.com') throw new Error('network disabled in tests');
    if (headers['api-key'] !== state.validKey) return json(401, { message: 'Invalid API key' });
    const p = url.pathname.replace('/api/v1', '');
    if (p === '/infos/formats') return json(200, { data: { output_formats: ['srt'] } });
    if (p === '/login') {
      const b = calls.at(-1)!.body as { username: string; password: string };
      return b.username === 'anna' && b.password === 'secret' ? json(200, { token: 'tok', base_url: 'api.opensubtitles.com' }) : json(401, { message: 'Invalid username/password' });
    }
    if (p === '/subtitles') return json(200, { total_count: state.results.length, data: state.results });
    if (p === '/download') {
      if (state.quota) return json(406, { message: 'You have downloaded your allowed 5 subtitles for 24h', remaining: 0, reset_time_utc: '2026-09-27T00:00:00.000Z' });
      return json(200, { link: `https://dl.opensubtitles.test/file/${(calls.at(-1)!.body as { file_id: number }).file_id}.srt`, remaining: 4 });
    }
    return json(404, { message: 'not found' });
  };
  return { fetchImpl, calls, state };
}

const result = (fileId: number, a: Record<string, unknown> = {}) => ({
  id: String(fileId),
  type: 'subtitle',
  attributes: { language: 'nl', release: `Release.${fileId}`, download_count: 100, hearing_impaired: false, foreign_parts_only: false, moviehash_match: false, from_trusted: false, ai_translated: false, machine_translated: false, files: [{ file_id: fileId, file_name: `${fileId}.srt` }], ...a },
});

let env: TestEnv;
let os_: ReturnType<typeof fakeOpenSubtitles>;
let admin: string;
let fileId: number;

beforeEach(async () => {
  os_ = fakeOpenSubtitles();
  env = await createTestEnv({ fetchImpl: os_.fetchImpl as never });
  admin = await setupAdmin(env.app);
  // Large enough for a file hash (at least 128 KiB).
  touch(path.join(env.mediaDir, 'movies', 'Heat (1995).mkv'), 'v'.repeat(200 * 1024));
  await addLibrary(env, admin, 'movies', 'movies');
  const movie = (await get('/api/movies')).items[0];
  fileId = (await get(`/api/movies/${movie.id}`)).files[0].id;
});
afterEach(() => env.cleanup());

async function get(url: string, cookie = admin) {
  return (await env.app.inject({ url, headers: { cookie } })).json();
}
const req = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, payload?: object, cookie = admin) => env.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
const configure = () => req('PUT', '/api/admin/online-subtitles', { apiKey: 'good-key' });
const search = (language = 'nl', cookie = admin) => req('GET', `/api/media/${fileId}/subtitles/online?language=${language}`, undefined, cookie);

describe('movieHash', () => {
  it('adds the file size and the first and last 64 KiB as 64-bit numbers', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-hash-'));
    try {
      const zeros = path.join(dir, 'zeros.bin');
      fs.writeFileSync(zeros, Buffer.alloc(131072));
      expect(await movieHash(zeros)).toBe('0000000000020000');
      const ones = path.join(dir, 'ones.bin');
      fs.writeFileSync(ones, Buffer.alloc(200000, 1));
      // 16384 words of 0x0101010101010101 plus the size, modulo 2^64.
      const expected = ((16384n * 0x0101010101010101n + 200000n) & 0xffffffffffffffffn).toString(16).padStart(16, '0');
      expect(await movieHash(ones)).toBe(expected);
      const small = path.join(dir, 'small.bin');
      fs.writeFileSync(small, Buffer.alloc(1000));
      expect(await movieHash(small)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('rankSubtitles', () => {
  const s = (fileId: number, x: Partial<OnlineSubtitle>): OnlineSubtitle => ({ fileId, language: 'nl', release: '', hearingImpaired: false, forced: false, downloads: 0, hashMatch: false, machineTranslated: false, trusted: false, ...x });
  it('puts subtitles made for this file first, machine translations last', () => {
    const ranked = rankSubtitles([s(1, { downloads: 9000, machineTranslated: true }), s(2, { downloads: 10 }), s(3, { hashMatch: true, downloads: 1 }), s(4, { downloads: 500 })]);
    expect(ranked.map((r) => r.fileId)).toEqual([3, 4, 2, 1]);
  });
});

describe('setting up OpenSubtitles', () => {
  it('is off until an administrator adds a key, and the player knows it', async () => {
    expect(await get('/api/admin/online-subtitles')).toMatchObject({ configured: false, hint: null });
    expect((await req('POST', `/api/media/${fileId}/playback`, {})).json().onlineSubtitles).toBe(false);
    const res = await search();
    expect(res.statusCode).toBe(409);
    expect(os_.calls).toEqual([]);
  });

  it('checks the key before saving it and never shows it again', async () => {
    const bad = await req('PUT', '/api/admin/online-subtitles', { apiKey: 'wrong-key' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('OpenSubtitles did not accept this API key.');
    const ok = await configure();
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ configured: true, hint: '••••-key', username: null, hasPassword: false });
    expect(JSON.stringify(await get('/api/admin/online-subtitles'))).not.toContain('good-key');
    expect((await req('POST', `/api/media/${fileId}/playback`, {})).json().onlineSubtitles).toBe(true);
    // Every request identifies Velyx.
    expect(os_.calls[0]!.headers['user-agent']).toMatch(/^Velyx v\d/);
    expect((await get('/api/admin/audit')).items.some((e: { action: string }) => e.action === 'subtitles.settings')).toBe(true);
  });

  it('accepts an optional account, checked by signing in', async () => {
    expect((await req('PUT', '/api/admin/online-subtitles', { apiKey: 'good-key', username: 'anna' })).statusCode).toBe(400);
    expect((await req('PUT', '/api/admin/online-subtitles', { apiKey: 'good-key', username: 'anna', password: 'nope' })).statusCode).toBe(400);
    const res = await req('PUT', '/api/admin/online-subtitles', { apiKey: 'good-key', username: 'anna', password: 'secret' });
    expect(res.json()).toMatchObject({ configured: true, username: 'anna', hasPassword: true });
    expect(JSON.stringify(res.json())).not.toContain('secret');
  });

  it('can be turned off again', async () => {
    await configure();
    expect((await req('PUT', '/api/admin/online-subtitles', { apiKey: '' })).json()).toMatchObject({ configured: false });
    expect((await search()).statusCode).toBe(409);
  });

  it('is for administrators only', async () => {
    const anna = await createUser(env.app, admin, 'anna');
    expect((await req('GET', '/api/admin/online-subtitles', undefined, anna.cookie)).statusCode).toBe(403);
    expect((await req('PUT', '/api/admin/online-subtitles', { apiKey: 'good-key' }, anna.cookie)).statusCode).toBe(403);
  });
});

describe('searching', () => {
  beforeEach(async () => {
    await configure();
    os_.calls.length = 0;
  });

  it('searches by file hash and title in the chosen language, best first', async () => {
    os_.state.results = [result(11, { download_count: 5000 }), result(12, { moviehash_match: true, download_count: 3 }), result(13, { files: [{ file_id: 13 }, { file_id: 14 }] })];
    const res = await search('nl');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Split (multi-CD) subtitles are left out.
    expect(body.results.map((r: { fileId: number }) => r.fileId)).toEqual([12, 11]);
    expect(body.results[0]).toMatchObject({ language: 'nl', release: 'Release.12', hashMatch: true, fetched: null });
    const url = os_.calls[0]!.url;
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ languages: 'nl', type: 'movie', query: 'heat', year: '1995' });
    expect(url.searchParams.get('moviehash')).toMatch(/^[0-9a-f]{16}$/);
    // Parameters in alphabetical order, as the API asks.
    const keys = [...url.searchParams.keys()];
    expect(keys).toEqual([...keys].sort());
  });

  it('reuses results for the same file and language', async () => {
    os_.state.results = [result(11)];
    await search('nl');
    await search('nl');
    expect(os_.calls.filter((c) => c.url.pathname.endsWith('/subtitles'))).toHaveLength(1);
    await search('en');
    expect(os_.calls.filter((c) => c.url.pathname.endsWith('/subtitles'))).toHaveLength(2);
  });

  it('checks the language and access', async () => {
    expect((await search('xx')).statusCode).toBe(400);
    expect((await search('<script>')).statusCode).toBe(400);
    expect((await env.app.inject({ url: `/api/media/${fileId}/subtitles/online?language=nl` })).statusCode).toBe(401);
    // A user limited to another library does not see this file at all.
    touch(path.join(env.mediaDir, 'tv', 'Show', 'S01E01.mkv'));
    const tv = await addLibrary(env, admin, 'shows', 'tv');
    const anna = await createUser(env.app, admin, 'anna');
    await req('PUT', `/api/users/${anna.id}`, { libraryIds: [tv.id] });
    expect((await search('nl', anna.cookie)).statusCode).toBe(404);
    expect(os_.calls).toEqual([]);
  });

  it('searches episodes by series, season and episode', async () => {
    touch(path.join(env.mediaDir, 'tv', 'Reacher', 'Reacher.S02E04.mkv'));
    await addLibrary(env, admin, 'shows', 'tv');
    const show = (await get('/api/shows')).items[0];
    const ep = (await get(`/api/shows/${show.id}/seasons/2`)).episodes[0];
    const epFile = (await get(`/api/episodes/${ep.id}`)).files[0].id;
    await req('GET', `/api/media/${epFile}/subtitles/online?language=en`);
    expect(Object.fromEntries(os_.calls[0]!.url.searchParams)).toMatchObject({ languages: 'en', type: 'episode', season_number: '2', episode_number: '4', query: 'reacher s02e04' });
  });

  it('explains provider problems', async () => {
    env.ctx.settings.update({ openSubtitlesApiKey: 'revoked-key' });
    const res = await search('nl');
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatch(/did not accept the API key/);
  });
});

describe('fetching a subtitle', () => {
  beforeEach(async () => {
    await configure();
    os_.state.results = [result(21, { moviehash_match: true, hearing_impaired: true }), result(22)];
    await search('nl');
    os_.calls.length = 0;
  });
  const fetchSub = (id: number, cookie = admin) => req('POST', `/api/media/${fileId}/subtitles/online`, { fileId: id }, cookie);

  it('downloads it once, converts it and offers it with the file’s other subtitles', async () => {
    const res = await fetchSub(21);
    expect(res.statusCode).toBe(200);
    const option = res.json();
    expect(option).toMatchObject({ kind: 'online', language: 'nl', title: 'SDH', label: 'Release.21', removable: true });
    expect(os_.calls.find((c) => c.url.pathname.endsWith('/download'))!.body).toEqual({ file_id: 21, sub_format: 'srt' });
    const vtt = await env.app.inject({ url: option.url, headers: { cookie: admin } });
    expect(vtt.headers['content-type']).toMatch(/^text\/vtt/);
    expect(vtt.body).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nHallo daar\n\n00:00:05.000 --> 00:00:06.000\nTot ziens\n');
    // Shifted for live streams that start later, like other subtitles.
    expect((await env.app.inject({ url: `${option.url}?offset=2`, headers: { cookie: admin } })).body).toContain('00:00:03.000 --> 00:00:04.000');
    // Stored in Velyx's data folder, never next to the media.
    expect(fs.readdirSync(env.ctx.config.onlineSubtitleDir)).toEqual([`${fileId}-21.vtt`]);
    expect(fs.readdirSync(path.join(env.mediaDir, 'movies'))).toEqual(['Heat (1995).mkv']);
    // From now on it is one of the file's subtitles, also for others, and marked in search results.
    const anna = await createUser(env.app, admin, 'anna');
    const list = await get(`/api/media/${fileId}/subtitles`, anna.cookie);
    expect(list).toEqual([expect.objectContaining({ key: option.key, kind: 'online', removable: false })]);
    expect((await search('nl')).json().results[0].fetched).toMatchObject({ key: option.key });
    // Asking again does not download again.
    os_.calls.length = 0;
    expect((await fetchSub(21)).json().key).toBe(option.key);
    expect(os_.calls).toEqual([]);
    expect((await get('/api/admin/audit')).items.some((e: { action: string }) => e.action === 'subtitles.downloaded')).toBe(true);
  });

  it('only fetches subtitles a search offered for this file', async () => {
    const res = await fetchSub(999);
    expect(res.statusCode).toBe(400);
    expect(os_.calls).toEqual([]);
  });

  it('explains the daily download limit', async () => {
    os_.state.quota = true;
    await req('PUT', '/api/account/language', { language: 'nl' });
    const res = await fetchSub(21);
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toMatch(/^De dagelijkse downloadlimiet bij OpenSubtitles is bereikt\. Probeer het opnieuw na /);
  });

  it('refuses files that are not subtitles', async () => {
    os_.state.downloadBody = '<html>Not found</html>';
    expect((await fetchSub(22)).statusCode).toBe(502);
    expect(fs.readdirSync(env.ctx.config.onlineSubtitleDir)).toEqual([]);
  });

  it('can be removed by the person who fetched it or an administrator', async () => {
    const anna = await createUser(env.app, admin, 'anna');
    const bert = await createUser(env.app, admin, 'bert');
    await search('nl', anna.cookie);
    const option = (await fetchSub(22, anna.cookie)).json();
    const id = option.url.match(/(\d+)\.vtt$/)[1];
    expect((await req('DELETE', `/api/online-subtitles/${id}`, undefined, bert.cookie)).statusCode).toBe(403);
    expect((await req('DELETE', `/api/online-subtitles/${id}`, undefined, anna.cookie)).statusCode).toBe(200);
    expect(await get(`/api/media/${fileId}/subtitles`)).toEqual([]);
    expect(fs.readdirSync(env.ctx.config.onlineSubtitleDir)).toEqual([]);
    expect((await env.app.inject({ url: option.url, headers: { cookie: admin } })).statusCode).toBe(404);
  });

  it('goes away with its media file', async () => {
    await fetchSub(21);
    env.ctx.db.$client.prepare('DELETE FROM media_files WHERE id = ?').run(fileId);
    expect(env.ctx.db.$client.prepare('SELECT count(*) AS n FROM online_subtitles').get()).toEqual({ n: 0 });
  });
});

describe('upgrading', () => {
  it('adds the table to an existing database without touching anything else', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-subs-'));
    try {
      const old = path.join(dir, 'old');
      fs.cpSync(migrationsFolder(), old, { recursive: true });
      const journalFile = path.join(old, 'meta', '_journal.json');
      const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
      const at = journal.entries.findIndex((e: { tag: string }) => e.tag === '0017_online_subtitles');
      expect(at).toBeGreaterThan(0);
      journal.entries.splice(at);
      fs.writeFileSync(journalFile, JSON.stringify(journal));
      const file = path.join(dir, 'velyx.db');
      const before = openDatabase(file, { migrationsFolder: old });
      before.$client.prepare("INSERT INTO users (username, password_hash, role) VALUES ('oud', 'x', 'admin')").run();
      before.$client.close();
      const after = openDatabase(file, { backupDir: path.join(dir, 'backups') });
      expect(after.$client.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'online_subtitles'").get()).toEqual({ name: 'online_subtitles' });
      expect(after.$client.prepare('SELECT username FROM users').all()).toEqual([{ username: 'oud' }]);
      after.$client.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
