import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildCloudApp, SESSION_COOKIE } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db/client.js';
import { accounts } from '../src/db/schema.js';

// The app on a TV signs in with a code that someone signed in on vidalune.com enters.
let dir: string;
let db: DB;
let cloud: FastifyInstance;
let clock: number;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-cloud-tv-'));
  const config = loadConfig({ DATA_DIR: dir, PUBLIC_URL: 'https://vidalune.com' }, { webDir: null });
  db = openDatabase(config.dbPath);
  clock = Date.UTC(2026, 9, 21, 12);
  cloud = await buildCloudApp(config, db, { now: () => clock });
});
afterEach(async () => {
  await cloud.close();
  db.$client.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function account(email: string) {
  const res = await cloud.inject({ method: 'POST', url: '/api/account', payload: { email, password: 'correct-horse' } });
  return `${SESSION_COOKIE}=${res.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
}
const newCode = async () => (await cloud.inject({ method: 'POST', url: '/api/tv/code', payload: {} })).json() as { code: string; device: string; url: string; expiresIn: number; interval: number };
const poll = (device: string) => cloud.inject({ method: 'POST', url: '/api/tv/poll', payload: { device } });
const confirm = (cookie: string, code: string) => cloud.inject({ method: 'POST', url: '/api/tv/confirm', headers: { cookie }, payload: { code } });

describe('signing in on a TV with a code', () => {
  it('gives the TV a session of the account that entered its code, once', async () => {
    const tv = await newCode();
    expect(tv.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(tv).toMatchObject({ url: 'https://vidalune.com/tv', expiresIn: 600, interval: 5 });
    expect((await poll(tv.device)).json()).toEqual({ pending: true });

    const cookie = await account('justin@example.com');
    // Typed as it is read off the TV: lower case, without the dash.
    expect((await confirm(cookie, tv.code.replace('-', ' ').toLowerCase())).statusCode).toBe(200);

    const done = await poll(tv.device);
    expect(done.statusCode).toBe(200);
    const { email, token } = done.json() as { email: string; token: string };
    expect(email).toBe('justin@example.com');
    // The TV is signed in with that account (as the app: a token, no cookie).
    expect(done.cookies).toHaveLength(0);
    const me = await cloud.inject({ url: '/api/account', headers: { authorization: `Bearer ${token}` } });
    expect(me.json().email).toBe('justin@example.com');
    // Used once: asking again does not give a second session.
    expect((await poll(tv.device)).statusCode).toBe(410);
  });

  it('only signs in a TV after a signed-in person confirms its code', async () => {
    const tv = await newCode();
    expect((await cloud.inject({ method: 'POST', url: '/api/tv/confirm', payload: { code: tv.code } })).statusCode).toBe(401);
    // Someone else's secret does not get the session.
    const cookie = await account('justin@example.com');
    await confirm(cookie, tv.code);
    expect((await poll('x'.repeat(43))).statusCode).toBe(410);
    expect((await poll(tv.device)).statusCode).toBe(200);
  });

  it('turns down codes that do not exist, are used or have expired', async () => {
    const cookie = await account('justin@example.com');
    expect((await confirm(cookie, 'ABCD-EFGH')).statusCode).toBe(400);
    const used = await newCode();
    await confirm(cookie, used.code);
    expect((await confirm(cookie, used.code)).statusCode).toBe(400);

    const old = await newCode();
    clock += 10 * 60_000 + 1;
    expect((await confirm(cookie, old.code)).statusCode).toBe(400);
    expect((await poll(old.device)).statusCode).toBe(410);
  });

  it('gives no session for an account suspended in between', async () => {
    const tv = await newCode();
    const cookie = await account('justin@example.com');
    await confirm(cookie, tv.code);
    db.update(accounts).set({ suspendedAt: clock }).where(eq(accounts.email, 'justin@example.com')).run();
    expect((await poll(tv.device)).statusCode).toBe(410);
  });

  it('limits guessing: a few codes a minute per account', async () => {
    const cookie = await account('justin@example.com');
    const answers = [];
    for (const last of 'ABCDEFGHJKMN') answers.push((await confirm(cookie, `ZZZZ-ZZZ${last}`)).statusCode);
    expect(answers.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(answers.slice(10)).toEqual([429, 429]);
  });

  it('serves the page to enter the code on', async () => {
    expect(fs.existsSync(path.join(import.meta.dirname, '../web/account.js'))).toBe(true);
    const js = fs.readFileSync(path.join(import.meta.dirname, '../web/account.js'), 'utf8');
    expect(js).toContain("page === '/tv'");
    expect(js).toContain('/api/tv/confirm');
  });
});
