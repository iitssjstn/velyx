import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildCloudApp, sessionCookieName } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db/client.js';
import { ceoEvents, detectionOverrides } from '../src/db/schema.js';
import { serverLabel } from '../src/detection.js';

const SESSION_COOKIE = sessionCookieName(true);
let dir: string;
let db: DB;
let app: FastifyInstance;
let tmdbCalls: string[];

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-cloud-'));
  const config = loadConfig({ DATA_DIR: dir, PUBLIC_URL: 'https://vidalune.example', CEO_EMAILS: 'ceo@example.com' }, { webDir: null, frontendDir: null });
  db = openDatabase(config.dbPath);
  tmdbCalls = [];
  // TMDB knows show 1399; anything else is not found.
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    tmdbCalls.push(url);
    if (url.includes('/tv/1399')) return new Response(JSON.stringify({ id: 1399, name: 'Game of Thrones' }), { status: 200 });
    return new Response(JSON.stringify({ status_message: 'not found' }), { status: 404 });
  }) as typeof fetch;
  app = await buildCloudApp(config, db, { fetchImpl });
});
afterEach(async () => {
  await app.close();
  db.$client.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const cookieOf = (res: { cookies: Array<{ name: string; value: string }> }) => `${SESSION_COOKIE}=${res.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
async function signUp(email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/account', payload: { email, password: 'correct-horse' } });
  expect(res.statusCode).toBe(200);
  return cookieOf(res);
}
async function register(name = 'Thuis') {
  const res = await app.inject({ method: 'POST', url: '/api/server/register', payload: { name, version: '0.20.3', url: null } });
  const { id, secret } = res.json();
  return { id: id as string, auth: `Server ${id}:${secret}` };
}
const call = (cookie: string, method: string, url: string, payload?: object) => app.inject({ method: method as 'GET', url, headers: { cookie }, payload });
const report = (auth: string, episodes: object[]) =>
  app.inject({ method: 'POST', url: '/api/detection/reports', headers: { authorization: auth }, payload: { tmdbShow: 1399, season: 2, episodes } });
const intro = (start: number, end: number, source = 'audio') => ({ kind: 'intro', start, end, source });
const profileOf = (auth: string) => app.inject({ url: '/api/detection/1399/2', headers: { authorization: auth } });

describe('corrections by the CEO', () => {
  it('are only for the CEO, checked on every call', async () => {
    const ceo = await signUp('ceo@example.com');
    const customer = await signUp('anna@example.com');
    const urls: Array<[string, string, object?]> = [
      ['GET', '/api/ceo/detection'],
      ['GET', '/api/ceo/detection/1399/2'],
      ['PUT', '/api/ceo/detection/1399/2/1', { kind: 'intro', duration: 3000, start: 60, end: 90 }],
      ['DELETE', '/api/ceo/detection/1399/2/1?kind=intro&duration=3000'],
    ];
    for (const [method, url, body] of urls) {
      expect((await app.inject({ method: method as 'GET', url, payload: body })).statusCode, url).toBe(401);
      expect((await call(customer, method, url, body)).statusCode, url).toBe(403);
    }
    expect((await call(ceo, 'GET', '/api/ceo/detection')).statusCode).toBe(200);
    expect(db.select().from(detectionOverrides).all()).toEqual([]);
  });

  it('checks what is sent', async () => {
    const ceo = await signUp('ceo@example.com');
    const put = (body: object, url = '/api/ceo/detection/1399/2/1') => call(ceo, 'PUT', url, body);
    const good = { kind: 'intro', duration: 3000, start: 60, end: 90 };
    for (const bad of [
      { ...good, kind: 'outro' },
      { ...good, end: 50 },
      { ...good, end: 3100 },
      { ...good, start: -1 },
      { ...good, duration: 10 },
      { ...good, extra: true },
      { kind: 'intro', start: 60, end: 90 },
    ])
      expect((await put(bad)).statusCode, JSON.stringify(bad)).toBe(400);
    expect((await put(good, '/api/ceo/detection/abc/2/1')).statusCode).toBe(400);
    expect((await put(good, '/api/ceo/detection/1399/2/-1')).statusCode).toBe(400);
    expect((await call(ceo, 'DELETE', '/api/ceo/detection/1399/2/1?kind=intro')).statusCode).toBe(400);
    expect((await call(ceo, 'GET', '/api/ceo/detection?page=0')).statusCode).toBe(400);
    expect((await put(good)).statusCode).toBe(200);
  });

  it('reach every server in the profile, one per cut: saving again replaces it, another cut stays apart', async () => {
    const ceo = await signUp('ceo@example.com');
    const a = await register('A');
    await report(a.auth, [{ episode: 1, duration: 3000, parts: [intro(60, 90)] }]);
    expect((await profileOf(a.auth)).json().overrides).toEqual([]);

    expect((await call(ceo, 'PUT', '/api/ceo/detection/1399/2/1', { kind: 'intro', duration: 3000, start: 61.04, end: 92 })).json()).toEqual({ ok: true, override: { episode: 1, kind: 'intro', duration: 3000, start: 61, end: 92 } });
    // The same cut (within two seconds): replaced, not added.
    await call(ceo, 'PUT', '/api/ceo/detection/1399/2/1', { kind: 'intro', duration: 3001.5, start: 62, end: 93 });
    // Another cut of the same episode, and another kind: kept apart.
    await call(ceo, 'PUT', '/api/ceo/detection/1399/2/1', { kind: 'intro', duration: 2400, start: 10, end: 40 });
    await call(ceo, 'PUT', '/api/ceo/detection/1399/2/1', { kind: 'credits', duration: 3000, start: 2900, end: 3000 });
    const overrides = (await profileOf(a.auth)).json().overrides;
    expect(overrides).toEqual([
      { episode: 1, kind: 'credits', duration: 3000, start: 2900, end: 3000 },
      { episode: 1, kind: 'intro', duration: 2400, start: 10, end: 40 },
      { episode: 1, kind: 'intro', duration: 3001.5, start: 62, end: 93 },
    ]);
    // Also in the answer to a report, and for a server that never reported this season.
    const b = await register('B');
    expect((await profileOf(b.auth)).json().overrides).toHaveLength(3);
    expect((await report(b.auth, [{ episode: 1, duration: 3000, parts: [intro(60, 90)] }])).json().overrides).toHaveLength(3);
    // Another season is not touched.
    expect((await app.inject({ url: '/api/detection/1399/3', headers: { authorization: a.auth } })).json().overrides).toEqual([]);

    // Removing: only that cut.
    expect((await call(ceo, 'DELETE', '/api/ceo/detection/1399/2/1?kind=intro&duration=3000')).statusCode).toBe(200);
    expect((await profileOf(a.auth)).json().overrides.map((o: { duration: number }) => o.duration)).toEqual([3000, 2400]);
    expect((await call(ceo, 'DELETE', '/api/ceo/detection/1399/2/1?kind=intro&duration=3000')).statusCode).toBe(404);

    const events = db.select().from(ceoEvents).all().filter((e) => e.action.startsWith('detection.'));
    expect(events.map((e) => e.action)).toEqual(['detection.corrected', 'detection.corrected', 'detection.corrected', 'detection.corrected', 'detection.correctionRemoved']);
    expect(events[0]).toMatchObject({ actor: 'ceo@example.com', target: 'TMDB 1399 S02E01' });
    expect(JSON.parse(events[1].detail!)).toMatchObject({ kind: 'intro', start: 62, end: 93, before: { start: 61, end: 92 } });
  });

  it('lists seasons with their name, servers, corrections and open proposals from administrators', async () => {
    const ceo = await signUp('ceo@example.com');
    const a = await register('A');
    const b = await register('B');
    await report(a.auth, [{ episode: 1, duration: 3000, parts: [intro(60, 90)] }, { episode: 2, duration: 3000, parts: [intro(30, 60, 'manual')] }]);
    await report(b.auth, [{ episode: 1, duration: 3000, parts: [intro(61, 91, 'manual')] }]);
    await app.inject({ method: 'POST', url: '/api/detection/reports', headers: { authorization: a.auth }, payload: { tmdbShow: 777, season: 1, episodes: [{ episode: 1, duration: 1500, parts: [intro(5, 30)] }] } });
    // The CEO decides episode 1: that proposal is settled, the one of episode 2 stays open.
    await call(ceo, 'PUT', '/api/ceo/detection/1399/2/1', { kind: 'intro', duration: 3000, start: 61, end: 91 });

    // TMDB needs a key in the Control Center: without one, no names (and TMDB is not asked).
    let list = (await call(ceo, 'GET', '/api/ceo/detection')).json();
    expect(list.items.map((x: { title: string | null }) => x.title)).toEqual([null, null]);
    expect(tmdbCalls).toEqual([]);

    db.$client.prepare("INSERT INTO service_settings (key, value, updated_at, updated_by) VALUES ('tmdb', ?, 0, 'ceo@example.com')").run(JSON.stringify({ apiKey: 'k'.repeat(32) }));
    // The key is read once and kept: a fresh app sees it.
    await app.close();
    app = await buildCloudApp(loadConfig({ DATA_DIR: dir, PUBLIC_URL: 'https://vidalune.example', CEO_EMAILS: 'ceo@example.com' }, { webDir: null, frontendDir: null }), db, {
      fetchImpl: (async (input: string | URL) => {
        tmdbCalls.push(String(input));
        return String(input).includes('/tv/1399') ? new Response(JSON.stringify({ name: 'Game of Thrones' }), { status: 200 }) : new Response('{}', { status: 404 });
      }) as typeof fetch,
    });
    const ceo2 = (await app.inject({ method: 'POST', url: '/api/login', payload: { email: 'ceo@example.com', password: 'correct-horse' } }));
    const cookie = cookieOf(ceo2);
    list = (await call(cookie, 'GET', '/api/ceo/detection')).json();
    // Newest change first: the correction of 1399 season 2.
    expect(list).toMatchObject({ total: 2, page: 1, items: [
      { tmdbShow: 1399, season: 2, title: 'Game of Thrones', servers: 2, episodes: 2, overrides: 1, proposals: 1 },
      { tmdbShow: 777, season: 1, title: null, servers: 1, episodes: 1, overrides: 0, proposals: 0 },
    ] });
    // Names are kept: TMDB is not asked again for a known show.
    const asked = tmdbCalls.length;
    await call(cookie, 'GET', '/api/ceo/detection');
    expect(tmdbCalls.filter((u) => u.includes('/tv/1399')).length).toBe(tmdbCalls.slice(0, asked).filter((u) => u.includes('/tv/1399')).length);

    // Searching by name or TMDB number.
    expect((await call(cookie, 'GET', '/api/ceo/detection?q=thrones')).json().items.map((x: { tmdbShow: number }) => x.tmdbShow)).toEqual([1399]);
    expect((await call(cookie, 'GET', '/api/ceo/detection?q=777')).json().items.map((x: { tmdbShow: number }) => x.tmdbShow)).toEqual([777]);
    expect((await call(cookie, 'GET', '/api/ceo/detection?q=nothing')).json().items).toEqual([]);

    // A season: what servers agree on, the open proposals (a label, never the server's id), the correction.
    const season = (await call(cookie, 'GET', '/api/ceo/detection/1399/2')).json();
    expect(season).toMatchObject({ tmdbShow: 1399, season: 2, title: 'Game of Thrones', servers: 2 });
    expect(season.entries).toEqual([
      { episode: 1, kind: 'intro', duration: 3000, consensus: { start: 61, end: 91, confirmations: 2, reports: 2, manual: true }, proposals: [], override: { start: 61, end: 91, updatedAt: expect.any(Number) } },
      { episode: 2, kind: 'intro', duration: 3000, consensus: { start: 30, end: 60, confirmations: 1, reports: 1, manual: true }, proposals: [{ server: serverLabel(a.id), start: 30, end: 60 }], override: null },
    ]);
    expect(JSON.stringify(season)).not.toContain(a.id);
    expect(serverLabel(a.id)).toMatch(/^[0-9a-f]{6}$/);
  });
});

describe('the privacy policy', () => {
  it('says linked servers share intros and credits by default, that sharing can be turned off, and what is never sent', async () => {
    const en = (await app.inject({ url: '/privacy' })).body;
    expect(en).toContain('A linked server shares where it found the recap, intro and credits');
    expect(en).toContain('an administrator can turn sharing off in Admin → Maintenance');
    expect(en).toContain('Never titles, file names, paths, users or what anyone watches.');
    const nl = (await app.inject({ url: '/privacy', headers: { 'accept-language': 'nl-NL,nl;q=0.9' } })).body;
    expect(nl).toContain('Een gekoppelde server deelt waar hij de recap, intro en aftiteling');
    expect(nl).toContain('een beheerder kan het delen uitzetten onder Beheer → Onderhoud');
  });
});
