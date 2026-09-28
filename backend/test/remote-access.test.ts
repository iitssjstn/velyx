import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, setupAdmin, type TestEnv } from './helpers.js';
import { isHomeAddress, parseNetwork } from '../src/services/remote-access.js';
import { REMOTE_GRACE_MS } from '../src/services/cloud.js';

describe('home or away', () => {
  it('counts the private ranges as home, and networks an administrator adds', () => {
    for (const ip of ['127.0.0.1', '::1', '10.1.2.3', '172.20.0.5', '192.168.1.20', '::ffff:192.168.1.20', 'fd12:3456::1', 'fe80::1']) expect(isHomeAddress(ip)).toBe(true);
    for (const ip of ['203.0.113.7', '8.8.8.8', '172.32.0.1', '100.64.1.2', '2001:db8::1', 'not-an-ip']) expect(isHomeAddress(ip)).toBe(false);
    // A VPN between your own devices can count as home too.
    expect(isHomeAddress('100.64.1.2', ['100.64.0.0/10'])).toBe(true);
    expect(parseNetwork('192.168.50.0/24')).toEqual(['192.168.50.0', 24, 'ipv4']);
    expect(parseNetwork('fd7a::/48')).toEqual(['fd7a::', 48, 'ipv6']);
    for (const bad of ['192.168.1.1', '10.0.0.0/33', 'example.com/8', '']) expect(parseNetwork(bad)).toBeNull();
  });
});

// A stand-in for vidalune.com: linked or not, remote access or not, reachable or not.
let linked: boolean;
let allowed: boolean;
let reachable: boolean;
let clock: number;
const fakeService = async (url: string) => {
  if (!reachable) throw new Error('offline');
  const path = new URL(url).pathname;
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
  if (path === '/api/server/register') return json({ id: 'srv-1', secret: 'secret-secret-secret-secret' });
  if (path === '/api/server/code') return json({ code: 'K7F3-Q9MA', expiresAt: clock + 600_000, linkUrl: 'https://vidalune.com/link' });
  if (path === '/api/server/heartbeat') return json({ linked, account: linked ? 'justin@example.com' : null, relay: { enabled: false, allowed, url: null } });
  return json({ ok: true });
};

let env: TestEnv;
let admin: string;
beforeEach(async () => {
  linked = false;
  allowed = false;
  reachable = true;
  clock = Date.now();
  env = await createTestEnv({ fetchImpl: fakeService, cloudNow: () => clock });
  admin = await setupAdmin(env.app, 'justin');
});
afterEach(async () => {
  env.ctx.cloud.shutdown();
  await env.cleanup();
});

/** Playing a file as a device away from home (or at home). The file does not exist: 404 means "let through". */
const play = (ip = '203.0.113.7') => env.app.inject({ method: 'POST', url: '/api/media/999/playback', headers: { cookie: admin }, remoteAddress: ip, payload: {} });
const stream = (ip = '203.0.113.7') => env.app.inject({ url: '/api/media/999/stream', headers: { cookie: admin }, remoteAddress: ip });

describe('playing away from home', () => {
  it('is free at home, and needs a linked server with remote access away from home', async () => {
    expect((await play('192.168.1.20')).statusCode).toBe(404);
    const unlinked = await play();
    expect(unlinked.statusCode).toBe(402);
    expect(unlinked.json().error).toMatch(/links this server to a Vidalune account/);
    expect((await stream()).statusCode).toBe(402);
    // Browsing still works away from home.
    expect((await env.app.inject({ url: '/api/home', headers: { cookie: admin }, remoteAddress: '203.0.113.7' })).statusCode).toBe(200);

    await env.app.inject({ method: 'POST', url: '/api/admin/cloud/link', headers: { cookie: admin } });
    linked = true;
    await env.app.inject({ method: 'POST', url: '/api/admin/cloud/check', headers: { cookie: admin } });
    const noPlan = await play();
    expect(noPlan.statusCode).toBe(402);
    expect(noPlan.json().error).toMatch(/owner of this server does not have/);

    // Given on vidalune.com: the next try asks again (at most every two minutes) and plays.
    allowed = true;
    expect((await play()).statusCode).toBe(402);
    clock += 3 * 60_000;
    expect((await play()).statusCode).toBe(404);
    expect((await env.app.inject({ url: '/api/admin/cloud', headers: { cookie: admin } })).json()).toMatchObject({ remoteAccess: true });
  });

  it('keeps working for a week when vidalune.com cannot be reached, then stops', async () => {
    await env.app.inject({ method: 'POST', url: '/api/admin/cloud/link', headers: { cookie: admin } });
    linked = true;
    allowed = true;
    await env.app.inject({ method: 'POST', url: '/api/admin/cloud/check', headers: { cookie: admin } });
    reachable = false;
    clock += 2 * 24 * 60 * 60_000;
    expect((await play()).statusCode).toBe(404);
    clock += REMOTE_GRACE_MS;
    expect((await play()).statusCode).toBe(402);
    // Taken away on vidalune.com: stops as soon as the server hears it.
    reachable = true;
    allowed = false;
    clock += 3 * 60_000;
    expect((await play()).statusCode).toBe(402);
  });

  it('lets an administrator add home networks, such as a VPN', async () => {
    expect((await play('100.64.1.2')).statusCode).toBe(402);
    const bad = await env.app.inject({ method: 'PUT', url: '/api/admin/cloud/home-networks', headers: { cookie: admin }, payload: { networks: ['example.com'] } });
    expect(bad.statusCode).toBe(400);
    const set = await env.app.inject({ method: 'PUT', url: '/api/admin/cloud/home-networks', headers: { cookie: admin }, payload: { networks: ['100.64.0.0/10', '100.64.0.0/10'] } });
    expect(set.json().homeNetworks).toEqual(['100.64.0.0/10']);
    expect((await play('100.64.1.2')).statusCode).toBe(404);
  });

  it('treats visitors through the relay as away from home', async () => {
    // The relay client on this server passes the visitor's address from loopback.
    const res = await env.app.inject({ method: 'POST', url: '/api/media/999/playback', headers: { cookie: admin, 'x-forwarded-for': '203.0.113.7' }, remoteAddress: '127.0.0.1', payload: {} });
    expect(res.statusCode).toBe(402);
  });
});
