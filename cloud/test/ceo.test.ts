import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildCloudApp, SESSION_COOKIE } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db/client.js';
import { accountActivity, accounts, relayTraffic, servers } from '../src/db/schema.js';
import { activeGrant, daysBetween, growth } from '../src/ceo.js';

const DAY = 86_400_000;
let dir: string;
let db: DB;
let app: FastifyInstance;
let clock: number;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-cloud-'));
  const config = loadConfig({ DATA_DIR: dir, PUBLIC_URL: 'https://vidalune.example', ADMIN_EMAILS: 'admin@example.com', CEO_EMAILS: 'Ceo@Example.com', RELAY_MAX_MBPS: '900' }, { webDir: null, frontendDir: null });
  db = openDatabase(config.dbPath);
  clock = Date.parse('2026-09-30T12:00:00Z');
  app = await buildCloudApp(config, db, { now: () => clock });
});
afterEach(async () => {
  await app.close();
  db.$client.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const cookieOf = (res: { cookies: Array<{ name: string; value: string }> }) => `${SESSION_COOKIE}=${res.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
async function signUp(email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/account', payload: { email, password: 'correct-horse' } });
  expect(res.statusCode).toBe(200);
  return cookieOf(res);
}
async function registerFor(accountEmail: string, name: string) {
  const res = await app.inject({ method: 'POST', url: '/api/server/register', payload: { name, version: '0.13.0', url: null } });
  const { id } = res.json();
  const owner = db.select().from(accounts).where(eq(accounts.email, accountEmail)).get()!;
  db.update(servers).set({ accountId: owner.id, relaySlug: `slug${name.toLowerCase()}`, relayEnabled: true }).where(eq(servers.id, id)).run();
  return id as string;
}
const call = (cookie: string, method: string, url: string, payload?: object) => app.inject({ method: method as 'GET', url, headers: { cookie }, payload });

describe('CEO panel', () => {
  it('is only for the CEO, checked on every call (not for administrators or customers)', async () => {
    const ceo = await signUp('ceo@example.com');
    const admin = await signUp('admin@example.com');
    const customer = await signUp('anna@example.com');
    const urls = ['/api/ceo/dashboard', '/api/ceo/customers', '/api/ceo/access', '/api/ceo/relays', '/api/ceo/relays/1', '/api/ceo/statistics'];
    for (const url of urls) {
      expect((await app.inject({ url })).statusCode, url).toBe(401);
      expect((await call(admin, 'GET', url)).statusCode, url).toBe(403);
      expect((await call(customer, 'GET', url)).statusCode, url).toBe(403);
      expect((await call(ceo, 'GET', url)).statusCode, url).toBe(200);
    }
    expect((await call(customer, 'POST', '/api/ceo/access', { email: 'anna@example.com', type: 'free' })).statusCode).toBe(403);
    expect((await call(customer, 'POST', '/api/ceo/relays', { name: 'X', url: 'https://x.example', capacityMbps: 10 })).statusCode).toBe(403);
    // The website knows whom to show the link to.
    expect((await call(ceo, 'GET', '/api/account')).json().ceo).toBe(true);
    expect((await call(admin, 'GET', '/api/account')).json().ceo).toBeUndefined();
  });

  it('counts customers: total, active, new and growth — from real data only', async () => {
    const ceo = await signUp('ceo@example.com');
    // Two accounts made 40 days ago, three in the last week.
    clock -= 40 * DAY;
    await signUp('old1@example.com');
    await signUp('old2@example.com');
    clock += 35 * DAY;
    for (const e of ['a@example.com', 'b@example.com', 'c@example.com']) await signUp(e);
    clock += 5 * DAY;
    const d = (await call(ceo, 'GET', '/api/ceo/dashboard')).json();
    // The CEO (signed up just now), the two old ones and three new ones. Active: who signed in or
    // used Vidalune in the last 30 days (not the two old ones).
    expect(d.customers).toMatchObject({ total: 6, new7: 4, new30: 4, active: 4 });
    // 4 new in the last 30 days against 2 in the 30 before.
    expect(d.customers.growth30).toBe(100);
    expect(d).not.toHaveProperty('revenue');
    expect(d.relays).toMatchObject({ nodes: 1, capacityMbps: 900 });
  });

  it('gives, extends and takes back access, and the account follows', async () => {
    const ceo = await signUp('ceo@example.com');
    await signUp('anna@example.com');
    const given = await call(ceo, 'POST', '/api/ceo/access', { email: 'anna@example.com', type: 'beta', plan: 'remote', days: 30, note: 'beta round 1' });
    expect(given.statusCode).toBe(200);
    const g = given.json();
    expect(g).toMatchObject({ type: 'beta', plan: 'remote', endsAt: clock + 30 * DAY, grantedBy: 'ceo@example.com', source: 'manual' });
    expect(db.select().from(accounts).where(eq(accounts.email, 'anna@example.com')).get()).toMatchObject({ plan: 'remote', planUntil: clock + 30 * DAY });

    // Extend by 30 days, and make it a paying customer.
    const ext = (await call(ceo, 'PUT', `/api/ceo/access/${g.id}`, { addDays: 30, type: 'customer' })).json();
    expect(ext).toMatchObject({ endsAt: clock + 60 * DAY, type: 'customer' });
    expect(db.select().from(accounts).where(eq(accounts.email, 'anna@example.com')).get()?.planUntil).toBe(clock + 60 * DAY);

    const list = (await call(ceo, 'GET', '/api/ceo/customers?type=customer')).json();
    expect(list.customers.map((c: { email: string }) => c.email)).toEqual(['anna@example.com']);
    expect(list.customers[0].access).toMatchObject({ type: 'customer', plan: 'remote' });
    expect((await call(ceo, 'GET', '/api/ceo/dashboard')).json().access).toMatchObject({ total: 1, byType: { customer: 1, beta: 0 } });

    // Taken back: no remote access any more, the history stays.
    expect((await call(ceo, 'DELETE', `/api/ceo/access/${g.id}`)).statusCode).toBe(200);
    expect(db.select().from(accounts).where(eq(accounts.email, 'anna@example.com')).get()).toMatchObject({ plan: 'free', planUntil: null });
    const all = (await call(ceo, 'GET', '/api/ceo/access?show=all')).json().grants;
    expect(all[0]).toMatchObject({ id: g.id, revokedBy: 'ceo@example.com' });
    expect((await call(ceo, 'GET', '/api/ceo/access')).json().grants).toEqual([]);
    expect((await call(ceo, 'DELETE', `/api/ceo/access/${g.id}`)).statusCode).toBe(404);
  });

  it('refuses access that makes no sense', async () => {
    const ceo = await signUp('ceo@example.com');
    await signUp('anna@example.com');
    const bad = async (payload: object) => (await call(ceo, 'POST', '/api/ceo/access', payload)).statusCode;
    expect(await bad({ email: 'nobody@example.com', type: 'free' })).toBe(404);
    expect(await bad({ email: 'anna@example.com', type: 'vip' })).toBe(400);
    expect(await bad({ type: 'free' })).toBe(400);
    expect(await bad({ email: 'anna@example.com', type: 'free', until: clock - 1000 })).toBe(400);
  });

  it('keeps relays: capacity, the monthly allowance, who uses which, traffic and errors', async () => {
    const ceo = await signUp('ceo@example.com');
    await signUp('anna@example.com');
    await signUp('bram@example.com');
    const a1 = await registerFor('anna@example.com', 'Thuis');
    const a2 = await registerFor('anna@example.com', 'Zomerhuis');
    const b1 = await registerFor('bram@example.com', 'Bram');
    const today = new Date(clock).toISOString().slice(0, 10);
    db.insert(relayTraffic).values({ serverId: a1, day: today, bytesOut: 600e9, bytesIn: 1e6, requests: 10, errors: 2 }).run();
    db.insert(relayTraffic).values({ serverId: b1, day: today, bytesOut: 5e9, bytesIn: 1e6, requests: 3, errors: 0 }).run();

    let relays = (await call(ceo, 'GET', '/api/ceo/relays')).json().relays;
    expect(relays).toHaveLength(1);
    expect(relays[0]).toMatchObject({ main: true, name: 'vidalune.com', capacityMbps: 900, servers: 3, customers: 2, month: { errors: 2 } });

    // A relay in Asia-Pacific: 1 TB a month, then 10 Mbit/s.
    const asia = (await call(ceo, 'POST', '/api/ceo/relays', { name: 'Singapore', region: 'Asia-Pacific', url: 'https://sg.relay.example', capacityMbps: 500, monthlyQuotaGb: 1000, overQuotaMbps: 10 })).json();
    expect(asia).toMatchObject({ main: false, servers: 0, quota: { monthlyGb: 1000, overQuotaMbps: 10, usedGb: 0 } });
    // Move Anna (both servers) there.
    expect((await call(ceo, 'POST', `/api/ceo/relays/${asia.id}/assign`, { accountId: db.select().from(accounts).where(eq(accounts.email, 'anna@example.com')).get()!.id })).json()).toEqual({ ok: true, moved: 2 });
    const detail = (await call(ceo, 'GET', `/api/ceo/relays/${asia.id}`)).json();
    expect(detail).toMatchObject({ servers: 2, customers: 1, quota: { usedGb: 600, usedPercent: 60 } });
    expect(detail.serverList.map((s: { name: string }) => s.name).sort()).toEqual(['Thuis', 'Zomerhuis']);
    expect(detail.days).toHaveLength(30);
    expect(detail.days.at(-1)).toMatchObject({ day: today, out: 600e9, errors: 2 });
    // 80 % of the allowance: on the dashboard.
    db.update(relayTraffic).set({ bytesOut: 850e9 }).where(eq(relayTraffic.serverId, a1)).run();
    expect((await call(ceo, 'GET', '/api/ceo/dashboard')).json().relays.nearQuota).toEqual([{ id: asia.id, name: 'Singapore', usedGb: 850, monthlyGb: 1000, overQuotaMbps: 10 }]);

    // One server back to the main relay; a relay turned off sends the rest back too.
    expect((await call(ceo, 'DELETE', `/api/ceo/relays/${asia.id}/servers/${a2}`)).statusCode).toBe(200);
    expect(db.select().from(servers).where(eq(servers.id, a2)).get()?.relayNodeId).toBeNull();
    await call(ceo, 'PUT', `/api/ceo/relays/${asia.id}`, { active: false });
    expect(db.select().from(servers).where(eq(servers.id, a1)).get()?.relayNodeId).toBeNull();
    relays = (await call(ceo, 'GET', '/api/ceo/relays')).json().relays;
    expect(relays.find((r: { main: boolean }) => r.main).servers).toBe(3);
    // The main relay stays what it is.
    expect((await call(ceo, 'PUT', `/api/ceo/relays/${relays[0].id}`, { active: false })).statusCode).toBe(400);
    expect((await call(ceo, 'POST', '/api/ceo/relays', { name: 'X', url: 'http://insecure.example', capacityMbps: 10 })).statusCode).toBe(400);
  });

  it('gives figures per day for the charts', async () => {
    const ceo = await signUp('ceo@example.com');
    clock -= 2 * DAY;
    await signUp('anna@example.com');
    const anna = db.select().from(accounts).where(eq(accounts.email, 'anna@example.com')).get()!;
    db.insert(accountActivity).values({ accountId: anna.id, day: new Date(clock).toISOString().slice(0, 10) }).onConflictDoNothing().run();
    await call(ceo, 'POST', '/api/ceo/access', { email: 'anna@example.com', type: 'customer', days: 365 });
    clock += 2 * DAY;
    const s = (await call(ceo, 'GET', '/api/ceo/statistics?days=30')).json();
    expect(s.days).toHaveLength(30);
    const twoDaysAgo = s.days.at(-3);
    expect(twoDaysAgo).toMatchObject({ newAccounts: 1, activeAccounts: 2, withAccess: 1, grants: 1 });
    expect(s.days.at(-1)).toMatchObject({ accounts: 2, withAccess: 1 });
    expect(s.days[0].accounts).toBe(0);
    expect((await call(ceo, 'GET', '/api/ceo/statistics?days=7')).statusCode).toBe(400);
  });
});

describe('CEO panel: the sums', () => {
  it('knows which grant counts now', () => {
    const g = (over: object) => ({ id: 1, accountId: 1, type: 'beta', plan: 'remote', startsAt: 0, endsAt: null, note: null, grantedBy: 'x', createdAt: 0, revokedAt: null, revokedBy: null, source: 'manual', priceCents: null, currency: null, billingRef: null, ...over }) as Parameters<typeof activeGrant>[0][number];
    expect(activeGrant([g({ endsAt: 50 })], 100)).toBeNull();
    expect(activeGrant([g({ revokedAt: 10 })], 100)).toBeNull();
    expect(activeGrant([g({ id: 1, startsAt: 0 }), g({ id: 2, startsAt: 50, type: 'customer' })], 100)?.type).toBe('customer');
  });

  it('computes growth and days', () => {
    expect(growth(15, 10)).toBe(50);
    expect(growth(5, 10)).toBe(-50);
    expect(growth(3, 0)).toBeNull();
    expect(growth(0, 0)).toBe(0);
    expect(daysBetween(Date.parse('2026-09-28T23:00:00Z'), Date.parse('2026-09-30T01:00:00Z'))).toEqual(['2026-09-28', '2026-09-29', '2026-09-30']);
  });
});
