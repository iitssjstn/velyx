import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { buildCloudApp, SERVER_COOKIE, SESSION_COOKIE } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db/client.js';
import { accounts, servers } from '../src/db/schema.js';
import { clientIp, RESERVED } from '../src/relay.js';
import * as cloudProtocol from '../src/tunnel-protocol.js';
// The other end: a real Vidalune server with its relay client.
import { createTestEnv, type TestEnv } from '../../backend/test/helpers.js';
import { RelayClient } from '../../backend/src/services/relay-client.js';
import * as serverProtocol from '../../backend/src/services/tunnel-protocol.js';
import { auditLog } from '../../backend/src/db/schema.js';
import type {} from '../../backend/src/app.js';

let dir: string;
let db: DB;
let cloud: FastifyInstance;
let cloudPort: number;
let env: TestEnv;
let serverPort: number;
let client: RelayClient;
let frontend: string;
const big = crypto.randomBytes(3 * 1024 * 1024 + 123);

/** A request as a browser at <host> would make it (Node's fetch does not let us set Host). */
function get(host: string, urlPath: string, headers: Record<string, string> = {}, method = 'GET', body?: string) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: cloudPort, path: urlPath, method, headers: { host, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function until(check: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-relay-'));
  frontend = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-frontend-'));
  fs.writeFileSync(path.join(frontend, 'index.html'), '<!doctype html><title>Vidalune</title>');
  fs.writeFileSync(path.join(frontend, 'big.bin'), big);
  fs.mkdirSync(path.join(frontend, 'assets'));
  fs.writeFileSync(path.join(frontend, 'assets', 'app-1234.js'), 'console.log("vidalune")');
  // The account pages (web/) and the web interface: app.relay.test serves both.
  const config = loadConfig({ DATA_DIR: dir, PUBLIC_URL: 'http://relay.test', TRUST_PROXY: '1', ADMIN_EMAILS: 'boss@example.com', FRONTEND_DIR: frontend });
  db = openDatabase(config.dbPath);
  cloud = await buildCloudApp(config, db);
  await cloud.listen({ port: 0, host: '127.0.0.1' });
  cloudPort = (cloud.server.address() as AddressInfo).port;

  env = await createTestEnv({ frontendDir: frontend });
  await env.app.listen({ port: 0, host: '127.0.0.1' });
  serverPort = (env.app.server.address() as AddressInfo).port;
  client = new RelayClient({ cloudUrl: `http://127.0.0.1:${cloudPort}`, localPort: serverPort });
});
afterEach(async () => {
  client.stop();
  await env.app.close();
  await env.cleanup();
  await cloud.close();
  db.$client.close();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(frontend, { recursive: true, force: true });
});

/** Registers a server, links it to an account and turns its relay on. */
async function linkedServerWithRelay() {
  const reg = (await cloud.inject({ method: 'POST', url: '/api/server/register', payload: { name: 'Thuis', version: '0.10.3' } })).json();
  const auth = `Server ${reg.id}:${reg.secret}`;
  expect((await cloud.inject({ method: 'POST', url: '/api/server/relay', headers: { authorization: auth }, payload: { enabled: true } })).statusCode).toBe(409);
  const signUp = await cloud.inject({ method: 'POST', url: '/api/account', payload: { email: 'justin@example.com', password: 'correct-horse' } });
  const cookie = `${SESSION_COOKIE}=${signUp.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
  const { code } = (await cloud.inject({ method: 'POST', url: '/api/server/code', headers: { authorization: auth } })).json();
  await cloud.inject({ method: 'POST', url: '/api/link', headers: { cookie }, payload: { code } });
  // No remote access yet: the relay stays off until a Vidalune administrator gives it.
  const refused = await cloud.inject({ method: 'POST', url: '/api/server/relay', headers: { authorization: auth }, payload: { enabled: true } });
  expect(refused.statusCode).toBe(402);
  const accountId = db.select().from(accounts).where(eq(accounts.email, 'justin@example.com')).get()!.id;
  const bossCookie = await signUpAs('boss@example.com');
  const granted = await cloud.inject({ method: 'PUT', url: `/api/admin/accounts/${accountId}/plan`, headers: { cookie: bossCookie }, payload: { plan: 'remote', until: null, note: 'test' } });
  expect(granted.json()).toMatchObject({ remote: true, plan: 'remote' });
  const relay = (await cloud.inject({ method: 'POST', url: '/api/server/relay', headers: { authorization: auth }, payload: { enabled: true } })).json();
  expect(relay).toMatchObject({ enabled: true, url: expect.stringMatching(/^http:\/\/[a-z0-9]{8}\.relay\.test$/) });
  const slug = new URL(relay.url).hostname.split('.')[0];
  return { id: reg.id as string, auth, cookie, slug, host: `${slug}.relay.test`, accountId, bossCookie };
}

async function signUpAs(email: string) {
  const res = await cloud.inject({ method: 'POST', url: '/api/account', payload: { email, password: 'correct-horse' } });
  return `${SESSION_COOKIE}=${res.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
}

describe('the relay', () => {
  it('uses the same frames on both sides', () => {
    expect(serverProtocol.FRAME).toEqual(cloudProtocol.FRAME);
    expect(serverProtocol.CHUNK).toBe(cloudProtocol.CHUNK);
    expect([...serverProtocol.HOP_BY_HOP]).toEqual([...cloudProtocol.HOP_BY_HOP]);
  });

  it('knows relay addresses, and never gives out reserved names', async () => {
    expect(cloud.relay.slugOf({ headers: { host: 'abcd2345.relay.test' } } as http.IncomingMessage)).toBe('abcd2345');
    expect(cloud.relay.slugOf({ headers: { host: 'app.relay.test' } } as http.IncomingMessage)).toBeNull();
    expect(cloud.relay.slugOf({ headers: { host: 'relay.test' } } as http.IncomingMessage)).toBeNull();
    expect(cloud.relay.slugOf({ headers: { host: 'x.y.relay.test' } } as http.IncomingMessage)).toBeNull();
    expect(RESERVED.has('www')).toBe(true);
    const req = (xff: string) => ({ headers: { 'x-forwarded-for': xff }, socket: { remoteAddress: '10.0.0.2' } }) as unknown as http.IncomingMessage;
    // Behind one proxy: the address that proxy saw, whatever the visitor put in front of it.
    expect(clientIp(req('1.1.1.1, 203.0.113.7'), 1)).toBe('203.0.113.7');
    expect(clientIp(req(''), 0)).toBe('10.0.0.2');
  });

  it('refuses tunnels from servers that are not linked with the relay on', async () => {
    const reg = (await cloud.inject({ method: 'POST', url: '/api/server/register', payload: { name: 'Thuis', version: '0.10.3' } })).json();
    client.start(`Server ${reg.id}:${reg.secret}`);
    await until(() => client.status().error === 'refused');
    client.start(`Server ${reg.id}:${'x'.repeat(43)}`);
    await until(() => client.status().error === 'refused');
    expect(client.status().connected).toBe(false);
  });

  it('brings visitors to the server through the tunnel, large files included', async () => {
    const s = await linkedServerWithRelay();
    // Tunnel not open yet: a clear answer.
    const before = await get(s.host, '/api/server/info');
    expect(before.status).toBe(502);
    expect(before.body.toString()).toMatch(/cannot be reached through the relay/);

    client.start(s.auth);
    await until(() => client.status().connected && cloud.relay.connected(s.id));
    const info = await get(s.host, '/api/server/info');
    expect(info.status).toBe(200);
    expect(JSON.parse(info.body.toString())).toMatchObject({ product: 'Vidalune' });
    // The account service lists the relay address and that it is connected.
    expect((await cloud.inject({ url: '/api/servers', headers: { cookie: s.cookie } })).json()).toMatchObject([{ relayUrl: `http://${s.host}`, relayConnected: true, online: true }]);

    const file = await get(s.host, '/big.bin');
    expect(file.status).toBe(200);
    expect(file.body.equals(big)).toBe(true);
    const range = await get(s.host, '/big.bin', { range: 'bytes=100-199' });
    expect(range.status).toBe(206);
    expect(range.body.equals(big.subarray(100, 200))).toBe(true);
    // Several at once.
    const all = await Promise.all([get(s.host, '/big.bin'), get(s.host, '/api/server/info'), get(s.host, '/big.bin')]);
    expect(all.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(all[2].body.equals(big)).toBe(true);
  });

  it('tells the server who is asking, not what the visitor claims', async () => {
    const s = await linkedServerWithRelay();
    client.start(s.auth);
    await until(() => client.status().connected);
    // What Nginx Proxy Manager in front of the account service adds: the visitor's own claim first.
    const res = await get(s.host, '/api/auth/login', { 'content-type': 'application/json', 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }, 'POST', JSON.stringify({ username: 'nobody', password: 'wrong-password' }));
    expect(res.status).toBe(401);
    const entry = env.ctx.db.select().from(auditLog).where(eq(auditLog.action, 'login.failed')).get();
    expect(entry?.ip).toBe('203.0.113.7');
  });

  it('closes the tunnel when the relay is turned off or the server unlinked', async () => {
    const s = await linkedServerWithRelay();
    client.start(s.auth);
    await until(() => cloud.relay.connected(s.id));
    await cloud.inject({ method: 'POST', url: '/api/server/relay', headers: { authorization: s.auth }, payload: { enabled: false } });
    await until(() => !cloud.relay.connected(s.id));
    expect((await get(s.host, '/api/server/info')).status).toBe(502);
    // On again (same address), then unlinked by the owner on vidalune.com.
    expect((await cloud.inject({ method: 'POST', url: '/api/server/relay', headers: { authorization: s.auth }, payload: { enabled: true } })).json().url).toBe(`http://${s.host}`);
    await until(() => cloud.relay.connected(s.id), 10_000);
    await cloud.inject({ method: 'DELETE', url: `/api/servers/${s.id}`, headers: { cookie: s.cookie } });
    await until(() => !cloud.relay.connected(s.id));
    expect(db.select().from(servers).where(eq(servers.id, s.id)).get()!.relayEnabled).toBe(false);
  });

  it('closes the tunnel when remote access is taken away, and the server learns why', async () => {
    const s = await linkedServerWithRelay();
    client.start(s.auth);
    await until(() => cloud.relay.connected(s.id));
    const taken = await cloud.inject({ method: 'PUT', url: `/api/admin/accounts/${s.accountId}/plan`, headers: { cookie: s.bossCookie }, payload: { plan: 'free' } });
    expect(taken.json()).toMatchObject({ remote: false });
    await until(() => !cloud.relay.connected(s.id));
    expect((await get(s.host, '/api/server/info')).status).toBe(502);
    await until(() => client.status().error === 'subscription', 10_000);
    const beat = (await cloud.inject({ method: 'POST', url: '/api/server/heartbeat', headers: { authorization: s.auth }, payload: { name: 'Thuis', version: '0.10.6' } })).json();
    expect(beat.relay).toMatchObject({ enabled: true, allowed: false, url: null });
    // The server's addresses on vidalune.com no longer include the relay.
    const { addresses } = (await cloud.inject({ method: 'POST', url: `/api/servers/${s.id}/open`, headers: { cookie: s.cookie } })).json();
    expect(addresses).toEqual([]);
  });

  it('shows the web interface on app.<domain> for the chosen server, through its relay', async () => {
    const s = await linkedServerWithRelay();
    client.start(s.auth);
    await until(() => cloud.relay.connected(s.id));
    const app = 'app.relay.test';

    // Nothing chosen (or not signed in): the account pages under /_vl, never a server's answer.
    expect((await get(app, '/')).headers.location).toBe('/_vl/servers');
    expect((await get(app, '/_vl')).headers.location).toBe('/_vl/');
    const page = await get(app, '/_vl/servers');
    expect(page.status).toBe(200);
    expect(page.body.toString()).toContain('src="account.js"');
    expect((await get(app, '/_vl/account.js')).status).toBe(200);
    expect((await get(app, '/api/server/info')).status).toBe(401);
    expect((await get(app, '/sso?ticket=x')).headers.location).toBe('/_vl/servers');
    // The files of the web interface come from the account service itself.
    const asset = await get(app, '/assets/app-1234.js');
    expect(asset.body.toString()).toContain('vidalune');
    expect(asset.headers['cache-control']).toContain('immutable');

    // Choosing the server: remembered in a cookie, then signed in there with a ticket.
    const opened = await get(app, `/_vl/open?server=${s.id}`, { cookie: s.cookie });
    expect(opened.status).toBe(302);
    expect(opened.headers.location).toMatch(/^\/sso\?ticket=[\w-]{20,}$/);
    const chosen = String(opened.headers['set-cookie']).match(new RegExp(`${SERVER_COOKIE}=([^;]+)`))![1];
    expect(chosen).toBe(s.id);
    const cookies = `${s.cookie}; ${SERVER_COOKIE}=${s.id}`;
    // Next time without naming it: the same server.
    expect((await get(app, '/_vl/open', { cookie: cookies })).headers.location).toMatch(/^\/sso\?ticket=/);

    // Now the app itself, and the server's API through the tunnel.
    const home = await get(app, '/library/1', { cookie: cookies });
    expect(home.body.toString()).toContain('<title>Vidalune</title>');
    expect(home.headers['content-security-policy']).toContain("media-src 'self' blob:");
    const info = await get(app, '/api/server/info', { cookie: cookies });
    expect(info.status).toBe(200);
    expect(JSON.parse(info.body.toString())).toMatchObject({ product: 'Vidalune' });
    expect(info.headers['content-security-policy']).toBe("default-src 'none'; sandbox");

    // The server's cookies are kept under its own prefix, and it never sees the account service's.
    const setup = await get(app, '/api/setup', { cookie: cookies, 'content-type': 'application/json', origin: 'http://app.relay.test' }, 'POST', JSON.stringify({ username: 'justin', password: 'correct-horse' }));
    expect(setup.status).toBe(200);
    const serverCookie = String(setup.headers['set-cookie']);
    expect(serverCookie).toMatch(/^s[0-9a-f]{12}_\w+_session=/);
    expect(serverCookie).not.toMatch(/domain=/i);
    const own = serverCookie.split(';')[0];
    const me = await get(app, '/api/auth/me', { cookie: `${cookies}; ${own}` });
    expect(me.status).toBe(200);
    expect((await get(app, '/api/auth/me', { cookie: cookies })).status).toBe(401);

    // Someone else's server cannot be chosen; nor can one without remote access any more.
    const other = await signUpAs('other@example.com');
    expect((await get(app, `/_vl/open?server=${s.id}`, { cookie: other })).headers.location).toBe('/_vl/servers?choose');
    expect((await get(app, '/api/server/info', { cookie: `${other}; ${SERVER_COOKIE}=${s.id}` })).status).toBe(401);
    await cloud.inject({ method: 'PUT', url: `/api/admin/accounts/${s.accountId}/plan`, headers: { cookie: s.bossCookie }, payload: { plan: 'free' } });
    expect((await get(app, '/api/server/info', { cookie: cookies })).status).toBe(401);
    expect((await get(app, '/', { cookie: cookies })).headers.location).toBe('/_vl/servers');
  });

  it('keeps app.<domain> pages to that host', async () => {
    expect((await get('relay.test', '/_app/index.html')).status).toBe(404);
    expect((await get('relay.test', '/_app/assets/app-1234.js')).status).toBe(404);
    expect((await get('relay.test', '/open?server=x')).status).toBe(404);
  });
});
