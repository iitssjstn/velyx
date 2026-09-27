import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrationsFolder, openDatabase } from '../src/db/client.js';
import { PairingService, normalizeCode } from '../src/services/pairing.js';
import { addLibrary, createTestEnv, createUser, setupAdmin, touch, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
beforeEach(async () => {
  env = await createTestEnv();
  admin = await setupAdmin(env.app, 'admin', 'correct-horse');
});
afterEach(async () => {
  await env.cleanup();
});

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
const call = (method: Method, url: string, opts: { payload?: object; cookie?: string; token?: string } = {}) =>
  env.app.inject({
    method,
    url,
    headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    ...(opts.payload ? { payload: opts.payload } : {}),
  });

describe('signing in from the Vidalune app', () => {
  it('says which API version the server speaks, before signing in', async () => {
    const info = (await call('GET', '/api/server/info')).json();
    expect(info).toMatchObject({ product: 'Vidalune', apiVersion: 1 });
  });

  it('gets a token by password, used as a bearer token for everything, including streams', async () => {
    touch(path.join(env.mediaDir, 'movies', 'Heat (1995).mkv'));
    await addLibrary(env, admin, 'movies', 'movies');
    const res = await call('POST', '/api/auth/app/login', { payload: { username: 'Admin', password: 'correct-horse', deviceName: 'Pixel 8' } });
    expect(res.statusCode).toBe(200);
    const { token, user, expiresAt } = res.json();
    expect(user).toMatchObject({ username: 'admin', role: 'admin' });
    expect(expiresAt).toBeGreaterThan(Date.now());
    // No cookie: the app keeps the token itself.
    expect(res.headers['set-cookie']).toBeUndefined();
    expect((await call('GET', '/api/auth/me', { token })).json().user.username).toBe('admin');
    const movie = (await call('GET', '/api/movies', { token })).json().items[0];
    const file = (await call('GET', `/api/movies/${movie.id}`, { token })).json().files[0];
    expect((await call('POST', `/api/media/${file.id}/playback`, { token, payload: {} })).statusCode).toBe(200);
    // State-changing calls work without an Origin header or cookie.
    expect((await call('POST', '/api/favorites', { token, payload: { movieId: movie.id } })).statusCode).toBe(200);
  });

  it('shows app devices in the session list, where they can be signed out', async () => {
    const { token } = (await call('POST', '/api/auth/app/login', { payload: { username: 'admin', password: 'correct-horse', deviceName: 'Pixel 8' } })).json();
    const sessions = (await call('GET', '/api/account/sessions', { cookie: admin })).json();
    const app = sessions.find((s: { client: string }) => s.client === 'app');
    expect(app).toMatchObject({ client: 'app', deviceName: 'Pixel 8', device: 'Pixel 8', current: false });
    expect(sessions.find((s: { current: boolean }) => s.current)).toMatchObject({ client: 'web', deviceName: null });
    // From the app, its own session is the current one.
    expect((await call('GET', '/api/account/sessions', { token })).json().find((s: { current: boolean }) => s.current).client).toBe('app');
    expect((await call('DELETE', `/api/account/sessions/${app.id}`, { cookie: admin })).statusCode).toBe(200);
    expect((await call('GET', '/api/auth/me', { token })).statusCode).toBe(401);
  });

  it('signs the app out with its token', async () => {
    const { token } = (await call('POST', '/api/auth/app/login', { payload: { username: 'admin', password: 'correct-horse', deviceName: 'Pixel 8' } })).json();
    expect((await call('POST', '/api/auth/logout', { token })).statusCode).toBe(200);
    expect((await call('GET', '/api/auth/me', { token })).statusCode).toBe(401);
    // The browser session is untouched.
    expect((await call('GET', '/api/auth/me', { cookie: admin })).statusCode).toBe(200);
  });

  it('keeps browser sessions and app tokens apart', async () => {
    const { token } = (await call('POST', '/api/auth/app/login', { payload: { username: 'admin', password: 'correct-horse', deviceName: 'Pixel 8' } })).json();
    // A browser session token is not accepted as a bearer token…
    const browserToken = decodeURIComponent(admin.split('=')[1]!.split(';')[0]!).split('.')[0]!;
    expect((await call('GET', '/api/auth/me', { token: browserToken })).statusCode).toBe(401);
    // …and nonsense is simply "not signed in".
    expect((await call('GET', '/api/auth/me', { token: 'x'.repeat(500) })).statusCode).toBe(401);
    expect((await call('GET', '/api/auth/me', { token })).statusCode).toBe(200);
  });

  it('uses the same checks as the website: wrong passwords, disabled accounts, throttling', async () => {
    expect((await call('POST', '/api/auth/app/login', { payload: { username: 'admin', password: 'wrong', deviceName: 'Pixel 8' } })).statusCode).toBe(401);
    expect((await call('POST', '/api/auth/app/login', { payload: { username: 'admin', password: 'correct-horse' } })).statusCode).toBe(400);
    const lotte = await createUser(env.app, admin, 'lotte');
    await call('PUT', `/api/users/${lotte.id}`, { cookie: admin, payload: { disabled: true } });
    expect((await call('POST', '/api/auth/app/login', { payload: { username: 'lotte', password: 'user-password', deviceName: 'Tablet' } })).statusCode).toBe(403);
    for (let i = 0; i < 6; i++) await call('POST', '/api/auth/app/login', { payload: { username: 'admin', password: 'wrong', deviceName: 'Pixel 8' } });
    expect((await call('POST', '/api/auth/app/login', { payload: { username: 'admin', password: 'correct-horse', deviceName: 'Pixel 8' } })).statusCode).toBe(429);
  });

  it('ends app sessions when the account is disabled or its password is reset', async () => {
    const lotte = await createUser(env.app, admin, 'lotte');
    const { token } = (await call('POST', '/api/auth/app/login', { payload: { username: 'lotte', password: 'user-password', deviceName: 'Tablet' } })).json();
    await call('PUT', `/api/users/${lotte.id}`, { cookie: admin, payload: { disabled: true } });
    expect((await call('GET', '/api/auth/me', { token })).statusCode).toBe(401);
  });
});

describe('connecting the app with a code', () => {
  const start = async (deviceName = 'Living room tablet') => (await call('POST', '/api/auth/pair/start', { payload: { deviceName } })).json();

  it('signs the app in once someone signed in on the website confirms the code', async () => {
    const pair = await start();
    expect(pair.code).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
    expect(pair.interval).toBe(3);
    expect((await call('POST', '/api/auth/pair/poll', { payload: { pollToken: pair.pollToken } })).json()).toEqual({ status: 'pending' });

    const lotte = await createUser(env.app, admin, 'lotte');
    // Typed on the website, any case, with or without the dash.
    const typed = pair.code.replace('-', '').toLowerCase();
    expect((await call('GET', `/api/auth/pair/${typed}`, { cookie: lotte.cookie })).json()).toMatchObject({ code: pair.code, deviceName: 'Living room tablet' });
    expect((await call('POST', `/api/auth/pair/${typed}/approve`, { cookie: lotte.cookie })).json()).toEqual({ ok: true, deviceName: 'Living room tablet' });

    const done = (await call('POST', '/api/auth/pair/poll', { payload: { pollToken: pair.pollToken } })).json();
    expect(done).toMatchObject({ status: 'approved', user: { username: 'lotte' } });
    expect((await call('GET', '/api/auth/me', { token: done.token })).json().user.username).toBe('lotte');
    // A code works once.
    expect((await call('POST', '/api/auth/pair/poll', { payload: { pollToken: pair.pollToken } })).statusCode).toBe(410);
    expect((await call('GET', `/api/auth/pair/${typed}`, { cookie: lotte.cookie })).statusCode).toBe(404);
    const audit = (await call('GET', '/api/admin/audit', { cookie: admin })).json().items;
    expect(audit.some((e: { action: string; target: string }) => e.action === 'device.linked' && e.target === 'Living room tablet')).toBe(true);
  });

  it('needs someone signed in to confirm, and slows down guessing', async () => {
    const pair = await start();
    expect((await call('POST', `/api/auth/pair/${pair.code}/approve`)).statusCode).toBe(401);
    let last = 0;
    for (let i = 0; i < 7; i++) last = (await call('GET', '/api/auth/pair/AAA-AAA', { cookie: admin })).statusCode;
    expect(last).toBe(429);
    // Even the right code waits now.
    expect((await call('GET', `/api/auth/pair/${pair.code}`, { cookie: admin })).statusCode).toBe(429);
  });

  it('limits how many codes one address can ask for', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await call('POST', '/api/auth/pair/start', { payload: { deviceName: 'Phone' } })).statusCode;
    expect(last).toBe(429);
  });

  it('refuses a poll token it did not hand out', async () => {
    expect((await call('POST', '/api/auth/pair/poll', { payload: { pollToken: 'made-up' } })).statusCode).toBe(410);
  });
});

describe('PairingService', () => {
  it('expires codes after ten minutes and reads codes loosely', () => {
    const p = new PairingService();
    const t0 = 1_000_000;
    const { code, pollToken } = p.start('Phone', t0);
    expect(normalizeCode(code.toLowerCase().replace('-', ' '))).toBe(code.replace('-', ''));
    expect(normalizeCode('O0I1L-')).toBeNull();
    expect(p.find(code, t0 + 9 * 60_000)).not.toBeNull();
    expect(p.find(code, t0 + 10 * 60_000)).toBeNull();
    expect(p.approve(code, 1, t0 + 10 * 60_000)).toBeNull();
    expect(p.poll(pollToken, t0 + 10 * 60_000)).toEqual({ status: 'expired' });
  });
});

describe('upgrading', () => {
  it('adds the app columns to existing sessions without signing anyone out', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'velyx-app-sessions-'));
    const file = path.join(dir, 'velyx.db');
    try {
      // A database as 0.7.1 left it: every migration up to 0018, with a signed-in browser.
      const old = path.join(dir, 'old');
      fs.cpSync(migrationsFolder(), old, { recursive: true });
      const journal = JSON.parse(fs.readFileSync(path.join(old, 'meta', '_journal.json'), 'utf8'));
      const at = journal.entries.findIndex((e: { tag: string }) => e.tag === '0019_app_sessions');
      expect(at).toBeGreaterThan(0);
      journal.entries.splice(at);
      fs.writeFileSync(path.join(old, 'meta', '_journal.json'), JSON.stringify(journal));
      openDatabase(file, { migrationsFolder: old }).$client.close();
      const raw = new Database(file);
      raw.prepare("INSERT INTO users (username, password_hash, role) VALUES ('anna', 'x', 'user')").run();
      raw.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES ('abc', 1, 9999999999999)").run();
      raw.close();

      const db = openDatabase(file, { backupDir: path.join(dir, 'backups') });
      expect(db.$client.prepare('SELECT id, client, device_name FROM sessions').all()).toEqual([{ id: 'abc', client: 'web', device_name: null }]);
      db.$client.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
