import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProgressiveLimiter } from '../src/auth/rate-limit.js';
import { describeUserAgent } from '../src/auth/sessions.js';
import { parseTrustProxy } from '../src/config.js';
import { cookieFrom, createTestEnv, createUser, setupAdmin, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
beforeEach(async () => {
  env = await createTestEnv();
  admin = await setupAdmin(env.app);
});
afterEach(async () => {
  await env.cleanup();
});

const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0';
async function login(username: string, password: string, ua = FIREFOX) {
  return env.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'user-agent': ua }, payload: { username, password } });
}

describe('session management', () => {
  it('lists and revokes your own sessions without exposing tokens', async () => {
    const bob = await createUser(env.app, admin, 'bob', 'bob-password-1');
    const second = cookieFrom(await login('bob', 'bob-password-1'));
    const res = await env.app.inject({ url: '/api/account/sessions', headers: { cookie: second } });
    const list = res.json() as Array<{ id: string; device: string; current: boolean; ip: string }>;
    expect(list).toHaveLength(2);
    expect(list.filter((s) => s.current)).toHaveLength(1);
    expect(list.find((s) => s.current)!.device).toBe('Firefox on Windows');
    // Neither the cookie token nor the stored key appears anywhere in the response.
    const token = decodeURIComponent(second.split('=')[1]!).split('.')[0]!;
    const stored = env.ctx.db.$client.prepare('SELECT id FROM sessions').all() as { id: string }[];
    for (const secret of [token, ...stored.map((s) => s.id)]) expect(res.body).not.toContain(secret);

    const other = list.find((s) => !s.current)!;
    expect((await env.app.inject({ method: 'DELETE', url: `/api/account/sessions/${other.id}`, headers: { cookie: second } })).statusCode).toBe(200);
    expect((await env.app.inject({ url: '/api/auth/me', headers: { cookie: bob.cookie } })).statusCode).toBe(401);
    expect((await env.app.inject({ url: '/api/auth/me', headers: { cookie: second } })).statusCode).toBe(200);
    expect((await env.app.inject({ method: 'DELETE', url: `/api/account/sessions/${other.id}`, headers: { cookie: second } })).statusCode).toBe(404);
    expect((await env.app.inject({ method: 'DELETE', url: '/api/account/sessions/not-an-id', headers: { cookie: second } })).statusCode).toBe(400);
  });

  it('lets admins view and revoke other users’ sessions; users cannot', async () => {
    const bob = await createUser(env.app, admin, 'bob', 'bob-password-1');
    const eve = await createUser(env.app, admin, 'eve', 'eve-password-1');
    expect((await env.app.inject({ url: `/api/users/${bob.id}/sessions`, headers: { cookie: eve.cookie } })).statusCode).toBe(403);
    const list = (await env.app.inject({ url: `/api/users/${bob.id}/sessions`, headers: { cookie: admin } })).json();
    expect(list).toHaveLength(1);
    expect((await env.app.inject({ method: 'DELETE', url: `/api/users/${bob.id}/sessions/${list[0].id}`, headers: { cookie: eve.cookie } })).statusCode).toBe(403);
    // A session id of one user cannot be used to revoke through another user.
    expect((await env.app.inject({ method: 'DELETE', url: `/api/users/${eve.id}/sessions/${list[0].id}`, headers: { cookie: admin } })).statusCode).toBe(404);
    expect((await env.app.inject({ method: 'DELETE', url: `/api/users/${bob.id}/sessions`, headers: { cookie: admin } })).json()).toEqual({ ok: true, revoked: 1 });
    expect((await env.app.inject({ url: '/api/auth/me', headers: { cookie: bob.cookie } })).statusCode).toBe(401);
  });

  it('asks whether to sign out other devices when changing the password', async () => {
    const bob = await createUser(env.app, admin, 'bob', 'bob-password-1');
    const other = cookieFrom(await login('bob', 'bob-password-1'));
    let res = await env.app.inject({ method: 'POST', url: '/api/account/password', headers: { cookie: bob.cookie }, payload: { currentPassword: 'bob-password-1', newPassword: 'bob-password-2', signOutOthers: false } });
    expect(res.json()).toEqual({ ok: true, signedOut: 0 });
    expect((await env.app.inject({ url: '/api/auth/me', headers: { cookie: other } })).statusCode).toBe(200);
    res = await env.app.inject({ method: 'POST', url: '/api/account/password', headers: { cookie: bob.cookie }, payload: { currentPassword: 'bob-password-2', newPassword: 'bob-password-3' } });
    expect(res.json()).toEqual({ ok: true, signedOut: 1 });
    expect((await env.app.inject({ url: '/api/auth/me', headers: { cookie: other } })).statusCode).toBe(401);
  });
});

describe('sign-in throttling', () => {
  it('delays progressively and never locks permanently', () => {
    let now = 0;
    const l = new ProgressiveLimiter({}, () => now);
    const k = ['ip:1', 'user:bob'];
    for (let i = 0; i < 4; i++) expect(l.fail(k)).toBe(0);
    expect(l.fail(k)).toBe(30_000);
    expect(l.retryAfter(['user:bob'])).toBe(30_000);
    expect(l.retryAfter(['ip:2', 'user:alice'])).toBe(0);
    expect(l.fail(k)).toBe(60_000);
    expect(l.fail(k)).toBe(120_000);
    for (let i = 0; i < 10; i++) l.fail(k);
    expect(l.retryAfter(k)).toBe(15 * 60_000);
    now += 15 * 60_000;
    expect(l.retryAfter(k)).toBe(0);
    // Forgotten after an hour without failures.
    now += 60 * 60_000 + 1;
    expect(l.fail(k)).toBe(0);
    l.reset(k);
    expect(l.retryAfter(k)).toBe(0);
  });

  it('throttles the API after five failures with Retry-After', async () => {
    await createUser(env.app, admin, 'bob', 'bob-password-1');
    for (let i = 0; i < 5; i++) expect((await login('bob', 'wrong-password')).statusCode).toBe(401);
    const blocked = await login('bob', 'bob-password-1');
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.json().error).toMatch(/Try again in \d+ seconds/);
  });

  it('parses TRUST_PROXY as boolean, hop count or address list', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('172.16.0.0/12, 10.0.0.1')).toEqual(['172.16.0.0/12', '10.0.0.1']);
  });

  it('with a hop count, a client cannot spoof its address', async () => {
    // Fastify reads trustProxy at build time; build a fresh app with the setting.
    const { buildApp } = await import('../src/app.js');
    const env3 = await createTestEnv();
    env3.ctx.config.trustProxy = 1;
    const app = await buildApp(env3.ctx);
    app.get('/whoami', async (req) => ({ ip: req.ip }));
    const res = await app.inject({ url: '/whoami', remoteAddress: '10.0.0.5', headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' } });
    expect(res.json().ip).toBe('203.0.113.7');
    await app.close();
    await env3.cleanup();
  });

  it('describes devices', () => {
    expect(describeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari on iOS');
    expect(describeUserAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36')).toBe('Chrome on Android');
    expect(describeUserAgent(null)).toBe('Unknown device');
  });
});

describe('audit log', () => {
  it('records admin and security actions without secrets', async () => {
    await login('admin', 'nope-nope-nope');
    await login('admin', 'correct-horse');
    const bob = await createUser(env.app, admin, 'bob', 'bob-password-1');
    await env.app.inject({ method: 'PUT', url: `/api/users/${bob.id}`, headers: { cookie: admin }, payload: { role: 'admin', password: 'bob-password-new' } });
    env.ctx.tmdb.validateKey = async () => true;
    await env.app.inject({ method: 'PUT', url: '/api/admin/settings', headers: { cookie: admin }, payload: { tmdbApiKey: 'abcdef0123456789abcdef0123456789', serverName: 'Thuis' } });
    await env.app.inject({ method: 'DELETE', url: `/api/users/${bob.id}`, headers: { cookie: admin } });

    const res = await env.app.inject({ url: '/api/admin/audit?limit=100', headers: { cookie: admin } });
    const actions = res.json().items.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['setup.completed', 'login.failed', 'login.success', 'user.created', 'user.updated', 'user.password_reset', 'tmdb.updated', 'settings.updated', 'user.deleted']));
    const failed = res.json().items.find((e: { action: string }) => e.action === 'login.failed');
    expect(failed).toMatchObject({ actorName: 'admin', detail: 'wrong password' });
    const updated = res.json().items.find((e: { action: string }) => e.action === 'user.updated');
    expect(updated).toMatchObject({ target: 'bob', detail: 'role user → admin' });
    for (const secret of ['nope-nope-nope', 'correct-horse', 'bob-password', 'abcdef0123456789abcdef0123456789']) expect(res.body).not.toContain(secret);

    const onlyLogins = (await env.app.inject({ url: '/api/admin/audit?action=login.', headers: { cookie: admin } })).json();
    expect(onlyLogins.items.every((e: { action: string }) => e.action.startsWith('login.'))).toBe(true);
  });

  it('is admin-only and prunes old entries', async () => {
    const bob = await createUser(env.app, admin, 'bob', 'bob-password-1');
    expect((await env.app.inject({ url: '/api/admin/audit', headers: { cookie: bob.cookie } })).statusCode).toBe(403);
    env.ctx.db.$client.prepare("INSERT INTO audit_log (at, action) VALUES (1000, 'logout')").run();
    env.ctx.audit.prune();
    expect(env.ctx.db.$client.prepare('SELECT count(*) AS n FROM audit_log WHERE at = 1000').get()).toEqual({ n: 0 });
  });
});
