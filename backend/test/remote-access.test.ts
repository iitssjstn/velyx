import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestEnv, createUser, setupAdmin, type TestEnv } from './helpers.js';
import { isHomeAddress, isHomeRequest, isPrivateNetwork, isSamePublicAddress, parseNetwork } from '../src/services/remote-access.js';
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

  it('matches only the exact observed public address for a verified same-WAN client', () => {
    expect(isSamePublicAddress('203.0.113.7', '203.0.113.7')).toBe(true);
    expect(isSamePublicAddress('::ffff:203.0.113.7', '203.0.113.7')).toBe(true);
    expect(isSamePublicAddress('2001:4860:4860::8888', '2001:4860:4860:0:0:0:0:8888')).toBe(true);
    expect(isSamePublicAddress('203.0.113.8', '203.0.113.7')).toBe(false);
    expect(isSamePublicAddress('not-an-ip', '203.0.113.7')).toBe(false);
    expect(isSamePublicAddress('203.0.113.7', null)).toBe(false);
  });
});

// A stand-in for vidalune.com: linked or not, remote access or not, reachable or not.
let linked: boolean;
let allowed: boolean;
let reachable: boolean;
/** Users here with a viewer subscription of their own. */
let viewers: string[];
let clock: number;
const fakeService = async (url: string) => {
  if (!reachable) throw new Error('offline');
  const path = new URL(url).pathname;
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
  if (path === '/api/server/register') return json({ id: 'srv-1', secret: 'secret-secret-secret-secret' });
  if (path === '/api/server/code') return json({ code: 'K7F3-Q9MA', expiresAt: clock + 600_000, linkUrl: 'https://vidalune.com/link' });
  if (path === '/api/server/heartbeat') return json({ linked, account: linked ? 'justin@example.com' : null, relay: { enabled: false, allowed, usable: allowed || viewers.length > 0, url: null }, remoteUsers: viewers });
  return json({ ok: true });
};

let env: TestEnv;
let admin: string;
beforeEach(async () => {
  linked = false;
  allowed = false;
  reachable = true;
  viewers = [];
  clock = Date.now();
  env = await createTestEnv({ fetchImpl: fakeService, cloudNow: () => clock });
  admin = await setupAdmin(env.app, 'justin');
});
afterEach(async () => {
  env.ctx.cloud.shutdown();
  await env.cleanup();
});

/** Playback analysis has no media bytes; the file does not exist: 404 means the analysis route was reached. */
const play = (ip = '203.0.113.7') => env.app.inject({ method: 'POST', url: '/api/media/999/playback', headers: { cookie: admin }, remoteAddress: ip, payload: {} });
/** The file does not exist: 404 means remote access passed; 402 means playback is gated. */
const stream = (ip = '203.0.113.7') => env.app.inject({ url: '/api/media/999/stream', headers: { cookie: admin }, remoteAddress: ip });

describe('playing away from home', () => {
  it('is free at home, and needs a linked server with remote access away from home', async () => {
    expect((await play('192.168.1.20')).statusCode).toBe(404);
    expect((await stream('192.168.1.20')).statusCode).toBe(404);
    const unlinked = await stream();
    expect(unlinked.statusCode).toBe(402);
    expect(unlinked.json().error).toMatch(/links this server to a Vidalune account/);
    // Browsing still works away from home.
    expect((await env.app.inject({ url: '/api/home', headers: { cookie: admin }, remoteAddress: '203.0.113.7' })).statusCode).toBe(200);

    await env.app.inject({ method: 'POST', url: '/api/admin/cloud/link', headers: { cookie: admin } });
    linked = true;
    await env.app.inject({ method: 'POST', url: '/api/admin/cloud/check', headers: { cookie: admin } });
    const noPlan = await play();
    expect(noPlan.statusCode).toBe(404);
    expect((await stream()).statusCode).toBe(402);
    expect((await stream('192.168.1.20')).statusCode).toBe(404);

    // Given on vidalune.com: the next try asks again (at most every two minutes) and plays.
    allowed = true;
    expect((await stream()).statusCode).toBe(402);
    clock += 3 * 60_000;
    expect((await stream()).statusCode).toBe(404);
    expect((await env.app.inject({ url: '/api/admin/cloud', headers: { cookie: admin } })).json()).toMatchObject({ remoteAccess: true });
  });

  it('keeps working for a week when vidalune.com cannot be reached, then stops', async () => {
    await env.app.inject({ method: 'POST', url: '/api/admin/cloud/link', headers: { cookie: admin } });
    linked = true;
    allowed = true;
    await env.app.inject({ method: 'POST', url: '/api/admin/cloud/check', headers: { cookie: admin } });
    reachable = false;
    clock += 2 * 24 * 60 * 60_000;
    expect((await stream()).statusCode).toBe(404);
    clock += REMOTE_GRACE_MS;
    expect((await stream()).statusCode).toBe(402);
    // Taken away on vidalune.com: stops as soon as the server hears it.
    reachable = true;
    allowed = false;
    clock += 3 * 60_000;
    expect((await stream()).statusCode).toBe(402);
  });

  it('lets an administrator add home networks, such as a VPN', async () => {
    expect((await stream('100.64.1.2')).statusCode).toBe(402);
    const bad = await env.app.inject({ method: 'PUT', url: '/api/admin/cloud/home-networks', headers: { cookie: admin }, payload: { networks: ['example.com'] } });
    expect(bad.statusCode).toBe(400);
    const set = await env.app.inject({ method: 'PUT', url: '/api/admin/cloud/home-networks', headers: { cookie: admin }, payload: { networks: ['100.64.0.0/10', '100.64.0.0/10'] } });
    expect(set.json().homeNetworks).toEqual(['100.64.0.0/10']);
    expect((await stream('100.64.1.2')).statusCode).toBe(404);
  });

  it('counts the same public WAN IP as home only while the direct port is confirmed open', async () => {
    await env.app.inject({ method: 'POST', url: '/api/admin/cloud/link', headers: { cookie: admin } });
    linked = true;
    await env.app.inject({ method: 'POST', url: '/api/admin/cloud/check', headers: { cookie: admin } });
    const cloud = env.ctx.settings.get().cloud!;
    const directAccess = { configured: true, hostname: 'server.media.vidalune.com', publicIp: '203.0.113.7', port: 18443, dnsReady: true, tlsReady: true, portOpen: true, checkedAt: clock, url: 'https://server.media.vidalune.com:18443' };
    env.ctx.settings.update({ cloud: { ...cloud, directAccess } });

    expect((await stream('203.0.113.7')).statusCode).toBe(404);
    expect((await stream('203.0.113.8')).statusCode).toBe(402);

    env.ctx.settings.update({ cloud: { ...env.ctx.settings.get().cloud!, directAccess: { ...directAccess, portOpen: false, url: null } } });
    expect((await stream('203.0.113.7')).statusCode).toBe(402);
  });

  it('treats visitors through the relay as away from home', async () => {
    // The relay client on this server passes the visitor's address from loopback.
    const res = await env.app.inject({ url: '/api/media/999/stream', headers: { cookie: admin, 'x-forwarded-for': '203.0.113.7' }, remoteAddress: '127.0.0.1' });
    expect(res.statusCode).toBe(402);
  });

  it('lets a viewer with remote access of their own play, when the owner has none', async () => {
    await env.app.inject({ method: 'POST', url: '/api/admin/cloud/link', headers: { cookie: admin } });
    linked = true;
    const lisa = await createUser(env.app, admin, 'lisa');
    const tom = await createUser(env.app, admin, 'tom');
    viewers = [String(lisa.id)];
    await env.app.inject({ method: 'POST', url: '/api/admin/cloud/check', headers: { cookie: admin } });
    const as = (cookie: string) => env.app.inject({ url: '/api/media/999/stream', headers: { cookie }, remoteAddress: '203.0.113.7' });
    expect((await as(lisa.cookie)).statusCode).toBe(404);
    const other = await as(tom.cookie);
    expect(other.statusCode).toBe(402);
    expect(other.json().error).toMatch(/take it for yourself on vidalune\.com/);
    // The relay may be on for her sake.
    expect((await env.app.inject({ url: '/api/admin/cloud', headers: { cookie: admin } })).json().relay.allowed).toBe(true);
  });
});

describe('closing the ways around remote access', () => {
  it('only lets private networks count as home, also ones saved before', () => {
    for (const n of ['192.168.50.0/24', '10.8.0.0/24', '100.64.0.0/10', '100.100.0.0/16', 'fd7a:115c:a1e0::/48']) expect(isPrivateNetwork(n), n).toBe(true);
    for (const n of ['0.0.0.0/0', '0.0.0.0/1', '8.8.8.0/24', '100.0.0.0/8', '192.0.0.0/2', '::/0', '2000::/3', 'nonsense']) expect(isPrivateNetwork(n), n).toBe(false);
    expect(isHomeAddress('8.8.8.8', ['0.0.0.0/0'])).toBe(false);
    expect(isHomeAddress('2001:db8::1', ['::/0'])).toBe(false);
  });

  it('counts a visitor behind a reverse proxy or tunnel on the home network as away', () => {
    const req = (ip: string, headers: Record<string, string> = {}) => ({ ip, socket: { remoteAddress: ip }, headers });
    expect(isHomeRequest(req('192.168.1.20'))).toBe(true);
    expect(isHomeRequest(req('127.0.0.1', { 'x-forwarded-for': '192.168.1.20' }))).toBe(true);
    // A proxy on the home network passes on the visitor from the internet (without TRUST_PROXY).
    expect(isHomeRequest(req('172.18.0.2', { 'x-forwarded-for': '203.0.113.7' }))).toBe(false);
    expect(isHomeRequest(req('127.0.0.1', { 'x-real-ip': '203.0.113.7' }))).toBe(false);
    expect(isHomeRequest(req('127.0.0.1', { 'cf-connecting-ip': '2001:db8::7' }))).toBe(false);
    expect(isHomeRequest(req('127.0.0.1', { forwarded: 'for="[2001:db8::7]:4711";proto=https' }))).toBe(false);
    expect(isHomeRequest(req('127.0.0.1', { forwarded: 'for=unknown' }))).toBe(false);
    // With TRUST_PROXY=true, request.ip is the address a visitor claims; the real one is still in the chain.
    expect(isHomeRequest({ ip: '192.168.1.5', socket: { remoteAddress: '172.18.0.2' }, headers: { 'x-forwarded-for': '192.168.1.5, 203.0.113.7' } })).toBe(false);
    // Straight from the internet, claiming a home address in a header.
    expect(isHomeRequest(req('203.0.113.7', { 'x-forwarded-for': '192.168.1.20' }))).toBe(false);
    expect(isHomeRequest(req('127.0.0.1', { 'x-forwarded-for': '198.51.100.1:5555' }))).toBe(false);
  });
});
