import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { addLibrary, createTestEnv, createUser, setupAdmin, type TestEnv } from './helpers.js';
import { adminNotifications, users } from '../src/db/schema.js';
import { usernameFor } from '../src/routes/invites.js';

// A stand-in for vidalune.com (the real one is tested in cloud/).
let linked: boolean;
let reachable: boolean;
/** Who the next ticket is for: the account's email and its user here. */
let ticketFor: { email: string; userRef: string };
/** Accepted invitations as vidalune.com lists them among the server's members. */
let members: Array<{ userRef: string; email: string }>;
let calls: Array<{ method: string; path: string; body: unknown }>;
const fakeService = async (url: string, init?: RequestInit) => {
  const path = new URL(url).pathname;
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  if (!reachable && path.startsWith('/api/server/invites')) throw new Error('offline');
  calls.push({ method, path, body });
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
  if (path === '/api/server/register') return json({ id: 'srv-1', secret: 'secret-secret-secret-secret' });
  if (path === '/api/server/code') return json({ code: 'K7F3-Q9MA', expiresAt: Date.now() + 600_000, linkUrl: 'https://vidalune.com/link' });
  if (path === '/api/server/heartbeat') return json({ linked, account: linked ? 'justin@example.com' : null, relay: { enabled: false, allowed: true, url: null } });
  if (path === '/api/server/invites' && method === 'POST') return json({ url: `https://vidalune.com/invite#token-for-${body.ref}`, expiresAt: Date.now() + 7 * 86_400_000 });
  if (path === '/api/server/ticket') return json(ticketFor);
  if (path === '/api/server/members') return json(members);
  return json({ ok: true });
};

let env: TestEnv;
let admin: string;
beforeEach(async () => {
  linked = false;
  reachable = true;
  members = [];
  calls = [];
  env = await createTestEnv({ fetchImpl: fakeService });
  admin = await setupAdmin(env.app, 'justin');
});
afterEach(async () => {
  env.ctx.cloud.shutdown();
  await env.cleanup();
});

const link = async () => {
  await env.app.inject({ method: 'POST', url: '/api/admin/cloud/link', headers: { cookie: admin } });
  linked = true;
  await env.app.inject({ method: 'POST', url: '/api/admin/cloud/check', headers: { cookie: admin } });
};
const invite = (payload: Record<string, unknown>, cookie = admin) => env.app.inject({ method: 'POST', url: '/api/admin/invites', headers: { cookie }, payload });
const open = () => env.app.inject({ url: '/sso?ticket=ticket-ticket-ticket-ticket' });

describe('usernames for invited people', () => {
  it('come from the email address, and are unique', () => {
    const taken = new Set(['lisa', 'lisa2']);
    expect(usernameFor('Lisa@example.com', (n) => taken.has(n))).toBe('lisa3');
    expect(usernameFor('lisa@example.com', (n) => taken.has(n) && n !== 'lisa2')).toBe('lisa2');
    expect(usernameFor('lisa@example.com', () => false)).toBe('lisa');
    expect(usernameFor('lisa+tv@example.com', (n) => n === 'lisatv')).toBe('lisatv2');
    expect(usernameFor('é@example.com', () => false)).toBe('user');
    expect(usernameFor('j@example.com', () => false)).toBe('juser');
  });
});

describe('inviting someone', () => {
  it('needs a linked server and an administrator', async () => {
    expect((await invite({ libraryIds: null })).statusCode).toBe(409);
    await link();
    const viewer = await createUser(env.app, admin, 'viewer');
    expect((await invite({ libraryIds: null }, viewer.cookie)).statusCode).toBe(403);
    expect((await env.app.inject({ url: '/api/admin/invites', headers: { cookie: viewer.cookie } })).statusCode).toBe(403);
    expect((await invite({ libraryIds: 'all' })).statusCode).toBe(400);
  });

  it('makes a normal user with the chosen libraries the first time the invited account opens the server', async () => {
    await link();
    const movies = await addLibrary(env, admin, 'movies', 'Films');
    await addLibrary(env, admin, 'shows', 'Series');
    const made = await invite({ label: 'Lisa', libraryIds: [movies.id] });
    expect(made.statusCode).toBe(200);
    const inv = made.json();
    expect(inv).toMatchObject({ label: 'Lisa', libraryIds: [movies.id], acceptedBy: null });
    expect(inv.url).toBe(`https://vidalune.com/invite#token-for-${inv.id}`);
    expect(calls).toContainEqual({ method: 'POST', path: '/api/server/invites', body: { ref: inv.id } });

    // Accepted on vidalune.com: the list says by whom.
    members = [{ userRef: `invite:${inv.id}`, email: 'lisa.jansen@example.com' }];
    env.ctx.cloud['membersCache'] = null;
    expect((await env.app.inject({ url: '/api/admin/invites', headers: { cookie: admin } })).json()).toMatchObject([{ id: inv.id, acceptedBy: 'lisa.jansen@example.com' }]);

    // Opening it: signed in as a new user, who only sees the chosen library.
    ticketFor = { email: 'lisa.jansen@example.com', userRef: `invite:${inv.id}` };
    const first = await open();
    expect(first.statusCode).toBe(302);
    expect(first.headers.location).toBe('/');
    const lisa = env.ctx.db.select().from(users).where(eq(users.username, 'lisa.jansen')).get()!;
    expect(lisa).toMatchObject({ role: 'user', displayName: 'Lisa', allLibraries: false });
    expect(env.ctx.access.grantedIds(lisa.id)).toEqual([movies.id]);
    expect(calls).toContainEqual({ method: 'POST', path: `/api/server/invites/${inv.id}/user`, body: { userRef: String(lisa.id) } });
    const cookie = `${first.cookies[0].name}=${first.cookies[0].value}`;
    expect((await env.app.inject({ url: '/api/auth/me', headers: { cookie } })).json().user).toMatchObject({ username: 'lisa.jansen', role: 'user' });
    // The administrators are told; the invitation is no longer open.
    expect(env.ctx.db.select().from(adminNotifications).all().map((n) => n.event)).toContain('inviteAccepted');
    expect((await env.app.inject({ url: '/api/admin/invites', headers: { cookie: admin } })).json()).toEqual([]);

    // Used once: opening again is the same user, never a second one.
    const count = env.ctx.db.select().from(users).all().length;
    expect((await open()).headers.location).toBe('/');
    expect(env.ctx.db.select().from(users).all()).toHaveLength(count);
  });

  it('can be withdrawn, after which nobody gets in with it', async () => {
    await link();
    const inv = (await invite({ libraryIds: null })).json();
    const del = await env.app.inject({ method: 'DELETE', url: `/api/admin/invites/${inv.id}`, headers: { cookie: admin } });
    expect(del.statusCode).toBe(200);
    expect(calls).toContainEqual({ method: 'DELETE', path: `/api/server/invites/${inv.id}`, body: null });
    expect((await env.app.inject({ url: '/api/admin/invites', headers: { cookie: admin } })).json()).toEqual([]);
    ticketFor = { email: 'tom@example.com', userRef: `invite:${inv.id}` };
    expect((await open()).headers.location).toBe('/login?vidalune=unknown');
    expect(env.ctx.db.select().from(users).where(eq(users.username, 'tom')).get()).toBeUndefined();
    expect((await env.app.inject({ method: 'DELETE', url: `/api/admin/invites/${inv.id}`, headers: { cookie: admin } })).statusCode).toBe(404);

    // Also withdrawn here when vidalune.com cannot be told right now.
    const other = (await invite({ libraryIds: null })).json();
    reachable = false;
    expect((await env.app.inject({ method: 'DELETE', url: `/api/admin/invites/${other.id}`, headers: { cookie: admin } })).statusCode).toBe(200);
    ticketFor = { email: 'tom@example.com', userRef: `invite:${other.id}` };
    expect((await open()).headers.location).toBe('/login?vidalune=unknown');
  });

  it('still signs in when vidalune.com cannot be told about the new user, and tells it next time', async () => {
    await link();
    const inv = (await invite({ libraryIds: null })).json();
    ticketFor = { email: 'tom@example.com', userRef: `invite:${inv.id}` };
    reachable = false;
    expect((await open()).headers.location).toBe('/');
    const tom = env.ctx.db.select().from(users).where(eq(users.username, 'tom')).get()!;
    expect(tom.allLibraries).toBe(true);
    reachable = true;
    expect((await open()).headers.location).toBe('/');
    expect(calls).toContainEqual({ method: 'POST', path: `/api/server/invites/${inv.id}/user`, body: { userRef: String(tom.id) } });
    expect(env.ctx.db.select().from(users).where(eq(users.username, 'tom2')).get()).toBeUndefined();
  });
});
