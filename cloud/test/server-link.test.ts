import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildCloudApp, SESSION_COOKIE } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db/client.js';
import { servers } from '../src/db/schema.js';
// The server side of linking, from the Vidalune server itself: both halves talk to each other here.
import { CloudService } from '../../backend/src/services/cloud.js';
import type { CloudLink, SettingsService } from '../../backend/src/services/settings.js';
// Brings the server's request typings along (for type checking only).
import type {} from '../../backend/src/app.js';

let dir: string;
let db: DB;
let app: FastifyInstance;
let stored: { cloud: CloudLink | null };
let cloud: CloudService;
const sent: unknown[] = [];

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-cloud-'));
  db = openDatabase(loadConfig({ DATA_DIR: dir }, { webDir: null }).dbPath);
  app = await buildCloudApp(loadConfig({ DATA_DIR: dir, PUBLIC_URL: 'https://vidalune.example' }, { webDir: null }), db);
  stored = { cloud: null };
  sent.length = 0;
  const settings = {
    get: () => ({ ...stored }),
    update: (patch: Partial<typeof stored>) => Object.assign(stored, patch),
    serverName: () => 'Thuis',
    serverUrl: () => 'https://media.example.com',
  } as unknown as SettingsService;
  cloud = new CloudService({
    baseUrl: 'https://vidalune.example',
    settings,
    version: '0.10.1',
    fetchImpl: async (url, init) => {
      if (init?.body) sent.push(JSON.parse(String(init.body)));
      const res = await app.inject({ method: (init?.method ?? 'GET') as 'GET', url: new URL(String(url)).pathname, headers: init?.headers as Record<string, string>, payload: init?.body as string | undefined });
      return new Response(res.body, { status: res.statusCode, headers: { 'content-type': 'application/json' } });
    },
  });
});
afterEach(async () => {
  cloud.stop();
  await app.close();
  db.$client.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('a Vidalune server and the account service', () => {
  it('link with a code, report in, and unlink', async () => {
    expect(cloud.status()).toMatchObject({ enabled: false, account: null, code: null });

    const waiting = await cloud.link();
    expect(waiting).toMatchObject({ enabled: true, account: null, code: { code: expect.stringMatching(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/) } });
    expect(waiting.code!.linkUrl).toBe(`https://vidalune.example/link#${waiting.code!.code}`);
    expect(stored.cloud).toMatchObject({ serverId: expect.any(String), secret: expect.any(String) });
    // Only name, version and address leave the server.
    for (const body of sent) for (const key of Object.keys(body as object)) expect(['name', 'version', 'url']).toContain(key);
    expect(sent[0]).toEqual({ name: 'Thuis', version: '0.10.1', url: 'https://media.example.com' });

    // Someone signs in on the account page and enters the code.
    const signUp = await app.inject({ method: 'POST', url: '/api/account', payload: { email: 'justin@example.com', password: 'correct-horse' } });
    const cookie = `${SESSION_COOKIE}=${signUp.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
    await app.inject({ method: 'POST', url: '/api/link', headers: { cookie }, payload: { code: waiting.code!.code } });

    expect(await cloud.check()).toMatchObject({ enabled: true, account: 'justin@example.com', code: null });
    expect(stored.cloud!.account).toBe('justin@example.com');
    expect((await app.inject({ url: '/api/servers', headers: { cookie } })).json()).toMatchObject([{ name: 'Thuis', url: 'https://media.example.com', online: true }]);

    expect(await cloud.unlink()).toMatchObject({ enabled: false, account: null });
    expect(stored.cloud).toBeNull();
    expect(db.select().from(servers).all()).toEqual([]);
  });

  it('starts over when the service no longer knows the server', async () => {
    await cloud.link();
    db.delete(servers).run();
    await expect(cloud.check()).rejects.toMatchObject({ statusCode: 409 });
    expect(stored.cloud).toBeNull();
    expect((await cloud.link()).enabled).toBe(true);
  });
});
