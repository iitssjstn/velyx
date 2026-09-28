import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildCloudApp, ONLINE_WINDOW, SESSION_COOKIE } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db/client.js';
import { accountSessions, accounts, linkCodes, servers } from '../src/db/schema.js';
import { newLinkCode, normalizeLinkCode } from '../src/crypto.js';

let dir: string;
let db: DB;
let app: FastifyInstance;
let clock: number;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-cloud-'));
  const config = loadConfig({ DATA_DIR: dir, PUBLIC_URL: 'https://vidalune.example', ADMIN_EMAILS: 'Boss@Example.com, other@example.com' }, { webDir: null, frontendDir: null });
  db = openDatabase(config.dbPath);
  clock = Date.now();
  app = await buildCloudApp(config, db, { now: () => clock });
});
afterEach(async () => {
  await app.close();
  db.$client.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const cookieOf = (res: { cookies: Array<{ name: string; value: string }> }) => `${SESSION_COOKIE}=${res.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
async function signUp(email = 'justin@example.com', password = 'correct-horse') {
  const res = await app.inject({ method: 'POST', url: '/api/account', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return cookieOf(res);
}
async function register(name = 'Thuis') {
  const res = await app.inject({ method: 'POST', url: '/api/server/register', payload: { name, version: '0.10.1', url: null } });
  expect(res.statusCode).toBe(200);
  const { id, secret } = res.json();
  return { id, auth: `Server ${id}:${secret}` };
}

describe('link codes', () => {
  it('are easy to read and accept what people type', () => {
    const code = newLinkCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(normalizeLinkCode(code.toLowerCase().replace('-', ' '))).toBe(code);
    expect(normalizeLinkCode('abc')).toBe('');
  });
});

describe('accounts', () => {
  it('signs up, signs in and out; passwords and tokens are stored as hashes only', async () => {
    const cookie = await signUp('Justin@Example.com');
    expect((await app.inject({ url: '/api/account', headers: { cookie } })).json()).toEqual({ email: 'justin@example.com', remote: { active: false, until: null }, appUrl: null });
    const stored = db.select().from(accounts).get()!;
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    expect(db.select().from(accountSessions).get()!.tokenHash).not.toBe(cookie.split('=')[1]);

    expect((await app.inject({ method: 'POST', url: '/api/account', payload: { email: 'justin@example.com', password: 'another-one' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/login', payload: { email: 'justin@example.com', password: 'wrong-password' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/login', payload: { email: 'nobody@example.com', password: 'wrong-password' } })).statusCode).toBe(401);
    const again = await app.inject({ method: 'POST', url: '/api/login', payload: { email: 'justin@example.com', password: 'correct-horse' } });
    expect(again.statusCode).toBe(200);

    await app.inject({ method: 'POST', url: '/api/logout', headers: { cookie } });
    expect((await app.inject({ url: '/api/account', headers: { cookie } })).statusCode).toBe(401);
  });

  it('gives the app a token instead of a cookie, which works until signing out', async () => {
    await signUp();
    const res = await app.inject({ method: 'POST', url: '/api/login', payload: { email: 'justin@example.com', password: 'correct-horse', client: 'app' } });
    expect(res.cookies).toEqual([]);
    const { token } = res.json();
    expect(token).toMatch(/^[\w-]{40,}$/);
    const authorization = `Bearer ${token}`;
    expect((await app.inject({ url: '/api/servers', headers: { authorization } })).json()).toEqual([]);
    // Still signed in after five months; a browser session would have ended.
    clock += 150 * 86_400_000;
    expect((await app.inject({ url: '/api/account', headers: { authorization } })).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/api/logout', headers: { authorization } });
    expect((await app.inject({ url: '/api/account', headers: { authorization } })).statusCode).toBe(401);
    // Creating an account from the app signs in the same way.
    const made = await app.inject({ method: 'POST', url: '/api/account', payload: { email: 'app@example.com', password: 'correct-horse', client: 'app' } });
    expect(made.json()).toMatchObject({ email: 'app@example.com', token: expect.any(String) });
  });

  it('validates input and refuses requests from other sites', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/account', payload: { email: 'not-an-address', password: 'correct-horse' } })).json().error).toMatch(/valid email/);
    expect((await app.inject({ method: 'POST', url: '/api/account', payload: { email: 'a@example.com', password: 'short' } })).statusCode).toBe(400);
    const cross = await app.inject({ method: 'POST', url: '/api/account', headers: { origin: 'https://evil.example' }, payload: { email: 'a@example.com', password: 'correct-horse' } });
    expect(cross.statusCode).toBe(403);
    // A relay address is someone's server, not this service.
    const relayed = await app.inject({ method: 'POST', url: '/api/account', headers: { origin: 'https://k7f3q9ma.vidalune.example' }, payload: { email: 'a@example.com', password: 'correct-horse' } });
    expect(relayed.statusCode).toBe(403);
    // app. and www. serve the same pages.
    for (const origin of ['https://vidalune.example', 'https://app.vidalune.example', 'https://www.vidalune.example']) {
      const res = await app.inject({ method: 'POST', url: '/api/login', headers: { origin }, payload: { email: 'nobody@example.com', password: 'wrong-password' } });
      expect(res.statusCode, origin).toBe(401);
    }
    const form = await app.inject({ method: 'POST', url: '/api/login', headers: { 'content-type': 'text/plain' }, payload: 'email=a@example.com' });
    expect(form.statusCode).toBe(415);
  });

  it('slows down guessing', async () => {
    await signUp();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await app.inject({ method: 'POST', url: '/api/login', payload: { email: 'justin@example.com', password: `wrong-${i}-password` } })).statusCode);
    expect(codes).toContain(429);
  });

  it('deletes an account after the password, unlinking its servers', async () => {
    const cookie = await signUp();
    const s = await register();
    const { code } = (await app.inject({ method: 'POST', url: '/api/server/code', headers: { authorization: s.auth } })).json();
    await app.inject({ method: 'POST', url: '/api/link', headers: { cookie }, payload: { code } });
    expect((await app.inject({ method: 'DELETE', url: '/api/account', headers: { cookie }, payload: { password: 'wrong-password' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/api/account', headers: { cookie }, payload: { password: 'correct-horse' } })).statusCode).toBe(200);
    expect(db.select().from(accounts).all()).toEqual([]);
    expect(db.select().from(servers).get()!.accountId).toBeNull();
    expect((await app.inject({ method: 'POST', url: '/api/server/heartbeat', headers: { authorization: s.auth }, payload: { name: 'Thuis', version: '0.10.1' } })).json()).toMatchObject({ linked: false, account: null });
  });
});

describe('linking a server', () => {
  it('links with the code the server shows, once, within ten minutes', async () => {
    const cookie = await signUp();
    const s = await register();
    const heartbeat = () => app.inject({ method: 'POST', url: '/api/server/heartbeat', headers: { authorization: s.auth }, payload: { name: 'Thuis', version: '0.10.1', url: 'https://media.example.com' } });
    expect((await heartbeat()).json()).toMatchObject({ linked: false, account: null });

    const issued = (await app.inject({ method: 'POST', url: '/api/server/code', headers: { authorization: s.auth } })).json();
    expect(issued).toMatchObject({ code: expect.any(String), linkUrl: 'https://vidalune.example/link' });
    expect(db.select().from(linkCodes).get()!.codeHash).not.toBe(issued.code);

    const linked = await app.inject({ method: 'POST', url: '/api/link', headers: { cookie }, payload: { code: issued.code.toLowerCase() } });
    expect(linked.json()).toMatchObject({ id: s.id, name: 'Thuis', online: true });
    expect((await heartbeat()).json()).toMatchObject({ linked: true, account: 'justin@example.com', relay: { enabled: false, url: null, connected: false } });
    expect((await app.inject({ url: '/api/servers', headers: { cookie } })).json()).toMatchObject([{ id: s.id, name: 'Thuis', version: '0.10.1', url: 'https://media.example.com', online: true }]);
    // Used up.
    expect((await app.inject({ method: 'POST', url: '/api/link', headers: { cookie }, payload: { code: issued.code } })).statusCode).toBe(400);

    // Expired codes do not work.
    const other = await signUp('someone@example.com');
    const late = (await app.inject({ method: 'POST', url: '/api/server/code', headers: { authorization: s.auth } })).json();
    clock += 11 * 60_000;
    expect((await app.inject({ method: 'POST', url: '/api/link', headers: { cookie: other }, payload: { code: late.code } })).statusCode).toBe(400);
  });

  it('shows a server that stopped reporting as offline, and lets the owner unlink it', async () => {
    const cookie = await signUp();
    const s = await register();
    const { code } = (await app.inject({ method: 'POST', url: '/api/server/code', headers: { authorization: s.auth } })).json();
    await app.inject({ method: 'POST', url: '/api/link', headers: { cookie }, payload: { code } });
    clock += ONLINE_WINDOW + 1;
    expect((await app.inject({ url: '/api/servers', headers: { cookie } })).json()[0].online).toBe(false);
    // Someone else cannot unlink it.
    const other = await signUp('someone@example.com');
    expect((await app.inject({ method: 'DELETE', url: `/api/servers/${s.id}`, headers: { cookie: other } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/servers/${s.id}`, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/servers', headers: { cookie } })).json()).toEqual([]);
  });

  it('only answers a server that proves who it is, and forgets it on request', async () => {
    const s = await register();
    const [id] = s.auth.slice('Server '.length).split(':');
    for (const authorization of [`Server ${id}:${'x'.repeat(43)}`, 'Bearer nonsense', `Server nobody:${'y'.repeat(43)}`]) {
      expect((await app.inject({ method: 'POST', url: '/api/server/code', headers: { authorization } })).statusCode).toBe(401);
    }
    expect((await app.inject({ method: 'POST', url: '/api/server/register', payload: { name: 'Thuis', version: '1', url: 'javascript:alert(1)' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: '/api/server', headers: { authorization: s.auth } })).statusCode).toBe(200);
    expect(db.select().from(servers).all()).toEqual([]);
  });

  it('forgets expired sessions and codes, and servers never linked that went quiet', async () => {
    await signUp();
    const s = await register();
    await app.inject({ method: 'POST', url: '/api/server/code', headers: { authorization: s.auth } });
    clock += 31 * 86_400_000;
    app.prune();
    expect(db.select().from(accountSessions).all()).toEqual([]);
    expect(db.select().from(linkCodes).all()).toEqual([]);
    expect(db.select().from(servers).all()).toEqual([]);
  });
});

describe('remote access and the admin page', () => {
  it('only administrators (ADMIN_EMAILS) see accounts and give remote access', async () => {
    const user = await signUp('justin@example.com');
    const boss = await signUp('boss@example.com');
    expect((await app.inject({ url: '/api/account', headers: { cookie: boss } })).json()).toEqual({ email: 'boss@example.com', remote: { active: true, until: null }, appUrl: null, admin: true });
    expect((await app.inject({ url: '/api/admin/accounts', headers: { cookie: user } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/admin/accounts' })).statusCode).toBe(401);
    const id = db.select().from(accounts).where(eq(accounts.email, 'justin@example.com')).get()!.id;
    expect((await app.inject({ method: 'PUT', url: `/api/admin/accounts/${id}/plan`, headers: { cookie: user }, payload: { plan: 'remote' } })).statusCode).toBe(403);

    const list = (await app.inject({ url: '/api/admin/accounts?q=JUSTIN', headers: { cookie: boss } })).json();
    expect(list.stats).toMatchObject({ accounts: 2, remote: 1 });
    expect(list.accounts.map((a: { email: string }) => a.email)).toEqual(['justin@example.com']);

    // Until a date: active until then, and gone after it.
    expect((await app.inject({ method: 'PUT', url: `/api/admin/accounts/${id}/plan`, headers: { cookie: boss }, payload: { plan: 'remote', until: clock - 1 } })).statusCode).toBe(400);
    const given = await app.inject({ method: 'PUT', url: `/api/admin/accounts/${id}/plan`, headers: { cookie: boss }, payload: { plan: 'remote', until: clock + 20 * 86_400_000, note: 'paid by bank transfer' } });
    expect(given.json()).toMatchObject({ plan: 'remote', remote: true, planNote: 'paid by bank transfer', planChangedAt: clock });
    expect((await app.inject({ url: '/api/account', headers: { cookie: user } })).json().remote).toEqual({ active: true, until: clock + 20 * 86_400_000 });
    expect((await app.inject({ url: '/api/admin/accounts?filter=remote', headers: { cookie: boss } })).json().accounts).toHaveLength(2);
    clock += 21 * 86_400_000;
    expect((await app.inject({ url: '/api/account', headers: { cookie: user } })).json().remote.active).toBe(false);

    const taken = await app.inject({ method: 'PUT', url: `/api/admin/accounts/${id}/plan`, headers: { cookie: boss }, payload: { plan: 'free' } });
    expect(taken.json()).toMatchObject({ plan: 'free', planUntil: null, remote: false });
    expect((await app.inject({ method: 'PUT', url: '/api/admin/accounts/9999/plan', headers: { cookie: boss }, payload: { plan: 'free' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PUT', url: `/api/admin/accounts/${id}/plan`, headers: { cookie: boss }, payload: { plan: 'gold' } })).statusCode).toBe(400);
  });

  it('keeps the relay off for servers whose owner has no remote access', async () => {
    const cookie = await signUp('justin@example.com');
    const s = await register();
    const { code } = (await app.inject({ method: 'POST', url: '/api/server/code', headers: { authorization: s.auth } })).json();
    await app.inject({ method: 'POST', url: '/api/link', headers: { cookie }, payload: { code } });
    const off = await app.inject({ method: 'POST', url: '/api/server/relay', headers: { authorization: s.auth }, payload: { enabled: true } });
    expect(off.statusCode).toBe(402);
    expect(off.json().error).toMatch(/subscription/);
    const beat = await app.inject({ method: 'POST', url: '/api/server/heartbeat', headers: { authorization: s.auth }, payload: { name: 'Thuis', version: '0.10.6' } });
    expect(beat.json().relay).toMatchObject({ enabled: false, allowed: false });
  });
});
