import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildCloudApp, SESSION_COOKIE } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db/client.js';
import { memberships } from '../src/db/schema.js';
import { createTestEnv, createUser, setupAdmin, type TestEnv } from '../../backend/test/helpers.js';
import type {} from '../../backend/src/app.js';

// A real account service and a real Vidalune server, talking to each other in-process.
let dir: string;
let db: DB;
let cloud: FastifyInstance;
let env: TestEnv;
let admin: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-cloud-'));
  const config = loadConfig({ DATA_DIR: dir, PUBLIC_URL: 'https://vidalune.com' }, { webDir: null });
  db = openDatabase(config.dbPath);
  cloud = await buildCloudApp(config, db);
  env = await createTestEnv({
    fetchImpl: async (url, init) => {
      const res = await cloud.inject({ method: (init?.method ?? 'GET') as 'GET', url: new URL(url).pathname, headers: init?.headers as Record<string, string>, payload: init?.body as string | undefined });
      return new Response(res.body, { status: res.statusCode, headers: { 'content-type': 'application/json' } });
    },
  });
  admin = await setupAdmin(env.app, 'justin');
});
afterEach(async () => {
  env.ctx.cloud.shutdown();
  await env.cleanup();
  await cloud.close();
  db.$client.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function account(email: string) {
  const res = await cloud.inject({ method: 'POST', url: '/api/account', payload: { email, password: 'correct-horse' } });
  return `${SESSION_COOKIE}=${res.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
}
const serverId = () => env.ctx.settings.get().cloud!.serverId;
const ticketFor = async (cookie: string) => (await cloud.inject({ method: 'POST', url: `/api/servers/${serverId()}/open`, headers: { cookie } })).json().ticket as string;
const sso = (ticket: string) => env.app.inject({ url: `/sso?ticket=${encodeURIComponent(ticket)}` });
const me = (cookie: string) => env.app.inject({ url: '/api/auth/me', headers: { cookie } });

describe('signing in with a Vidalune account', () => {
  it('signs in the administrator who linked the server, without a password, once per ticket', async () => {
    const { code } = (await env.app.inject({ method: 'POST', url: '/api/admin/cloud/link', headers: { cookie: admin } })).json().code;
    const owner = await account('justin@example.com');
    await cloud.inject({ method: 'POST', url: '/api/link', headers: { cookie: owner }, payload: { code } });
    await env.app.inject({ method: 'POST', url: '/api/admin/cloud/check', headers: { cookie: admin } });
    expect((await env.app.inject({ url: '/api/server/info' })).json().vidalune).toEqual({ appUrl: 'https://app.vidalune.com' });

    const ticket = await ticketFor(owner);
    const res = await sso(ticket);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
    const cookie = res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    expect((await me(cookie)).json().user.username).toBe('justin');
    // Used up.
    expect((await sso(ticket)).headers.location).toBe('/login?vidalune=failed');
    expect((await sso('not-a-ticket-at-all-xxxxxxxx')).headers.location).toBe('/login?vidalune=failed');
  });

  it('lets another user connect their own account, then sign in from the app; unlinking stops it', async () => {
    const { code } = (await env.app.inject({ method: 'POST', url: '/api/admin/cloud/link', headers: { cookie: admin } })).json().code;
    await cloud.inject({ method: 'POST', url: '/api/link', headers: { cookie: await account('justin@example.com') }, payload: { code } });
    await env.app.inject({ method: 'POST', url: '/api/admin/cloud/check', headers: { cookie: admin } });

    const family = await createUser(env.app, admin, 'lisa');
    expect((await env.app.inject({ url: '/api/account/cloud', headers: { cookie: family.cookie } })).json()).toMatchObject({ available: true, email: null, appUrl: 'https://app.vidalune.com' });
    const issued = (await env.app.inject({ method: 'POST', url: '/api/account/cloud/link', headers: { cookie: family.cookie } })).json();
    expect(issued.linkUrl).toBe(`https://vidalune.com/join#${issued.code}`);
    const lisa = await account('lisa@example.com');
    // Before joining, Lisa's account does not see the server.
    expect((await cloud.inject({ method: 'POST', url: `/api/servers/${serverId()}/open`, headers: { cookie: lisa } })).statusCode).toBe(404);
    await cloud.inject({ method: 'POST', url: '/api/join', headers: { cookie: lisa }, payload: { code: issued.code } });
    expect((await env.app.inject({ url: '/api/account/cloud', headers: { cookie: family.cookie } })).json().email).toBe('lisa@example.com');

    const app = await env.app.inject({ method: 'POST', url: '/api/auth/app/ticket', payload: { ticket: await ticketFor(lisa), deviceName: 'Pixel 8' } });
    expect(app.statusCode).toBe(200);
    expect(app.json()).toMatchObject({ token: expect.any(String), user: { username: 'lisa' } });

    await env.app.inject({ method: 'POST', url: '/api/account/cloud/unlink', headers: { cookie: family.cookie } });
    // Lisa no longer sees the server, so she cannot even get a ticket.
    expect((await cloud.inject({ method: 'POST', url: `/api/servers/${serverId()}/open`, headers: { cookie: lisa } })).statusCode).toBe(404);
  });

  it('does not sign in a disabled user', async () => {
    const { code } = (await env.app.inject({ method: 'POST', url: '/api/admin/cloud/link', headers: { cookie: admin } })).json().code;
    await cloud.inject({ method: 'POST', url: '/api/link', headers: { cookie: await account('justin@example.com') }, payload: { code } });
    await env.app.inject({ method: 'POST', url: '/api/admin/cloud/check', headers: { cookie: admin } });
    const family = await createUser(env.app, admin, 'lisa');
    const issued = (await env.app.inject({ method: 'POST', url: '/api/account/cloud/link', headers: { cookie: family.cookie } })).json();
    const lisa = await account('lisa@example.com');
    await cloud.inject({ method: 'POST', url: '/api/join', headers: { cookie: lisa }, payload: { code: issued.code } });
    expect((await env.app.inject({ method: 'PUT', url: `/api/users/${family.id}`, headers: { cookie: admin }, payload: { disabled: true } })).statusCode).toBe(200);
    expect((await sso(await ticketFor(lisa))).headers.location).toBe('/login?vidalune=unknown');
  });

  it('signs the owner in as the administrator also when their account knew no user here, and connects it', async () => {
    const { code } = (await env.app.inject({ method: 'POST', url: '/api/admin/cloud/link', headers: { cookie: admin } })).json().code;
    const owner = await account('justin@example.com');
    await cloud.inject({ method: 'POST', url: '/api/link', headers: { cookie: owner }, payload: { code } });
    await env.app.inject({ method: 'POST', url: '/api/admin/cloud/check', headers: { cookie: admin } });
    // As for servers linked before accounts knew their users: the owner's account knows no user here.
    db.delete(memberships).run();
    // No second sign-in: the owner is the administrator, in the browser and in the app…
    const res = await sso(await ticketFor(owner));
    expect(res.headers.location).toBe('/');
    expect((await me(res.cookies.map((c) => `${c.name}=${c.value}`).join('; '))).json().user.username).toBe('justin');
    const app = await env.app.inject({ method: 'POST', url: '/api/auth/app/ticket', payload: { ticket: await ticketFor(owner), deviceName: 'Pixel 8' } });
    expect(app.json()).toMatchObject({ user: { username: 'justin', role: 'admin' } });
    // …and connected for good.
    expect(db.select().from(memberships).all()).toMatchObject([{ userRef: '1' }]);
  });

  it('never signs someone else in as the administrator', async () => {
    const { code } = (await env.app.inject({ method: 'POST', url: '/api/admin/cloud/link', headers: { cookie: admin } })).json().code;
    await cloud.inject({ method: 'POST', url: '/api/link', headers: { cookie: await account('justin@example.com') }, payload: { code } });
    await env.app.inject({ method: 'POST', url: '/api/admin/cloud/check', headers: { cookie: admin } });
    const family = await createUser(env.app, admin, 'lisa');
    const issued = (await env.app.inject({ method: 'POST', url: '/api/account/cloud/link', headers: { cookie: family.cookie } })).json();
    const lisa = await account('lisa@example.com');
    await cloud.inject({ method: 'POST', url: '/api/join', headers: { cookie: lisa }, payload: { code: issued.code } });
    // Lisa's user was removed here: she is told to ask for a new invitation — not signed in as anyone else.
    await env.app.inject({ method: 'DELETE', url: `/api/users/${family.id}`, headers: { cookie: admin } });
    const app = await env.app.inject({ method: 'POST', url: '/api/auth/app/ticket', payload: { ticket: await ticketFor(lisa), deviceName: 'Pixel 8' } });
    expect(app.statusCode).toBe(403);
    expect(app.json().error).toMatch(/invite you again/);
    expect((await sso(await ticketFor(lisa))).headers.location).toBe('/login?vidalune=unknown');
  });

  it('connects a user after one sign-in by password, so the Vidalune account alone is enough from then on', async () => {
    const { code } = (await env.app.inject({ method: 'POST', url: '/api/admin/cloud/link', headers: { cookie: admin } })).json().code;
    const owner = await account('justin@example.com');
    await cloud.inject({ method: 'POST', url: '/api/link', headers: { cookie: owner }, payload: { code } });
    await env.app.inject({ method: 'POST', url: '/api/admin/cloud/check', headers: { cookie: admin } });
    db.delete(memberships).run();

    // Connected by hand (Settings → Vidalune account, or after a password sign-in) with a fresh ticket.
    const claim = await env.app.inject({ method: 'POST', url: '/api/account/cloud/claim', headers: { cookie: admin }, payload: { ticket: await ticketFor(owner) } });
    expect(claim.statusCode).toBe(200);
    expect(claim.json().email).toBe('justin@example.com');
    const res = await sso(await ticketFor(owner));
    expect(res.headers.location).toBe('/');
    const cookie = res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    expect((await me(cookie)).json().user.username).toBe('justin');
    // A ticket works once.
    const used = await ticketFor(owner);
    await env.app.inject({ method: 'POST', url: '/api/account/cloud/claim', headers: { cookie: admin }, payload: { ticket: used } });
    expect((await env.app.inject({ method: 'POST', url: '/api/account/cloud/claim', headers: { cookie: admin }, payload: { ticket: used } })).statusCode).toBe(401);
  });
});
