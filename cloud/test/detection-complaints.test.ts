import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildCloudApp, sessionCookieName } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db/client.js';
import { detectionComplaints } from '../src/db/schema.js';

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

const send = (auth: string, extra: object) =>
  app.inject({ method: 'POST', url: '/api/detection/reports', headers: { authorization: auth }, payload: { tmdbShow: 1399, season: 2, episodes: [], ...extra } });
const complaint = (o: Partial<{ episode: number; duration: number; kind: string; problem: string; count: number }> = {}) => ({ episode: 3, duration: 3000, kind: 'intro', problem: 'starts-early', count: 1, ...o });

describe('what viewers report about intros and credits', () => {
  it('stores a server\'s reports, replaces them on the next report, keeps them when the field is missing and clears them with an empty list', async () => {
    const s = await register();
    expect((await send(s.auth, { complaints: [complaint({ count: 2 }), complaint({ problem: 'ends-late' })] })).statusCode).toBe(200);
    expect(db.select().from(detectionComplaints).all()).toHaveLength(2);
    await send(s.auth, { complaints: [complaint({ count: 5 })] });
    expect(db.select().from(detectionComplaints).all().map((c) => [c.problem, c.count])).toEqual([['starts-early', 5]]);
    // A report without the field (an older server) leaves them alone.
    await send(s.auth, {});
    expect(db.select().from(detectionComplaints).all()).toHaveLength(1);
    await send(s.auth, { complaints: [] });
    expect(db.select().from(detectionComplaints).all()).toHaveLength(0);
  });

  it('validates what a server sends', async () => {
    const s = await register();
    for (const bad of [complaint({ problem: 'too-loud' }), complaint({ kind: 'trailer' }), complaint({ count: 0 }), complaint({ count: 1001 }), complaint({ duration: 10 }), { ...complaint(), extra: 1, count: 1.5 }]) {
      expect((await send(s.auth, { complaints: [bad] })).statusCode).toBe(400);
    }
    expect((await send(s.auth, { complaints: Array.from({ length: 401 }, () => complaint()) })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/detection/reports', payload: { tmdbShow: 1399, season: 2, episodes: [], complaints: [complaint()] } })).statusCode).toBe(401);
    expect(db.select().from(detectionComplaints).all()).toHaveLength(0);
  });

  it('adds them up over servers for the CEO, per season and per episode, cut and part', async () => {
    const a = await register('A');
    const b = await register('B');
    await send(a.auth, { complaints: [complaint({ count: 2 }), complaint({ kind: 'credits', problem: 'ends-early' })] });
    // The same cut (length within 2 s) on another server, and another cut.
    await send(b.auth, { complaints: [complaint({ duration: 3001.5 }), complaint({ duration: 2500, problem: 'missing' })] });
    const ceo = await signUp('ceo@example.com');
    const list = (await call(ceo, 'GET', '/api/ceo/detection')).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ tmdbShow: 1399, season: 2, complaints: 5 });
    const detail = (await call(ceo, 'GET', '/api/ceo/detection/1399/2')).json();
    const at = (kind: string, duration: number) => detail.entries.find((e: { kind: string; duration: number }) => e.kind === kind && Math.abs(e.duration - duration) <= 2);
    expect(at('intro', 3000).complaints).toEqual([{ problem: 'starts-early', count: 3 }]);
    expect(at('credits', 3000).complaints).toEqual([{ problem: 'ends-early', count: 1 }]);
    expect(at('intro', 2500).complaints).toEqual([{ problem: 'missing', count: 1 }]);
    const customer = await signUp('anna@example.com');
    expect((await call(customer, 'GET', '/api/ceo/detection/1399/2')).statusCode).toBe(403);
  });

  it('go with the server when it is removed', async () => {
    const s = await register();
    await send(s.auth, { complaints: [complaint()] });
    expect((await app.inject({ method: 'DELETE', url: '/api/server', headers: { authorization: s.auth } })).statusCode).toBeLessThan(300);
    expect(db.select().from(detectionComplaints).all()).toHaveLength(0);
  });
});
