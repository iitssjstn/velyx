import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestEnv, createUser, setupAdmin, type TestEnv } from './helpers.js';
import { auditLog } from '../src/db/schema.js';

// A stand-in for the Vidalune account service (the real one is tested in cloud/).
let linkedTo: string | null;
let calls: Array<{ url: string; method: string; auth: string | null; body: unknown }>;
let reachable: boolean;
const fakeService = async (url: string, init?: RequestInit) => {
  if (!reachable) throw new Error('offline');
  const path = new URL(url).pathname;
  const headers = (init?.headers ?? {}) as Record<string, string>;
  calls.push({ url, method: init?.method ?? 'GET', auth: headers.Authorization ?? null, body: init?.body ? JSON.parse(String(init.body)) : null });
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
  if (path === '/api/server/register') return json({ id: 'srv-1', secret: 'secret-secret-secret-secret' });
  if (path === '/api/server/code') return json({ code: 'K7F3-Q9MA', expiresAt: Date.now() + 600_000, linkUrl: 'https://vidalune.com/link' });
  if (path === '/api/server/heartbeat') return json({ linked: !!linkedTo, account: linkedTo });
  if (path === '/api/server') return json({ ok: true });
  return new Response('{}', { status: 404 });
};

let env: TestEnv;
let admin: string;
beforeEach(async () => {
  linkedTo = null;
  calls = [];
  reachable = true;
  env = await createTestEnv({ fetchImpl: fakeService });
  admin = await setupAdmin(env.app, 'justin');
});
afterEach(async () => {
  env.ctx.cloud.stop();
  await env.cleanup();
});

const post = (url: string, cookie = admin) => env.app.inject({ method: 'POST', url, headers: { cookie } });

describe('linking to a Vidalune account', () => {
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
    expect(calls[0].body).toEqual({ name: 'Vidalune', version: expect.any(String), url: null });

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
