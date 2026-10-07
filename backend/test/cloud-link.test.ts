import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestEnv, createUser, setupAdmin, type TestEnv } from './helpers.js';
import { auditLog } from '../src/db/schema.js';
import { localEndpoints } from '../src/services/cloud.js';

// A stand-in for the Vidalune account service (the real one is tested in cloud/).
let linkedTo: string | null;
let calls: Array<{ url: string; method: string; auth: string | null; body: unknown }>;
let reachable: boolean;
let relayOn: boolean;
/** The owner's account has remote access (a subscription). */
let allowed: boolean;
// Never reached in these tests: the tunnel itself is tested against the real relay in cloud/.
const RELAY_URL = 'https://k7f3q9ma.vidalune.invalid';
const fakeService = async (url: string, init?: RequestInit) => {
  if (!reachable) throw new Error('offline');
  const path = new URL(url).pathname;
  const headers = (init?.headers ?? {}) as Record<string, string>;
  calls.push({ url, method: init?.method ?? 'GET', auth: headers.Authorization ?? null, body: init?.body ? JSON.parse(String(init.body)) : null });
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
  if (path === '/api/server/register') return json({ id: 'srv-1', secret: 'secret-secret-secret-secret' });
  if (path === '/api/server/code') return json({ code: 'K7F3-Q9MA', expiresAt: Date.now() + 600_000, linkUrl: 'https://vidalune.com/link' });
  if (path === '/api/server/heartbeat') return json({ linked: !!linkedTo, account: linkedTo, relay: { enabled: relayOn && !!linkedTo, allowed, url: relayOn && linkedTo && allowed ? RELAY_URL : null } });
  if (path === '/api/server/relay') {
    const enabled = (JSON.parse(String(init?.body)) as { enabled: boolean }).enabled;
    if (enabled && !allowed) return new Response(JSON.stringify({ error: 'Remote access through Vidalune needs a subscription.' }), { status: 402 });
    relayOn = enabled;
    return json({ enabled: relayOn, allowed, url: relayOn ? RELAY_URL : null });
  }
  if (path === '/api/server') return json({ ok: true });
  return new Response('{}', { status: 404 });
};

let env: TestEnv;
let admin: string;
beforeEach(async () => {
  linkedTo = null;
  calls = [];
  reachable = true;
  relayOn = false;
  allowed = true;
  env = await createTestEnv({ fetchImpl: fakeService });
  admin = await setupAdmin(env.app, 'justin');
});
afterEach(async () => {
  env.ctx.cloud.shutdown();
  await env.cleanup();
});

const post = (url: string, cookie = admin) => env.app.inject({ method: 'POST', url, headers: { cookie } });

describe('linking to a Vidalune account', () => {
  it('advertises only private LAN addresses on the configured HTTPS listener', () => {
    const info = (address: string, internal = false) => address.includes(':')
      ? { address, netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6' as const, mac: '00:00:00:00:00:00', internal, cidr: null, scopeid: 0 }
      : { address, netmask: '255.255.255.0', family: 'IPv4' as const, mac: '00:00:00:00:00:00', internal, cidr: null };
    expect(localEndpoints(8443, {
      lan: [info('192.168.1.50'), info('10.0.0.4'), info('100.64.1.2'), info('fd12::50')],
      public: [info('8.8.8.8'), info('169.254.1.4')],
      loopback: [info('127.0.0.1', true), info('::1', true)],
    })).toEqual([
      { type: 'lan', address: '192.168.1.50', port: 8443, protocol: 'https' },
      { type: 'lan', address: '10.0.0.4', port: 8443, protocol: 'https' },
      { type: 'lan', address: '100.64.1.2', port: 8443, protocol: 'https' },
      { type: 'lan', address: 'fd12::50', port: 8443, protocol: 'https' },
    ]);
  });

  it('contacts nothing until an administrator turns it on', async () => {
    expect((await env.app.inject({ url: '/api/admin/cloud', headers: { cookie: admin } })).json()).toMatchObject({ enabled: false, account: null, code: null, serviceUrl: 'https://vidalune.com' });
    await post('/api/admin/cloud/check');
    expect(calls).toEqual([]);
  });

  it('is for administrators only', async () => {
    const viewer = await createUser(env.app, admin, 'viewer');
    expect((await post('/api/admin/cloud/link', viewer.cookie)).statusCode).toBe(403);
    expect((await env.app.inject({ url: '/api/admin/cloud', headers: { cookie: viewer.cookie } })).statusCode).toBe(403);
  });

  it('shows a code, learns the account, and never hands out the secret', async () => {
    const waiting = (await post('/api/admin/cloud/link')).json();
    expect(waiting).toMatchObject({ enabled: true, account: null, code: { code: 'K7F3-Q9MA', linkUrl: 'https://vidalune.com/link#K7F3-Q9MA' } });
    expect(JSON.stringify(waiting)).not.toContain('secret-secret');
    expect(calls.map((c) => c.url.replace('https://vidalune.com', ''))).toEqual(['/api/server/register', '/api/server/code']);
    expect(calls[1].auth).toBe('Server srv-1:secret-secret-secret-secret');
    expect(calls[0].body).toMatchObject({ name: 'Vidalune', version: expect.any(String), url: null, localEndpoints: expect.any(Array) });
    expect((calls[0].body as { localEndpoints: Array<{ type: string; port: number; protocol: string }> }).localEndpoints.every((endpoint) => endpoint.type === 'lan' && endpoint.port === env.ctx.config.directTlsPort && endpoint.protocol === 'https')).toBe(true);

    linkedTo = 'justin@example.com';
    const linked = (await post('/api/admin/cloud/check')).json();
    expect(linked).toMatchObject({ enabled: true, account: 'justin@example.com', code: null });
    expect(JSON.stringify((await env.app.inject({ url: '/api/admin/settings', headers: { cookie: admin } })).json())).not.toContain('secret-secret');

    const off = (await post('/api/admin/cloud/unlink')).json();
    expect(off).toMatchObject({ enabled: false, account: null });
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE' });
    const audit = env.ctx.db.select().from(auditLog).where(eq(auditLog.actorName, 'justin')).all().map((a) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['cloud.linking', 'cloud.unlinked']));
  });

  it('explains that the relay needs a subscription when the account has no remote access', async () => {
    linkedTo = 'justin@example.com';
    allowed = false;
    await post('/api/admin/cloud/link');
    const status = (await post('/api/admin/cloud/check')).json();
    expect(status.relay).toMatchObject({ enabled: false, allowed: false });
    const refused = await env.app.inject({ method: 'POST', url: '/api/admin/cloud/relay', headers: { cookie: admin }, payload: { enabled: true } });
    expect(refused.statusCode).toBe(402);
    expect(refused.json().error).toBe('Remote access through Vidalune needs a subscription.');
    // Given on vidalune.com: the next report says so.
    allowed = true;
    expect((await post('/api/admin/cloud/check')).json().relay).toMatchObject({ allowed: true });
  });

  it('reports the manually selected public port when UPnP is disabled', async () => {
    env.ctx.settings.update({ upnp: { enabled: false, externalPort: 32400 } });
    await post('/api/admin/cloud/link');
    expect(calls[0]?.body).toMatchObject({ directPort: 32400 });
  });

  it('turns the relay on only for a linked server, and off again when the server is unlinked on vidalune.com', async () => {
    await post('/api/admin/cloud/link');
    const refused = await env.app.inject({ method: 'POST', url: '/api/admin/cloud/relay', headers: { cookie: admin }, payload: { enabled: true } });
    expect(refused.statusCode).toBe(409);
    linkedTo = 'justin@example.com';
    await post('/api/admin/cloud/check');
    const on = (await env.app.inject({ method: 'POST', url: '/api/admin/cloud/relay', headers: { cookie: admin }, payload: { enabled: true } })).json();
    expect(on.relay).toMatchObject({ enabled: true, url: RELAY_URL, connected: false });
    const audit = env.ctx.db.select().from(auditLog).where(eq(auditLog.actorName, 'justin')).all().map((a) => a.action);
    expect(audit).toContain('cloud.relay_on');
    // Unlinked on vidalune.com: the next report turns the relay off here too.
    linkedTo = null;
    expect((await post('/api/admin/cloud/check')).json()).toMatchObject({ account: null, relay: { enabled: false, url: null } });
  });

  it('explains when the account service cannot be reached, and can still be turned off', async () => {
    reachable = false;
    const res = await post('/api/admin/cloud/link');
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatch(/Could not reach the Vidalune account service/);
    reachable = true;
    await post('/api/admin/cloud/link');
    reachable = false;
    expect((await post('/api/admin/cloud/unlink')).json()).toMatchObject({ enabled: false });
  });
});
