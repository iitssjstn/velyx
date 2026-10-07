import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildCloudApp, SESSION_COOKIE } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db/client.js';
import { servers } from '../src/db/schema.js';

let dir: string;
let db: DB;
let app: FastifyInstance;
afterEach(async () => {
  if (app) await app.close();
  if (db) db.$client.close();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

async function setup(fetchImpl: typeof fetch, directCertificateIssuer?: { issue(hostname: string, csr: string): Promise<string> }) {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-direct-'));
  const config = loadConfig({
    DATA_DIR: dir,
    PUBLIC_URL: 'https://vidalune.com',
    CLOUDFLARE_API_TOKEN: 'test-token',
    DIRECT_DOMAIN: 'media.vidalune.com',
  }, { webDir: null, frontendDir: null });
  db = openDatabase(config.dbPath);
  app = await buildCloudApp(config, db, { fetchImpl, directCertificateIssuer });
  const registration = await app.inject({ method: 'POST', url: '/api/server/register', payload: { name: 'Thuis', version: '0.19.27' } });
  const { id, secret } = registration.json();
  return { id, auth: `Server ${id}:${secret}` };
}

async function linkServer(auth: string) {
  const account = await app.inject({ method: 'POST', url: '/api/account', payload: { email: 'owner@example.com', password: 'correct-horse' } });
  const cookie = `${SESSION_COOKIE}=${account.cookies.find((entry) => entry.name === SESSION_COOKIE)!.value}`;
  const link = await app.inject({ method: 'POST', url: '/api/server/code', headers: { authorization: auth } });
  const result = await app.inject({ method: 'POST', url: '/api/link', headers: { cookie }, payload: { code: link.json().code } });
  expect(result.statusCode).toBe(200);
  return cookie;
}

describe('automatic direct DNS', () => {
  it('rejects a public address mislabeled as a LAN endpoint', async () => {
    const { auth } = await setup(async () => { throw new Error('Invalid endpoints must be rejected before network calls.'); });
    await linkServer(auth);
    const response = await app.inject({ method: 'POST', url: '/api/server/heartbeat', headers: { authorization: auth }, payload: { name: 'Thuis', version: '0.19.29', localEndpoints: [{ type: 'lan', address: '8.8.8.8', port: 32400, protocol: 'https' }] } });
    expect(response.statusCode).toBe(400);
  });

  it('sets an unproxied server hostname from the address observed by the account service', async () => {
    const writes: Array<Record<string, unknown>> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/zones') && !init?.method) return Response.json({ success: true, result: [{ id: 'zone-1', name: 'vidalune.com' }] });
      if (url.pathname.endsWith('/dns_records') && !init?.method) return Response.json({ success: true, result: [] });
      if (url.pathname.endsWith('/dns_records') && init?.method === 'POST') {
        writes.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return Response.json({ success: true, result: { id: 'record-1' } });
      }
      throw new Error(`Unexpected Cloudflare request: ${url.pathname}`);
    };
    const { id, auth } = await setup(fetchImpl);
    const cookie = await linkServer(auth);

    const heartbeat = await app.inject({
      method: 'POST',
      url: '/api/server/heartbeat',
      headers: { authorization: auth },
      remoteAddress: '8.8.8.8',
      payload: { name: 'Thuis', version: '0.19.29', publicIp: '203.0.113.99', localEndpoints: [{ type: 'lan', address: '192.168.1.50', port: 32400, protocol: 'https' }] },
    });

    expect(heartbeat.statusCode).toBe(200);
    expect(heartbeat.json().directAccess).toMatchObject({ hostname: `${id}.media.vidalune.com`, dnsReady: true });
    expect(heartbeat.json().directAccess.localEndpoints).toEqual([{ type: 'lan', address: '192.168.1.50', port: 32400, protocol: 'https' }]);
    expect(heartbeat.json().directAccess.endpoints).toContainEqual(expect.objectContaining({ type: 'public', address: '8.8.8.8', protocol: 'https' }));
    expect(writes).toEqual([expect.objectContaining({ type: 'A', name: `${id}.media.vidalune.com`, content: '8.8.8.8', proxied: false })]);
    expect(db.select().from(servers).get()?.publicIp).toBe('8.8.8.8');
    const listed = (await app.inject({ url: '/api/servers', headers: { cookie } })).json();
    expect(listed[0].endpoints[0]).toMatchObject({ type: 'lan', address: '192.168.1.50', port: 32400, protocol: 'https' });
    const opened = await app.inject({ method: 'POST', url: `/api/servers/${id}/open`, headers: { cookie } });
    expect(opened.json().addresses[0]).toBe('https://192.168.1.50:32400');
    expect(opened.json().endpoints).toEqual(listed[0].endpoints);
    expect((await app.inject({ url: '/api/servers', headers: { cookie: `${SESSION_COOKIE}=invalid` } })).statusCode).toBe(401);
    expect(JSON.stringify(heartbeat.json())).not.toContain('test-token');
  });

  it('does not create DNS for a private heartbeat source address', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error('Cloudflare must not be contacted for a private source address.');
    };
    const { auth } = await setup(fetchImpl);
    await linkServer(auth);
    const heartbeat = await app.inject({
      method: 'POST',
      url: '/api/server/heartbeat',
      headers: { authorization: auth },
      remoteAddress: '192.168.1.20',
      payload: { name: 'Thuis', version: '0.19.27' },
    });
    expect(heartbeat.statusCode).toBe(200);
    expect(heartbeat.json().directAccess.dnsReady).toBe(false);
  });

  it('publishes a direct URL only after the external TLS port answers the health probe', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/zones') && !init?.method) return Response.json({ success: true, result: [{ id: 'zone-1', name: 'vidalune.com' }] });
      if (url.pathname.endsWith('/dns_records') && !init?.method) return Response.json({ success: true, result: [] });
      if (url.pathname.endsWith('/dns_records') && init?.method === 'POST') return Response.json({ success: true, result: { id: 'record-1' } });
      if (url.hostname.endsWith('.media.vidalune.com') && url.port === '32400' && url.pathname === '/api/server/direct/health') return new Response(null, { status: 204 });
      throw new Error(`Unexpected direct access request: ${url.origin}${url.pathname}`);
    };
    const { id, auth } = await setup(fetchImpl);
    await linkServer(auth);
    const heartbeat = await app.inject({
      method: 'POST',
      url: '/api/server/heartbeat',
      headers: { authorization: auth },
      remoteAddress: '8.8.8.8',
      payload: { name: 'Thuis', version: '0.19.27', directPort: 32400, directTlsReady: true },
    });
    expect(heartbeat.json().directAccess).toMatchObject({
      hostname: `${id}.media.vidalune.com`,
      port: 32400,
      dnsReady: true,
      tlsReady: true,
      portOpen: true,
      url: `https://${id}.media.vidalune.com:32400`,
    });
  });

  it('does not publish a direct URL when the external port probe fails', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/zones') && !init?.method) return Response.json({ success: true, result: [{ id: 'zone-1', name: 'vidalune.com' }] });
      if (url.pathname.endsWith('/dns_records') && !init?.method) return Response.json({ success: true, result: [] });
      if (url.pathname.endsWith('/dns_records') && init?.method === 'POST') return Response.json({ success: true, result: { id: 'record-1' } });
      if (url.pathname === '/api/server/direct/health') return new Response(null, { status: 502 });
      throw new Error(`Unexpected direct access request: ${url.pathname}`);
    };
    const { auth } = await setup(fetchImpl);
    await linkServer(auth);
    const heartbeat = await app.inject({ method: 'POST', url: '/api/server/heartbeat', headers: { authorization: auth }, remoteAddress: '8.8.8.8', payload: { name: 'Thuis', version: '0.19.27', directPort: 32400, directTlsReady: true } });
    expect(heartbeat.json().directAccess).toMatchObject({ dnsReady: true, tlsReady: true, portOpen: false, url: null });
  });

  it('removes the automatic address after the server is unlinked', async () => {
    const records = [{ id: 'record-1', type: 'A', name: 'placeholder', content: '8.8.8.8', proxied: false }];
    const deleted: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/zones') && !init?.method) return Response.json({ success: true, result: [{ id: 'zone-1', name: 'vidalune.com' }] });
      if (url.pathname.endsWith('/dns_records') && !init?.method) return Response.json({ success: true, result: records });
      if (init?.method === 'DELETE') {
        deleted.push(url.pathname.split('/').at(-1)!);
        return Response.json({ success: true, result: { id: deleted.at(-1) } });
      }
      throw new Error(`Unexpected Cloudflare request: ${url.pathname}`);
    };
    const { id, auth } = await setup(fetchImpl);
    await linkServer(auth);
    db.update(servers).set({ accountId: null }).where(eq(servers.id, id)).run();

    const heartbeat = await app.inject({ method: 'POST', url: '/api/server/heartbeat', headers: { authorization: auth }, remoteAddress: '8.8.8.8', payload: { name: 'Thuis', version: '0.19.27' } });
    expect(heartbeat.statusCode).toBe(200);
    expect(deleted).toEqual(['record-1']);
    expect(heartbeat.json().directAccess.dnsReady).toBe(false);
  });

  it('issues a certificate only for a linked server after its direct DNS is ready', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/zones') && !init?.method) return Response.json({ success: true, result: [{ id: 'zone-1', name: 'vidalune.com' }] });
      if (url.pathname.endsWith('/dns_records') && !init?.method) return Response.json({ success: true, result: [] });
      if (url.pathname.endsWith('/dns_records') && init?.method === 'POST') return Response.json({ success: true, result: { id: 'record-1' } });
      throw new Error(`Unexpected Cloudflare request: ${url.pathname}`);
    };
    const issued: Array<{ hostname: string; csr: string }> = [];
    const { id, auth } = await setup(fetchImpl, { issue: async (hostname, csr) => { issued.push({ hostname, csr }); return 'certificate-chain'; } });
    await linkServer(auth);
    await app.inject({ method: 'POST', url: '/api/server/heartbeat', headers: { authorization: auth }, remoteAddress: '8.8.8.8', payload: { name: 'Thuis', version: '0.19.27' } });

    const response = await app.inject({ method: 'POST', url: '/api/server/direct/certificate', headers: { authorization: auth }, payload: { csr: 'server-csr' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ hostname: `${id}.media.vidalune.com`, certificate: 'certificate-chain' });
    expect(issued).toEqual([{ hostname: `${id}.media.vidalune.com`, csr: 'server-csr' }]);
  });
});