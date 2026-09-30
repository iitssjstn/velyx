import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildCloudApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db/client.js';
import { detectionPrints, detectionReports } from '../src/db/schema.js';
import { consensus, type Report } from '../src/detection.js';

let dir: string;
let db: DB;
let app: FastifyInstance;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-cloud-'));
  const config = loadConfig({ DATA_DIR: dir, PUBLIC_URL: 'https://vidalune.example' }, { webDir: null, frontendDir: null });
  db = openDatabase(config.dbPath);
  app = await buildCloudApp(config, db, {});
});
afterEach(async () => {
  await app.close();
  db.$client.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function register(name = 'Thuis') {
  const res = await app.inject({ method: 'POST', url: '/api/server/register', payload: { name, version: '0.12.0', url: null } });
  const { id, secret } = res.json();
  return { id: id as string, auth: `Server ${id}:${secret}` };
}

const words = (seed: number, n = 300) => Buffer.from(new Uint32Array(Array.from({ length: n }, (_, i) => (seed * 7919 + i * 104729) >>> 0)).buffer).toString('base64');
const report = (auth: string, body: object) => app.inject({ method: 'POST', url: '/api/detection/reports', headers: { authorization: auth }, payload: body });
const intro = (start: number, end: number, source = 'audio') => ({ kind: 'intro', start, end, source });

describe('shared detection: agreeing', () => {
  const r = (serverId: string, over: Partial<Report> = {}): Report => ({ serverId, episode: 1, kind: 'intro', duration: 2700, start: 60, end: 90, source: 'audio', ...over });

  it('takes what most servers found, and counts who agrees', () => {
    const [a] = consensus([r('a'), r('b', { start: 61, end: 91 }), r('c', { start: 60.5, end: 89.5 }), r('d', { start: 200, end: 230 })]);
    expect(a).toMatchObject({ episode: 1, kind: 'intro', start: 60.5, end: 90, confirmations: 3, reports: 4, manual: false });
  });

  it('keeps different cuts of an episode apart', () => {
    const out = consensus([r('a'), r('b', { duration: 2701.5 }), r('c', { duration: 2760, start: 120, end: 150 })]);
    expect(out.map((x) => [x.duration, x.start, x.confirmations])).toEqual([
      [2700.8, 60, 2],
      [2760, 120, 1],
    ]);
  });

  it('gives a correction by hand more weight, and takes its timing', () => {
    const [a] = consensus([r('a'), r('b', { start: 70, end: 95, source: 'manual' })]);
    expect(a).toMatchObject({ start: 70, end: 95, confirmations: 1, reports: 2, manual: true });
    const [b] = consensus([r('a'), r('b', { start: 61, end: 91, source: 'manual' }), r('c')]);
    expect(b).toMatchObject({ start: 61, end: 91, confirmations: 3, manual: true });
  });

  it('keeps episodes and parts apart', () => {
    const out = consensus([r('a'), r('a', { kind: 'credits', start: 2600, end: 2700 }), r('b', { episode: 2 })]);
    expect(out.map((x) => `${x.episode}${x.kind}`)).toEqual(['1credits', '1intro', '2intro']);
  });
});

describe('shared detection: the service', () => {
  it('only answers servers it knows', async () => {
    expect((await app.inject({ url: '/api/detection/1399/1' })).statusCode).toBe(401);
    expect((await report('Server nope:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', { tmdbShow: 1, season: 1, episodes: [] })).statusCode).toBe(401);
  });

  it('collects reports from servers and gives back what they agree on', async () => {
    const a = await register('A');
    const b = await register('B');
    const c = await register('C');
    const first = await report(a.auth, { tmdbShow: 1399, season: 1, episodes: [{ episode: 1, duration: 2700, parts: [intro(60, 90), { kind: 'credits', start: 2640, end: 2700, source: 'video' }] }], prints: [{ kind: 'intro', words: words(1) }] });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ servers: 1, parts: [{ kind: 'credits', confirmations: 1 }, { kind: 'intro', confirmations: 1 }], mine: [{ episode: 1 }, { episode: 1 }], prints: [] });
    await report(b.auth, { tmdbShow: 1399, season: 1, episodes: [{ episode: 1, duration: 2701, parts: [intro(61, 91)] }] });
    await report(c.auth, { tmdbShow: 1399, season: 1, episodes: [{ episode: 1, duration: 2699, parts: [intro(60, 90)] }], prints: [{ kind: 'intro', words: words(2) }, { kind: 'credits', words: words(3) }] });

    const p = (await app.inject({ url: '/api/detection/1399/1', headers: { authorization: b.auth } })).json();
    expect(p.servers).toBe(3);
    expect(p.parts.find((x: { kind: string }) => x.kind === 'intro')).toMatchObject({ start: 60, end: 90, confirmations: 3 });
    // Others' fingerprints only (B has none of its own here).
    expect(p.prints.map((x: { kind: string }) => x.kind).sort()).toEqual(['credits', 'intro', 'intro']);
    expect(p.mine).toEqual([{ episode: 1, kind: 'intro', duration: 2701, start: 61, end: 91 }]);
    // Other seasons and shows are separate.
    expect((await app.inject({ url: '/api/detection/1399/2', headers: { authorization: b.auth } })).json()).toMatchObject({ servers: 0, parts: [], prints: [] });
  });

  it('replaces what a server said before, and forgets it with the server', async () => {
    const a = await register('A');
    await report(a.auth, { tmdbShow: 5, season: 1, episodes: [{ episode: 1, duration: 1500, parts: [intro(10, 40)] }], prints: [{ kind: 'intro', words: words(1) }, { kind: 'intro', words: words(2) }] });
    await report(a.auth, { tmdbShow: 5, season: 1, episodes: [{ episode: 1, duration: 1500, parts: [intro(12, 42)] }], prints: [{ kind: 'intro', words: words(3) }] });
    expect(db.select().from(detectionReports).all().map((r) => r.start)).toEqual([12]);
    expect(db.select().from(detectionPrints).all()).toHaveLength(1);
    // An episode reported without parts: nothing found there any more.
    await report(a.auth, { tmdbShow: 5, season: 1, episodes: [{ episode: 1, duration: 1500, parts: [] }] });
    expect(db.select().from(detectionReports).all()).toEqual([]);
    await report(a.auth, { tmdbShow: 5, season: 1, episodes: [{ episode: 1, duration: 1500, parts: [intro(12, 42)] }] });
    await app.inject({ method: 'DELETE', url: '/api/server', headers: { authorization: a.auth } });
    expect(db.select().from(detectionReports).all()).toEqual([]);
    expect(db.select().from(detectionPrints).all()).toEqual([]);
  });

  it('refuses what does not make sense', async () => {
    const a = await register();
    const bad = (body: object) => report(a.auth, body).then((r) => r.statusCode);
    expect(await bad({ tmdbShow: 1, season: 1, episodes: [{ episode: 1, duration: 1500, parts: [intro(40, 10)] }] })).toBe(400);
    expect(await bad({ tmdbShow: 1, season: 1, episodes: [{ episode: 1, duration: 10, parts: [] }] })).toBe(400);
    expect(await bad({ tmdbShow: -1, season: 1, episodes: [] })).toBe(400);
    expect(await bad({ tmdbShow: 1, season: 1, episodes: [], prints: [{ kind: 'intro', words: 'not base64!' }] })).toBe(400);
    expect(await bad({ tmdbShow: 1, season: 1, episodes: [], prints: [{ kind: 'intro', words: 'A'.repeat(30_000) }] })).toBe(400);
    // Too short to be a fingerprint: ignored.
    expect(await bad({ tmdbShow: 1, season: 1, episodes: [], prints: [{ kind: 'intro', words: words(1, 5) }] })).toBe(200);
    expect(db.select().from(detectionPrints).all()).toEqual([]);
  });
});
