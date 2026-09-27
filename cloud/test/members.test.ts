import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildCloudApp, SESSION_COOKIE } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type DB } from '../src/db/client.js';
import { tickets } from '../src/db/schema.js';

let dir: string;
let db: DB;
let app: FastifyInstance;
let clock: number;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-cloud-'));
  const config = loadConfig({ DATA_DIR: dir, PUBLIC_URL: 'https://vidalune.example' }, { webDir: null });
  db = openDatabase(config.dbPath);
  clock = Date.now();
  app = await buildCloudApp(config, db, { now: () => clock });
});
afterEach(async () => {
  await app.close();
  db.$client.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function signUp(email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/account', payload: { email, password: 'correct-horse' } });
  return `${SESSION_COOKIE}=${res.cookies.find((c) => c.name === SESSION_COOKIE)!.value}`;
}

/** A server linked by its administrator (user 1 there) to the owner's account. */
async function linkedServer() {
  const reg = (await app.inject({ method: 'POST', url: '/api/server/register', payload: { name: 'Thuis', version: '0.10.5', url: 'https://media.example.com' } })).json();
  const auth = `Server ${reg.id}:${reg.secret}`;
  const owner = await signUp('owner@example.com');
  const { code } = (await app.inject({ method: 'POST', url: '/api/server/code', headers: { authorization: auth }, payload: { userRef: '1' } })).json();
  await app.inject({ method: 'POST', url: '/api/link', headers: { cookie: owner }, payload: { code } });
  return { id: reg.id as string, auth, owner };
}

const open = (cookie: string, id: string) => app.inject({ method: 'POST', url: `/api/servers/${id}/open`, headers: { cookie } });
const redeem = (auth: string, ticket: string) => app.inject({ method: 'POST', url: '/api/server/ticket', headers: { authorization: auth }, payload: { ticket } });

describe('signing in on a server with a Vidalune account', () => {
  it('lets the administrator who linked the server open it as themselves', async () => {
    const s = await linkedServer();
    const opened = (await open(s.owner, s.id)).json();
    expect(opened).toMatchObject({ ticket: expect.any(String), addresses: ['https://media.example.com'] });
    expect((await redeem(s.auth, opened.ticket)).json()).toEqual({ email: 'owner@example.com', userRef: '1' });
    // Once only.
    expect((await redeem(s.auth, opened.ticket)).statusCode).toBe(401);
  });

  it('only works for the server it was made for, within a minute, and only for people who may use it', async () => {
    const s = await linkedServer();
    const other = (await app.inject({ method: 'POST', url: '/api/server/register', payload: { name: 'Buren', version: '0.10.5' } })).json();
    const { ticket } = (await open(s.owner, s.id)).json();
    expect((await redeem(`Server ${other.id}:${other.secret}`, ticket)).statusCode).toBe(401);
    const late = (await open(s.owner, s.id)).json();
    clock += 61_000;
    expect((await redeem(s.auth, late.ticket)).statusCode).toBe(401);
    // A stranger cannot open it at all.
    const stranger = await signUp('stranger@example.com');
    expect((await open(stranger, s.id)).statusCode).toBe(404);
    expect(db.select().from(tickets).all().length).toBeLessThanOrEqual(1);
  });

  it('lets other users of the server connect their own account, see it, open it and leave', async () => {
    const s = await linkedServer();
    const family = await signUp('family@example.com');
    expect((await app.inject({ url: '/api/servers', headers: { cookie: family } })).json()).toEqual([]);
    const issued = (await app.inject({ method: 'POST', url: '/api/server/member-code', headers: { authorization: s.auth }, payload: { userRef: '7' } })).json();
    expect(issued).toMatchObject({ code: expect.any(String), linkUrl: 'https://vidalune.example/join' });
    expect((await app.inject({ method: 'POST', url: '/api/join', headers: { cookie: family }, payload: { code: issued.code } })).json()).toMatchObject({ name: 'Thuis' });
    expect((await app.inject({ url: '/api/servers', headers: { cookie: family } })).json()).toMatchObject([{ id: s.id, role: 'member' }]);
    expect((await app.inject({ url: '/api/servers', headers: { cookie: s.owner } })).json()).toMatchObject([{ id: s.id, role: 'owner' }]);
    expect((await app.inject({ url: '/api/server/members', headers: { authorization: s.auth } })).json()).toEqual(
      expect.arrayContaining([{ userRef: '1', email: 'owner@example.com' }, { userRef: '7', email: 'family@example.com' }]),
    );
    const { ticket } = (await open(family, s.id)).json();
    expect((await redeem(s.auth, ticket)).json()).toEqual({ email: 'family@example.com', userRef: '7' });
    // Leaving does not unlink the server for its owner.
    expect((await app.inject({ method: 'DELETE', url: `/api/servers/${s.id}`, headers: { cookie: family } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/servers', headers: { cookie: family } })).json()).toEqual([]);
    expect((await app.inject({ url: '/api/servers', headers: { cookie: s.owner } })).json()).toHaveLength(1);
  });

  it('lets the server remove a user\'s account, and refuses member codes before linking', async () => {
    const s = await linkedServer();
    await app.inject({ method: 'DELETE', url: '/api/server/members/1', headers: { authorization: s.auth } });
    const { ticket } = (await open(s.owner, s.id)).json();
    // Still the owner, but no user there any more: the server asks for a password instead.
    expect((await redeem(s.auth, ticket)).json()).toEqual({ email: 'owner@example.com', userRef: null });
    const lone = (await app.inject({ method: 'POST', url: '/api/server/register', payload: { name: 'Los', version: '0.10.5' } })).json();
    expect((await app.inject({ method: 'POST', url: '/api/server/member-code', headers: { authorization: `Server ${lone.id}:${lone.secret}` }, payload: { userRef: '1' } })).statusCode).toBe(409);
  });
});
