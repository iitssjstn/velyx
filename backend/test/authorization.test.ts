import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addLibrary, createTestEnv, createUser, setupAdmin, type TestEnv } from './helpers.js';

let env: TestEnv;
let admin: string;
beforeEach(async () => {
  env = await createTestEnv();
  admin = await setupAdmin(env.app);
});
afterEach(async () => {
  await env.cleanup();
});

const ADMIN_ROUTES: Array<[string, string]> = [
  ['GET', '/api/admin/dashboard'],
  ['GET', '/api/admin/logs'],
  ['GET', '/api/admin/settings'],
  ['PUT', '/api/admin/settings'],
  ['GET', '/api/admin/review'],
  ['GET', '/api/admin/backup'],
  ['GET', '/api/libraries'],
  ['POST', '/api/libraries'],
  ['POST', '/api/libraries/scan-all'],
  ['GET', '/api/users'],
  ['POST', '/api/users'],
  ['DELETE', '/api/users/1'],
];

describe('authorization', () => {
  it('regular users cannot reach admin routes', async () => {
    const user = await createUser(env.app, admin, 'viewer');
    for (const [method, url] of ADMIN_ROUTES) {
      const res = await env.app.inject({ method: method as 'GET', url, headers: { cookie: user.cookie }, payload: method === 'GET' ? undefined : {} });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('anonymous clients get 401 on every protected route', async () => {
    const urls = ['/api/home', '/api/movies', '/api/shows', '/api/search?q=a', '/api/progress', '/api/favorites', '/api/media/1/stream', '/api/images/w342/a.jpg', '/api/admin/dashboard'];
    for (const url of urls) expect((await env.app.inject({ url })).statusCode, url).toBe(401);
  });

  it('regular users can browse the library', async () => {
    const user = await createUser(env.app, admin, 'viewer');
    for (const url of ['/api/home', '/api/movies', '/api/shows', '/api/favorites', '/api/progress', '/api/search?q=x']) {
      expect((await env.app.inject({ url, headers: { cookie: user.cookie } })).statusCode, url).toBe(200);
    }
  });
});

describe('user management', () => {
  it('creates, updates, resets and deletes users', async () => {
    const bob = await createUser(env.app, admin, 'bob');
    const dupe = await env.app.inject({ method: 'POST', url: '/api/users', headers: { cookie: admin }, payload: { username: 'bob', password: 'whatever-123' } });
    expect(dupe.statusCode).toBe(409);
    const promote = await env.app.inject({ method: 'PUT', url: `/api/users/${bob.id}`, headers: { cookie: admin }, payload: { role: 'admin', displayName: 'Bobby' } });
    expect(promote.json()).toMatchObject({ role: 'admin', displayName: 'Bobby' });
    const reset = await env.app.inject({ method: 'PUT', url: `/api/users/${bob.id}`, headers: { cookie: admin }, payload: { password: 'reset-password' } });
    expect(reset.statusCode).toBe(200);
    // old session ended, new password works
    expect((await env.app.inject({ url: '/api/auth/me', headers: { cookie: bob.cookie } })).statusCode).toBe(401);
    expect((await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'bob', password: 'reset-password' } })).statusCode).toBe(200);
    const del = await env.app.inject({ method: 'DELETE', url: `/api/users/${bob.id}`, headers: { cookie: admin } });
    expect(del.statusCode).toBe(200);
    expect((await env.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'bob', password: 'reset-password' } })).statusCode).toBe(401);
  });

  it('protects the last administrator', async () => {
    const me = (await env.app.inject({ url: '/api/auth/me', headers: { cookie: admin } })).json().user.id;
    const demote = await env.app.inject({ method: 'PUT', url: `/api/users/${me}`, headers: { cookie: admin }, payload: { role: 'user' } });
    expect(demote.statusCode).toBe(400);
    const disable = await env.app.inject({ method: 'PUT', url: `/api/users/${me}`, headers: { cookie: admin }, payload: { disabled: true } });
    expect(disable.statusCode).toBe(400);
    const del = await env.app.inject({ method: 'DELETE', url: `/api/users/${me}`, headers: { cookie: admin } });
    expect(del.statusCode).toBe(400);
  });

  it('allows demoting another admin while one active admin remains', async () => {
    const other = await createUser(env.app, admin, 'second', 'second-password', 'admin');
    const res = await env.app.inject({ method: 'PUT', url: `/api/users/${other.id}`, headers: { cookie: admin }, payload: { role: 'user' } });
    expect(res.statusCode).toBe(200);
    // the second admin cannot demote the first one if that leaves zero admins
    const promoted = await createUser(env.app, admin, 'third', 'third-password', 'admin');
    const me = (await env.app.inject({ url: '/api/auth/me', headers: { cookie: admin } })).json().user.id;
    const res2 = await env.app.inject({ method: 'PUT', url: `/api/users/${me}`, headers: { cookie: promoted.cookie }, payload: { role: 'user' } });
    expect(res2.statusCode).toBe(200);
    const self = await env.app.inject({ method: 'PUT', url: `/api/users/${promoted.id}`, headers: { cookie: promoted.cookie }, payload: { role: 'user' } });
    expect(self.statusCode).toBe(400);
  });
});

describe('library management', () => {
  it('rejects paths outside MEDIA_ROOTS and relative paths', async () => {
    for (const p of ['/etc', 'movies', '/tmp/../etc', `${env.mediaDir}/../`]) {
      const res = await env.app.inject({ method: 'POST', url: '/api/libraries', headers: { cookie: admin }, payload: { name: 'x', type: 'movies', path: p } });
      expect(res.statusCode, p).toBe(400);
    }
  });

  it('rejects overlapping libraries and supports edit/delete', async () => {
    const lib = await addLibrary(env, admin, 'movies', 'movies');
    const overlap = await env.app.inject({ method: 'POST', url: '/api/libraries', headers: { cookie: admin }, payload: { name: 'y', type: 'movies', path: lib.path } });
    expect(overlap.statusCode).toBe(409);
    const rename = await env.app.inject({ method: 'PUT', url: `/api/libraries/${lib.id}`, headers: { cookie: admin }, payload: { name: 'Films' } });
    expect(rename.json().name).toBe('Films');
    const list = await env.app.inject({ url: '/api/libraries', headers: { cookie: admin } });
    expect(list.json().libraries).toHaveLength(1);
    expect(list.json().libraries[0]).toMatchObject({ available: true, type: 'movies' });
    const del = await env.app.inject({ method: 'DELETE', url: `/api/libraries/${lib.id}`, headers: { cookie: admin } });
    expect(del.statusCode).toBe(200);
  });

  it('shows the application version on the dashboard', async () => {
    const res = await env.app.inject({ url: '/api/admin/dashboard', headers: { cookie: admin } });
    expect(res.json()).toMatchObject({ version: '0.4.3', counts: { movies: 0, shows: 0, users: 1 } });
  });

  it('never returns the TMDB key from the settings API', async () => {
    env.ctx.settings.update({ tmdbApiKey: 'abcdef0123456789abcdef0123456789' });
    const res = await env.app.inject({ url: '/api/admin/settings', headers: { cookie: admin } });
    expect(res.body).not.toContain('abcdef0123456789abcdef0123456789');
    expect(res.json().tmdb).toMatchObject({ configured: true, hint: '••••6789' });
  });
});
