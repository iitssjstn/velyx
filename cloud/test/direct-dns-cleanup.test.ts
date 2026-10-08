import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDatabase, type DB } from '../src/db/client.js';
import { accounts, servers } from '../src/db/schema.js';
import { SILENT_MS, sweepDirectDns } from '../src/direct-dns-cleanup.js';

const NOW = 1_800_000_000_000;
let dir: string;
let db: DB;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidalune-dns-sweep-'));
  db = openDatabase(path.join(dir, 'cloud.db'));
});
afterEach(() => {
  db.$client.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function addServer(id: string, options: { linked: boolean; lastSeenAt: number; port?: number }) {
  const accountId = options.linked
    ? (db.select().from(accounts).get()?.id ?? db.insert(accounts).values({ email: 'owner@example.com', passwordHash: 'x', createdAt: NOW }).returning().get().id)
    : null;
  db.insert(servers).values({ id, secretHash: 'x', accountId, name: id, version: '0.19.42', directPort: options.port ?? 32400, directDnsReady: true, directPortOpen: true, createdAt: NOW, lastSeenAt: options.lastSeenAt }).run();
}

function sweep(records: string[], probe: (hostname: string, port: number) => boolean = () => true, extra = 0) {
  const deleted: string[] = [];
  const probed: string[] = [];
  const result = sweepDirectDns({
    db,
    directDomain: 'media.vidalune.com',
    now: () => NOW,
    dns: {
      listRecords: async () => ({ total: records.length + extra, direct: records.map((name) => ({ name, type: 'A' as const })) }),
      deleteAddress: async (name: string) => { deleted.push(name); },
    },
    probe: async (hostname, port) => { probed.push(`${hostname}:${port}`); return probe(hostname, port); },
  });
  return { result, deleted, probed };
}

describe('direct DNS clean-up', () => {
  it('keeps the record of a linked server that reported recently, without probing it', async () => {
    addServer('live', { linked: true, lastSeenAt: NOW - 60_000 });
    const { result, deleted, probed } = sweep(['live.media.vidalune.com']);
    expect(await result).toMatchObject({ used: 1, removed: 0 });
    expect(deleted).toEqual([]);
    expect(probed).toEqual([]);
  });

  it('removes records of servers that are gone from the database or no longer linked', async () => {
    addServer('unlinked', { linked: false, lastSeenAt: NOW });
    const { result, deleted, probed } = sweep(['ghost.media.vidalune.com', 'unlinked.media.vidalune.com'], () => true, 14);
    expect(await result).toMatchObject({ used: 14, removed: 2 });
    expect(deleted).toEqual(['ghost.media.vidalune.com', 'unlinked.media.vidalune.com']);
    expect(probed).toEqual([]);
    expect(db.select().from(servers).where(eq(servers.id, 'unlinked')).get()).toMatchObject({ directDnsReady: false, directPortOpen: false });
  });

  it('removes a silent server that does not answer, and keeps one that does', async () => {
    addServer('gone', { linked: true, lastSeenAt: NOW - SILENT_MS - 1, port: 443 });
    addServer('quiet', { linked: true, lastSeenAt: NOW - SILENT_MS - 1 });
    const { result, deleted, probed } = sweep(['gone.media.vidalune.com', 'quiet.media.vidalune.com'], (hostname) => hostname.startsWith('quiet'));
    expect(await result).toMatchObject({ used: 1, removed: 1 });
    expect(probed).toEqual(['gone.media.vidalune.com:443', 'quiet.media.vidalune.com:32400']);
    expect(deleted).toEqual(['gone.media.vidalune.com']);
    expect(db.select().from(servers).where(eq(servers.id, 'quiet')).get()?.directDnsReady).toBe(true);
  });

  it('leaves records outside the direct domain alone', async () => {
    const { result, deleted } = sweep(['www.vidalune.com', 'x.other.example']);
    expect(await result).toMatchObject({ removed: 0 });
    expect(deleted).toEqual([]);
  });
});
