import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildCloudApp, SESSION_COOKIE } from '../src/app.js';
import { DEFAULT_DISCORD_URL } from '../src/community.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db/client.js';

let dir: string;
let db: DB;
let app: FastifyInstance;
let ceo = '';
let customer = '';

async function cookieFor(email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/account', payload: { email, password: 'correct-horse' } });
  return `${SESSION_COOKIE}=${res.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
}

/** The service as it runs on vidalune.com: the website pages included. */
async function start() {
  const config = loadConfig({ DATA_DIR: dir, PUBLIC_URL: 'https://vidalune.example', CEO_EMAILS: 'ceo@example.com' });
  db = openDatabase(config.dbPath);
  app = await buildCloudApp(config, db);
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-community-'));
  await start();
  ceo = await cookieFor('ceo@example.com');
  customer = await cookieFor('someone@example.com');
});

afterEach(async () => {
  await app.close();
  db.$client.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const put = (cookie: string, discordUrl: unknown) => app.inject({ method: 'PUT', url: '/api/ceo/community', headers: { cookie }, payload: { discordUrl } });
const discordLinks = (html: string) => html.match(/href="\/discord"/g)?.length ?? 0;

describe('the Discord link on vidalune.com', () => {
  it('leads to the Vidalune Discord, linked in the menu and footer of every page', async () => {
    const r = await app.inject({ url: '/discord' });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe(DEFAULT_DISCORD_URL);
    expect(discordLinks((await app.inject({ url: '/' })).body)).toBe(2);
    expect(discordLinks((await app.inject({ url: '/install' })).body)).toBe(2);
  });

  it('can be changed or turned off by the CEO only, and is kept after a restart', async () => {
    expect((await app.inject({ url: '/api/ceo/community', headers: { cookie: ceo } })).json()).toEqual({ discordUrl: DEFAULT_DISCORD_URL });
    expect((await app.inject({ url: '/api/ceo/community' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/ceo/community', headers: { cookie: customer } })).statusCode).toBe(403);
    expect((await put(customer, 'https://discord.gg/other')).statusCode).toBe(403);

    // Only Discord invite links: vidalune.com/discord never leads anywhere else.
    for (const bad of ['https://evil.example/discord', 'http://discord.gg/abc', 'javascript:alert(1)', 'https://discord.gg/', 'https://user:pw@discord.gg/abc', 'not a link', 42]) {
      expect((await put(ceo, bad)).statusCode).toBe(400);
    }

    const changed = await put(ceo, '  https://discord.gg/NewInvite  ');
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toEqual({ discordUrl: 'https://discord.gg/NewInvite' });
    expect((await app.inject({ url: '/discord' })).headers.location).toBe('https://discord.gg/NewInvite');

    await app.close();
    db.$client.close();
    await start();
    expect((await app.inject({ url: '/discord' })).headers.location).toBe('https://discord.gg/NewInvite');

    // Empty: the links are hidden and /discord is not found.
    expect((await put(ceo, '')).json()).toEqual({ discordUrl: null });
    expect((await app.inject({ url: '/discord' })).statusCode).toBe(404);
    expect(discordLinks((await app.inject({ url: '/' })).body)).toBe(0);
    expect(discordLinks((await app.inject({ url: '/install' })).body)).toBe(0);
  });
});
