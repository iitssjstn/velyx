import { eq } from 'drizzle-orm';
import type { CloudflareDns } from './cloudflare-dns.js';
import type { DB } from './db/client.js';
import { servers } from './db/schema.js';

/** A linked server that has not reported in for this long, and does not answer, leaves DNS. */
export const SILENT_MS = 24 * 60 * 60_000;
const PROBE_BATCH = 10;

export interface DnsSweep {
  /** Records in the zone after the clean-up. */
  used: number;
  removed: number;
  checkedAt: number;
}

/**
 * Frees the zone's limited record slots. A server's address record goes when the server is gone
 * from the database, no longer linked, or silent for a day and unreachable. Silence on the
 * heartbeat is what counts; the reachability probe only confirms it, because a closed port
 * says nothing about a server that is still running. A returning server gets its record back
 * on its next heartbeat.
 */
export async function sweepDirectDns(options: {
  db: DB;
  dns: Pick<CloudflareDns, 'listRecords' | 'deleteAddress'>;
  directDomain: string;
  now: () => number;
  probe: (hostname: string, port: number) => Promise<boolean>;
  log?: (message: string) => void;
}): Promise<DnsSweep> {
  const { db, dns, now, probe } = options;
  const suffix = `.${options.directDomain.toLowerCase()}`;
  const { total, direct } = await dns.listRecords();
  const names = [...new Set(direct.map((record) => record.name).filter((name) => name.endsWith(suffix)))];
  let removed = 0;

  const remove = async (name: string, id: string, reason: string) => {
    try {
      await dns.deleteAddress(name);
    } catch (err) {
      options.log?.(`Could not remove the DNS record of ${id}: ${(err as Error).message}`);
      return;
    }
    removed += direct.filter((record) => record.name === name).length;
    db.update(servers).set({ directDnsReady: false, directPortOpen: false }).where(eq(servers.id, id)).run();
    options.log?.(`Removed the DNS record of ${id} (${reason})`);
  };

  const silent: Array<{ name: string; id: string; port: number }> = [];
  for (const name of names) {
    const id = name.slice(0, -suffix.length);
    const server = db.select().from(servers).where(eq(servers.id, id)).get();
    if (!server) await remove(name, id, 'unknown server');
    else if (server.accountId === null) await remove(name, id, 'not linked');
    else if (now() - server.lastSeenAt >= SILENT_MS) silent.push({ name, id, port: server.directPort });
  }

  for (let i = 0; i < silent.length; i += PROBE_BATCH) {
    const batch = silent.slice(i, i + PROBE_BATCH);
    const answers = await Promise.all(batch.map((server) => probe(server.name, server.port)));
    for (const [index, server] of batch.entries()) {
      if (!answers[index]) await remove(server.name, server.id, 'silent and unreachable');
    }
  }

  return { used: total - removed, removed, checkedAt: now() };
}
