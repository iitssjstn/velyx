import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, createUser, cookieFrom, setupAdmin, type TestEnv } from './helpers.js';

let env: TestEnv;
beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(async () => {
  await env.cleanup();
});

describe('first-run setup', () => {
  it('reports that setup is required until an admin exists', async () => {
    const before = await env.app.inject({ url: '/api/server/info' });
    expect(before.json()).toMatchObject({ product: 'Velyx', version: '0.1.0', setupRequired: true });
    await setupAdmin(env.app);
    const after = await env.app.inject({ url: '/api/server/info' });
    expect(after.json().setupRequired).toBe(false);
  });

  it('validates username and password', async () => {
    const weak = await env.app.inject({ method: 'POST', url: '/api/setup', payload: { username: 'admin', password: '123' } });
    expect(weak.statusCode).toBe(400);
    const badName = await env.app.inject({ method: 'POST', url: '/api/setup', payload: { username: 'a b/c', password: 'long-enough-pw' } });
    expect(badName.statusCode).toBe(400);
  });

  it('cannot be run twice', async () => {
    await setupAdmin(env.app);
    const again = await env.app.inject({ method: 'POST', url: '/api/setup', payload: { username: 'evil', password: 'another-password' } });
    expect(again.statusCode).toBe(409);
  });

  it('stores the password as an Argon2id hash', async () => {
    await setupAdmin(env.app, 'admin', 'correct-horse');
    const row = env.ctx.db.$client.prepare('SELECT password_hash AS h FROM users').get() as { h: string };
    expect(row.h.startsWith('$argon2id$')).toBe(true);
    expect(row.h).not.toContain('correct-horse');
  });
});

describe('login / logout / sessions', () => {
  it('logs in with correct credentials and rejects wrong ones', async () => {
    await setupAdmin(env.app);
    const bad = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'nope' } });
    expect(bad.statusCode).toBe(401);
    const unknown = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ghost', password: 'nope' } });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().error).toBe(bad.json().error);
    const ok = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'correct-horse' } });
    expect(ok.statusCode).toBe(200);
    const cookie = ok.cookies.find((c) => c.name === 'velyx_session')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    const me = await env.app.inject({ url: '/api/auth/me', headers: { cookie: cookieFrom(ok) } });
    expect(me.json().user).toMatchObject({ username: 'admin', role: 'admin' });
  });

  it('never exposes the password hash', async () => {
    const cookie = await setupAdmin(env.app);
    for (const url of ['/api/auth/me', '/api/users']) {
      const res = await env.app.inject({ url, headers: { cookie } });
      expect(res.body).not.toMatch(/argon2|password/i);
    }
  });

  it('rejects requests without or with a forged session', async () => {
    await setupAdmin(env.app);
    expect((await env.app.inject({ url: '/api/auth/me' })).statusCode).toBe(401);
    expect((await env.app.inject({ url: '/api/auth/me', headers: { cookie: 'velyx_session=forged.value' } })).statusCode).toBe(401);
  });

  it('logout destroys the session', async () => {
    const cookie = await setupAdmin(env.app);
    const out = await env.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(200);
    expect((await env.app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('rate-limits repeated failed logins', async () => {
    await setupAdmin(env.app);
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'wrong' } })).statusCode;
    }
    expect(last).toBe(429);
  });

  it('disabled users cannot sign in and lose their sessions', async () => {
    const admin = await setupAdmin(env.app);
    const bob = await createUser(env.app, admin, 'bob');
    await env.app.inject({ method: 'PUT', url: `/api/users/${bob.id}`, headers: { cookie: admin }, payload: { disabled: true } });
    expect((await env.app.inject({ url: '/api/auth/me', headers: { cookie: bob.cookie } })).statusCode).toBe(401);
    const login = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'bob', password: 'user-password' } });
    expect(login.statusCode).toBe(403);
  });

  it('changing the password keeps the current session and ends the others', async () => {
    await setupAdmin(env.app);
    const a = cookieFrom(await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'correct-horse' } }));
    const b = cookieFrom(await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'correct-horse' } }));
    const wrong = await env.app.inject({ method: 'POST', url: '/api/account/password', headers: { cookie: a }, payload: { currentPassword: 'x', newPassword: 'brand-new-pass' } });
    expect(wrong.statusCode).toBe(400);
    const ok = await env.app.inject({ method: 'POST', url: '/api/account/password', headers: { cookie: a }, payload: { currentPassword: 'correct-horse', newPassword: 'brand-new-pass' } });
    expect(ok.statusCode).toBe(200);
    expect((await env.app.inject({ url: '/api/auth/me', headers: { cookie: a } })).statusCode).toBe(200);
    expect((await env.app.inject({ url: '/api/auth/me', headers: { cookie: b } })).statusCode).toBe(401);
    const relog = await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'brand-new-pass' } });
    expect(relog.statusCode).toBe(200);
  });

  it('updates the profile and validates avatar uploads', async () => {
    const cookie = await setupAdmin(env.app);
    const prof = await env.app.inject({ method: 'PUT', url: '/api/account/profile', headers: { cookie }, payload: { displayName: 'Justin' } });
    expect(prof.json().user.displayName).toBe('Justin');
    const fake = await env.app.inject({
      method: 'PUT',
      url: '/api/account/avatar',
      headers: { cookie },
      payload: { dataUrl: 'data:image/png;base64,' + Buffer.from('not an image').toString('base64') },
    });
    expect(fake.statusCode).toBe(400);
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const real = await env.app.inject({ method: 'PUT', url: '/api/account/avatar', headers: { cookie }, payload: { dataUrl: 'data:image/png;base64,' + png.toString('base64') } });
    expect(real.statusCode).toBe(200);
    const url = real.json().user.avatarUrl as string;
    const img = await env.app.inject({ url, headers: { cookie } });
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
  });
});

describe('CSRF protection', () => {
  it('rejects cross-origin state-changing requests', async () => {
    const cookie = await setupAdmin(env.app);
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie, origin: 'https://evil.example', host: 'velyx.local' },
    });
    expect(res.statusCode).toBe(403);
    expect((await env.app.inject({ url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(200);
  });

  it('accepts same-origin requests', async () => {
    const cookie = await setupAdmin(env.app);
    const res = await env.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, origin: 'http://velyx.local', host: 'velyx.local' } });
    expect(res.statusCode).toBe(200);
  });

  it('rejects form-encoded bodies', async () => {
    await setupAdmin(env.app);
    const res = await env.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'username=admin&password=correct-horse',
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
  });
});

describe('health and headers', () => {
  it('serves /health without auth', async () => {
    const res = await env.app.inject({ url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', name: 'Velyx' });
  });

  it('sends security headers', async () => {
    const res = await env.app.inject({ url: '/api/server/info' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });
});
