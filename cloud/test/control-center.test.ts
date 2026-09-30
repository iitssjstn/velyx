import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildCloudApp, SESSION_COOKIE } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db/client.js';
import { accountSessions, accounts, relayNodes, relaySamples, servers } from '../src/db/schema.js';
import { grantStatus, relayStatus, SAMPLE_MS, uptime } from '../src/ceo.js';
import { deviceLabel } from '../src/relay.js';

const DAY = 86_400_000;
let dir: string;
let db: DB;
let app: FastifyInstance;
let clock: number;
/** Other relays' health: answering or not. */
let relayUp: boolean;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-cloud-'));
  const config = loadConfig({ DATA_DIR: dir, PUBLIC_URL: 'https://vidalune.example', CEO_EMAILS: 'ceo@example.com', RELAY_MAX_MBPS: '900' }, { webDir: null, frontendDir: null });
  db = openDatabase(config.dbPath);
  clock = Date.parse('2026-09-30T12:00:00Z');
  relayUp = true;
  const fetchImpl = (async (url: string) => {
    if (!String(url).startsWith('https://fra.relay.example/')) throw new Error('network disabled in tests');
    if (!relayUp) throw new Error('connect ECONNREFUSED');
    return new Response('{"status":"ok"}', { status: 200 });
  }) as typeof fetch;
  app = await buildCloudApp(config, db, { now: () => clock, fetchImpl });
});
afterEach(async () => {
  await app.close();
  db.$client.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const cookieOf = (res: { cookies: Array<{ name: string; value: string }> }) => `${SESSION_COOKIE}=${res.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
async function signUp(email: string, password = 'correct-horse') {
  const res = await app.inject({ method: 'POST', url: '/api/account', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return cookieOf(res);
}
const call = (cookie: string, method: string, url: string, payload?: object) => app.inject({ method: method as 'GET', url, headers: { cookie }, payload });
const accountId = (email: string) => db.select().from(accounts).where(eq(accounts.email, email)).get()!.id;
async function serverFor(email: string, name: string) {
  const { id } = (await app.inject({ method: 'POST', url: '/api/server/register', payload: { name, version: '0.15.0', url: null } })).json();
  db.update(servers).set({ accountId: accountId(email), relaySlug: `slug${name.toLowerCase()}`, relayEnabled: true }).where(eq(servers.id, id)).run();
  return id as string;
}

describe('Control Center: security', () => {
  it('never lets customers use it: every call checked on the server', async () => {
    const ceo = await signUp('ceo@example.com');
    const anna = await signUp('anna@example.com');
    await call(ceo, 'POST', '/api/ceo/customers', { email: 'new@example.com' });
    const id = accountId('new@example.com');
    const relay = (await call(ceo, 'POST', '/api/ceo/relays', { name: 'Frankfurt', url: 'https://fra.relay.example', capacityMbps: 1000 })).json();
    const writes: Array<[string, string, object?]> = [
      ['POST', '/api/ceo/customers', { email: 'x@example.com' }],
      ['PUT', `/api/ceo/customers/${id}`, { name: 'X' }],
      ['POST', `/api/ceo/customers/${id}/suspend`, {}],
      ['POST', `/api/ceo/customers/${id}/unsuspend`, {}],
      ['POST', '/api/ceo/access', { accountId: id, type: 'free' }],
      ['POST', '/api/ceo/relays', { name: 'X', url: 'https://x.example', capacityMbps: 10 }],
      ['PUT', `/api/ceo/relays/${relay.id}`, { active: false }],
      ['DELETE', `/api/ceo/relays/${relay.id}`],
      ['POST', `/api/ceo/relays/${relay.id}/assign`, { accountId: id }],
      ['DELETE', `/api/ceo/relays/${relay.id}/customers/${id}`],
      ['PUT', '/api/ceo/servers/abc/relay-limit', { limitMbps: 5 }],
    ];
    const reads = ['/api/ceo/activity', `/api/ceo/customers/${id}`, `/api/ceo/relays/${relay.id}/history`, '/api/ceo/statistics?range=24h'];
    for (const url of reads) {
      expect((await app.inject({ url })).statusCode, url).toBe(401);
      expect((await call(anna, 'GET', url)).statusCode, url).toBe(403);
      expect((await call(ceo, 'GET', url)).statusCode, url).toBe(200);
    }
    for (const [method, url, payload] of writes) {
      expect((await call(anna, method, url, payload)).statusCode, `${method} ${url}`).toBe(403);
      expect((await app.inject({ method: method as 'GET', url, payload })).statusCode, `${method} ${url}`).toBe(401);
    }
    // Nothing changed by those.
    expect(db.select().from(accounts).where(eq(accounts.id, id)).get()?.suspendedAt).toBeNull();
    expect(db.select().from(relayNodes).where(eq(relayNodes.id, relay.id)).get()?.active).toBe(true);
  });
});

describe('Control Center: customers', () => {
  it('adds a customer by hand, with access and a relay; they take the account over by signing up', async () => {
    const ceo = await signUp('ceo@example.com');
    const fra = (await call(ceo, 'POST', '/api/ceo/relays', { name: 'Frankfurt', region: 'Europe', url: 'https://fra.relay.example', capacityMbps: 1000 })).json();
    const res = await call(ceo, 'POST', '/api/ceo/customers', { email: 'Nina@Example.com', name: 'Nina de Vries', note: 'via a friend', relayId: fra.id, access: { type: 'beta', plan: 'remote', endsAt: clock + 30 * DAY } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ email: 'nina@example.com', name: 'Nina de Vries', invited: true, status: 'inactive', access: { type: 'beta', status: 'active', endsAt: clock + 30 * DAY }, relay: { id: fra.id, name: 'Frankfurt' } });
    expect((await call(ceo, 'POST', '/api/ceo/customers', { email: 'nina@example.com' })).statusCode).toBe(409);
    expect((await call(ceo, 'POST', '/api/ceo/customers', { email: 'not-an-email' })).statusCode).toBe(400);
    // Without a password nobody can sign in with it…
    expect((await app.inject({ method: 'POST', url: '/api/login', payload: { email: 'nina@example.com', password: '' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/login', payload: { email: 'nina@example.com', password: 'anything-at-all' } })).statusCode).toBe(401);
    // …until she signs up with that address: the account (and its access) is hers.
    const nina = await signUp('nina@example.com', 'her-own-password');
    expect((await call(nina, 'GET', '/api/account')).json().remote).toMatchObject({ active: true, kind: 'remote' });
    expect((await call(ceo, 'GET', `/api/ceo/customers/${accountId('nina@example.com')}`)).json()).toMatchObject({ invited: false, note: 'via a friend', devices: 1 });
    // A real account cannot be taken over that way.
    expect((await app.inject({ method: 'POST', url: '/api/account', payload: { email: 'nina@example.com', password: 'someone-else' } })).statusCode).toBe(409);
    const events = (await call(ceo, 'GET', '/api/ceo/activity')).json().events.map((e: { action: string }) => e.action);
    expect(events).toEqual(expect.arrayContaining(['customer.created', 'access.granted', 'relay.created']));
  });

  it('suspends a customer: signed out, no sign-in, servers off the relay — and back', async () => {
    const ceo = await signUp('ceo@example.com');
    const anna = await signUp('anna@example.com');
    const id = accountId('anna@example.com');
    await call(ceo, 'POST', '/api/ceo/access', { accountId: id, type: 'customer', plan: 'remote' });
    const res = await call(ceo, 'POST', `/api/ceo/customers/${id}/suspend`, { reason: 'did not pay' });
    expect(res.json()).toMatchObject({ status: 'suspended' });
    expect(db.select().from(accountSessions).where(eq(accountSessions.accountId, id)).all()).toEqual([]);
    expect((await call(anna, 'GET', '/api/account')).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { email: 'anna@example.com', password: 'correct-horse' } });
    expect(login.statusCode).toBe(403);
    expect(login.json().error).toMatch(/suspended/);
    expect((await call(ceo, 'POST', `/api/ceo/customers/${id}/suspend`, {})).statusCode).toBe(409);
    // The CEO cannot lock themselves out.
    expect((await call(ceo, 'POST', `/api/ceo/customers/${accountId('ceo@example.com')}/suspend`, {})).statusCode).toBe(400);
    expect((await call(ceo, 'GET', '/api/ceo/customers?status=suspended')).json().customers.map((c: { email: string }) => c.email)).toEqual(['anna@example.com']);

    expect((await call(ceo, 'POST', `/api/ceo/customers/${id}/unsuspend`, {})).json()).toMatchObject({ status: 'active' });
    expect((await app.inject({ method: 'POST', url: '/api/login', payload: { email: 'anna@example.com', password: 'correct-horse' } })).statusCode).toBe(200);
    const activity = (await call(ceo, 'GET', `/api/ceo/customers/${id}`)).json().activity.map((e: { action: string }) => e.action);
    expect(activity).toEqual(['customer.unsuspended', 'customer.suspended', 'access.granted']);
  });

  it('filters, searches and sorts customers', async () => {
    const ceo = await signUp('ceo@example.com');
    clock -= 10 * DAY;
    await signUp('zoe@example.com');
    clock += 5 * DAY;
    await signUp('bram@example.com');
    clock += 5 * DAY;
    await call(ceo, 'PUT', `/api/ceo/customers/${accountId('zoe@example.com')}`, { name: 'Aaron Zoe' });
    await call(ceo, 'POST', '/api/ceo/access', { email: 'bram@example.com', type: 'test', days: 5 });
    await call(ceo, 'POST', '/api/ceo/access', { email: 'zoe@example.com', type: 'customer', days: 100 });
    const list = async (q: string) => (await call(ceo, 'GET', `/api/ceo/customers?${q}`)).json().customers.map((c: { email: string }) => c.email);
    expect(await list('sort=created')).toEqual(['ceo@example.com', 'bram@example.com', 'zoe@example.com']);
    expect(await list('sort=created&dir=asc')).toEqual(['zoe@example.com', 'bram@example.com', 'ceo@example.com']);
    expect(await list('sort=name')).toEqual(['zoe@example.com', 'bram@example.com', 'ceo@example.com']);
    // Ending soonest first; without access last.
    expect(await list('sort=expires')).toEqual(['bram@example.com', 'zoe@example.com', 'ceo@example.com']);
    expect(await list('status=expiring')).toEqual(['bram@example.com']);
    expect(await list('type=test')).toEqual(['bram@example.com']);
    expect(await list('type=none')).toEqual(['ceo@example.com']);
    expect(await list('q=aaron')).toEqual(['zoe@example.com']);
    expect((await call(ceo, 'GET', '/api/ceo/customers?sort=revenue')).statusCode).toBe(400);
  });
});

describe('Control Center: access', () => {
  it('knows scheduled, active, ending, expired and taken-back access, and starts access on its date', async () => {
    const ceo = await signUp('ceo@example.com');
    for (const e of ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com']) await signUp(e);
    await call(ceo, 'POST', '/api/ceo/access', { email: 'a@example.com', type: 'customer', days: 5 });
    await call(ceo, 'POST', '/api/ceo/access', { email: 'b@example.com', type: 'beta', days: 10 });
    const later = (await call(ceo, 'POST', '/api/ceo/access', { email: 'c@example.com', type: 'test', startsAt: clock + 2 * DAY, until: clock + 40 * DAY })).json();
    expect(later.status).toBe('scheduled');
    const ending = (await call(ceo, 'POST', '/api/ceo/access', { email: 'd@example.com', type: 'free', days: 1 })).json();
    expect((await call(ceo, 'POST', '/api/ceo/access', { email: 'd@example.com', type: 'free', startsAt: clock + 5 * DAY, until: clock + 4 * DAY })).statusCode).toBe(400);
    expect((await call(ceo, 'GET', '/api/ceo/access')).json().summary).toMatchObject({ total: 3, byType: { customer: 1, beta: 1, test: 0, free: 1 }, expiringIn7Days: 2, expiringIn14Days: 3, expired: 0 });

    // Two days on: D's access ran out, C's started (the monitor puts the plan in line).
    clock += 2 * DAY;
    expect(db.select().from(accounts).where(eq(accounts.email, 'c@example.com')).get()?.plan).toBe('free');
    await app.ceoMonitor();
    expect(db.select().from(accounts).where(eq(accounts.email, 'c@example.com')).get()?.plan).toBe('remote');
    const d = (await call(ceo, 'GET', '/api/ceo/access')).json();
    expect(d.summary).toMatchObject({ total: 3, expired: 1 });
    expect((await call(ceo, 'GET', '/api/ceo/access?show=expired')).json().grants.map((g: { id: number }) => g.id)).toEqual([ending.id]);

    // Changed and taken back, each written down with what it was before.
    const b = d.grants.find((g: { email: string }) => g.email === 'b@example.com');
    expect((await call(ceo, 'PUT', `/api/ceo/access/${b.id}`, { type: 'customer', plan: 'viewer' })).json()).toMatchObject({ type: 'customer', plan: 'viewer' });
    await call(ceo, 'DELETE', `/api/ceo/access/${b.id}`);
    expect((await call(ceo, 'GET', '/api/ceo/access?show=all')).json().grants.find((g: { id: number }) => g.id === b.id).status).toBe('revoked');
    const events = (await call(ceo, 'GET', '/api/ceo/activity')).json().events;
    expect(events[0]).toMatchObject({ action: 'access.revoked', actor: 'ceo@example.com', target: 'b@example.com' });
    expect(events[1]).toMatchObject({ action: 'access.changed', detail: { before: { type: 'beta', plan: 'remote' }, after: { type: 'customer', plan: 'viewer' } } });
  });
});

describe('Control Center: relays', () => {
  it('checks relays, keeps their uptime and history, and notes when one goes offline', async () => {
    const ceo = await signUp('ceo@example.com');
    const fra = (await call(ceo, 'POST', '/api/ceo/relays', { name: 'Frankfurt', url: 'https://fra.relay.example', capacityMbps: 1000 })).json();
    expect(fra.status).toBe('unknown');
    for (let i = 0; i < 12; i++) {
      await app.ceoMonitor();
      clock += SAMPLE_MS;
    }
    let r = (await call(ceo, 'GET', `/api/ceo/relays/${fra.id}`)).json();
    expect(r).toMatchObject({ status: 'online', uptime30: 100 });
    relayUp = false;
    for (let i = 0; i < 4; i++) {
      await app.ceoMonitor();
      clock += SAMPLE_MS;
    }
    r = (await call(ceo, 'GET', `/api/ceo/relays/${fra.id}`)).json();
    expect(r.status).toBe('offline');
    expect(r.uptime30).toBe(75);
    const dash = (await call(ceo, 'GET', '/api/ceo/dashboard')).json();
    expect(dash.relays).toMatchObject({ nodes: 2, online: 1, offline: 1 });
    expect(dash.relays.list.map((x: { name: string; status: string }) => [x.name, x.status])).toEqual([
      ['vidalune.com', 'online'],
      ['Frankfurt', 'offline'],
    ]);
    expect(dash.activity[0]).toMatchObject({ actor: 'system', action: 'relay.offline', target: 'Frankfurt' });

    const h = (await call(ceo, 'GET', `/api/ceo/relays/${fra.id}/history?range=1h`)).json();
    // The last hour: 8 of its 12 five-minute samples up.
    expect(h).toMatchObject({ available: true, uptime: 66.67 });
    expect(h.points.at(-1)).toMatchObject({ up: false, mbps: 0, clients: 0 });
    // A week: by the hour.
    expect((await call(ceo, 'GET', `/api/ceo/relays/${fra.id}/history?range=7d`)).json().points).toHaveLength(2);
    expect((await call(ceo, 'GET', `/api/ceo/relays/${fra.id}/history?range=1y`)).statusCode).toBe(400);
    // Samples are only kept 35 days.
    clock += 40 * DAY;
    await app.ceoMonitor();
    expect(db.select().from(relaySamples).where(eq(relaySamples.nodeId, fra.id)).all()).toHaveLength(1);
  });

  it('adds, changes, turns off and removes relays; customers and servers move with it', async () => {
    const ceo = await signUp('ceo@example.com');
    await signUp('anna@example.com');
    const home = await serverFor('anna@example.com', 'Thuis');
    const cabin = await serverFor('anna@example.com', 'Hut');
    const fra = (await call(ceo, 'POST', '/api/ceo/relays', { name: 'Frankfurt', url: 'https://fra.relay.example', capacityMbps: 1000 })).json();
    const anna = accountId('anna@example.com');
    expect((await call(ceo, 'POST', `/api/ceo/relays/${fra.id}/assign`, { accountId: anna })).json()).toEqual({ ok: true, moved: 2 });
    const detail = (await call(ceo, 'GET', `/api/ceo/relays/${fra.id}`)).json();
    expect(detail.customerList.map((c: { email: string }) => c.email)).toEqual(['anna@example.com']);
    expect(detail.serverList.map((s: { name: string }) => s.name).sort()).toEqual(['Hut', 'Thuis']);
    // A server added later follows its customer's relay.
    const later = await serverFor('anna@example.com', 'Nieuw');
    expect((await call(ceo, 'GET', `/api/ceo/relays/${fra.id}`)).json().servers).toBe(3);
    // One server off it; the customer stays.
    await call(ceo, 'DELETE', `/api/ceo/relays/${fra.id}/servers/${later}`);
    expect((await call(ceo, 'GET', `/api/ceo/relays/${fra.id}`)).json().servers).toBe(2);

    expect((await call(ceo, 'PUT', `/api/ceo/relays/${fra.id}`, { capacityMbps: 2000, region: 'Europe' })).json()).toMatchObject({ capacityMbps: 2000, region: 'Europe' });
    // Removed: everything back on the main relay, written down.
    const removed = await call(ceo, 'DELETE', `/api/ceo/relays/${fra.id}`);
    expect(removed.json()).toEqual({ ok: true, moved: 2 });
    expect(db.select().from(servers).where(eq(servers.id, home)).get()?.relayNodeId).toBeNull();
    expect(db.select().from(servers).where(eq(servers.id, cabin)).get()?.relayNodeId).toBeNull();
    expect(db.select().from(accounts).where(eq(accounts.id, anna)).get()?.relayNodeId).toBeNull();
    const main = (await call(ceo, 'GET', '/api/ceo/relays')).json().relays[0];
    expect(main).toMatchObject({ main: true, servers: 3 });
    expect((await call(ceo, 'DELETE', `/api/ceo/relays/${main.id}`)).statusCode).toBe(400);
    const actions = (await call(ceo, 'GET', '/api/ceo/activity')).json().events.map((e: { action: string }) => e.action);
    expect(actions.slice(0, 5)).toEqual(['relay.removed', 'relay.updated', 'relay.serverRemoved', 'relay.customerAssigned', 'relay.created']);
  });

  it('gives relay totals and statistics per period, without history it does not have', async () => {
    const ceo = await signUp('ceo@example.com');
    const s = (await call(ceo, 'GET', '/api/ceo/statistics?range=7d')).json();
    expect(s.days).toHaveLength(7);
    expect(s.summary.relays).toMatchObject({ total: 1, online: 1, capacityMbps: 900, peakMbps: null, avgLoad: null, uptime: null, historySince: null });
    expect(s.summary.customers).toMatchObject({ total: 1, new: 1, active: 1 });
    expect(s).not.toHaveProperty('revenue');
    await app.ceoMonitor();
    const day = (await call(ceo, 'GET', '/api/ceo/statistics?range=24h')).json();
    expect(day.hours).toHaveLength(1);
    expect(day.summary.relays).toMatchObject({ peakMbps: 0, avgLoad: 0, uptime: 100 });
    const totals = (await call(ceo, 'GET', '/api/ceo/relays')).json().totals;
    expect(totals).toEqual({ capacityMbps: 900, mbpsNow: 0, availableMbps: 900, usage: 0 });
  });
});

describe('Control Center: the sums', () => {
  it('knows where a grant stands', () => {
    const now = 1_000 * DAY;
    expect(grantStatus({ startsAt: now + 1, endsAt: null, revokedAt: null }, now)).toBe('scheduled');
    expect(grantStatus({ startsAt: 0, endsAt: null, revokedAt: null }, now)).toBe('active');
    expect(grantStatus({ startsAt: 0, endsAt: now + 3 * DAY, revokedAt: null }, now)).toBe('expiring');
    expect(grantStatus({ startsAt: 0, endsAt: now, revokedAt: null }, now)).toBe('expired');
    expect(grantStatus({ startsAt: 0, endsAt: null, revokedAt: 5 }, now)).toBe('revoked');
  });

  it('knows a relay’s state and uptime', () => {
    const n = { active: true, lastCheckAt: 100, lastSeenAt: 100 };
    expect(relayStatus(n, false, { usage: 10, overQuota: false })).toBe('online');
    expect(relayStatus({ ...n, lastSeenAt: 50 }, false, { usage: 10, overQuota: false })).toBe('offline');
    expect(relayStatus({ ...n, lastCheckAt: null, lastSeenAt: null }, false, { usage: null, overQuota: false })).toBe('unknown');
    expect(relayStatus(n, false, { usage: 95, overQuota: false })).toBe('degraded');
    expect(relayStatus(n, false, { usage: 5, overQuota: true })).toBe('degraded');
    expect(relayStatus({ ...n, active: false }, true, { usage: 0, overQuota: false })).toBe('disabled');
    expect(relayStatus({ active: true, lastCheckAt: null, lastSeenAt: null }, true, { usage: 0, overQuota: false })).toBe('online');
    const s = (i: number, up: boolean) => ({ at: i * SAMPLE_MS, up });
    expect(uptime([], 0, 10 * SAMPLE_MS)).toBeNull();
    expect(uptime([s(0, true), s(1, true), s(2, false), s(3, true)], 0, 3 * SAMPLE_MS)).toBe(75);
    // Missing samples (the service was down) count as down.
    expect(uptime([s(0, true), s(3, true)], 0, 3 * SAMPLE_MS)).toBe(50);
    // A relay added halfway is not counted down for before.
    expect(uptime([s(5, true), s(6, true)], 0, 6 * SAMPLE_MS)).toBe(100);
  });

  it('names devices by kind only', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36')).toBe('Chrome on Windows');
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15')).toBe('Safari on macOS');
    expect(deviceLabel('Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 CrKey/1.56')).toBe('Chromecast');
    expect(deviceLabel('Vidalune/0.15.0 (Android 14)')).toBe('Vidalune app (Android)');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Edge on Windows');
    expect(deviceLabel(undefined)).toBe('Other device');
  });
});
