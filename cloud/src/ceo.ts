import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from './db/client.js';
import { accessGrants, accountActivity, accountSessions, accounts, ceoEvents, relayNodes, relaySamples, relayTraffic, servers } from './db/schema.js';
import type { RelayClient } from './relay.js';

/**
 * The CEO Control Center (/ceo): the business side of Vidalune. Customers (how many, active, new,
 * growth; added, suspended), access (who has what, why and until when; given, changed, extended
 * and taken back by hand, ready for billing later), relays (capacity, health, uptime, which
 * customers, servers and clients use which, traffic over time) and figures over time. Only real
 * data from this service: no revenue until payments exist, no guesses. Every call checks that the
 * signed-in account is one of CEO_EMAILS, and every change is written to the activity list.
 */

export class CeoError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** An account counts as active when it used Vidalune (website or app) in this many days. */
export const ACTIVE_DAYS = 30;
/** Access "ends soon" within this many days. */
export const EXPIRING_DAYS = 14;
/** How often the relays are checked and their state written down. */
export const SAMPLE_MS = 5 * 60_000;
/** Samples are kept this long. */
const SAMPLES_KEPT_MS = 35 * DAY;
/** A relay counts as degraded from this load (percent of its capacity). */
export const DEGRADED_LOAD = 90;

type Account = typeof accounts.$inferSelect;
type Grant = typeof accessGrants.$inferSelect;
type Node = typeof relayNodes.$inferSelect;
export type AccessType = Grant['type'];
export type RelayStatus = 'online' | 'degraded' | 'offline' | 'unknown' | 'disabled';
export type GrantStatus = 'scheduled' | 'active' | 'expiring' | 'expired' | 'revoked';
export type CustomerStatus = 'active' | 'inactive' | 'suspended';

export interface CeoDeps {
  db: DB;
  account: (request: FastifyRequest) => Account;
  isCeo: (a: Account) => boolean;
  now: () => number;
  /** The main relay's total capacity (RELAY_MAX_MBPS). */
  mainCapacityMbps: number;
  relay: {
    flush(): void;
    now(): { bps: Map<string, number>; tunnels: number; active: number };
    connected(serverId: string): boolean;
    connectedSince(serverId: string): number | null;
    clients(serverId: string): RelayClient[];
    snapshots(): Array<Map<string, number>>;
    refreshLimit(serverId: string): void;
  };
  /** The default limit per server (RELAY_SERVER_MBPS; 0: none). */
  defaultServerMbps: number;
  /** Access changed: tunnels of servers that lost it close now. */
  accessChanged: () => void;
  /** Signs an account out everywhere (suspended). */
  signOut: (accountId: number) => void;
  /** Health checks of other relays (tests pass their own). */
  fetchImpl?: typeof fetch;
  /** DNS records in use against the zone's limit, as of the last clean-up (null: not known). */
  directDnsUsage?: () => { used: number; limit: number; checkedAt: number } | null;
}

/** The grant that counts now: not taken back, started, not ended (the latest one when several). */
export function activeGrant(grants: Grant[], now: number): Grant | null {
  return (
    grants
      .filter((g) => g.revokedAt === null && g.startsAt <= now && (g.endsAt === null || g.endsAt > now))
      .sort((a, b) => b.startsAt - a.startsAt || b.id - a.id)[0] ?? null
  );
}

/** Where a grant stands now. */
export function grantStatus(g: Pick<Grant, 'startsAt' | 'endsAt' | 'revokedAt'>, now: number): GrantStatus {
  if (g.revokedAt !== null) return 'revoked';
  if (g.startsAt > now) return 'scheduled';
  if (g.endsAt !== null && g.endsAt <= now) return 'expired';
  if (g.endsAt !== null && g.endsAt < now + EXPIRING_DAYS * DAY) return 'expiring';
  return 'active';
}

/** Growth between two periods, in percent (null: nothing to compare with). */
export function growth(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Days from `from` to `to` (inclusive), YYYY-MM-DD. */
export function daysBetween(from: number, to: number): string[] {
  const out: string[] = [];
  for (let t = Date.parse(dayOf(from)); t <= to; t += DAY) out.push(dayOf(t));
  return out;
}

/**
 * A relay's state: turned off; the main relay (this service) is up while this runs; another relay
 * by its last health check. Degraded when nearly full or over its hosting's monthly allowance.
 */
export function relayStatus(n: Pick<Node, 'active' | 'lastCheckAt' | 'lastSeenAt'>, main: boolean, load: { usage: number | null; overQuota: boolean }): RelayStatus {
  if (!n.active) return 'disabled';
  if (!main) {
    if (n.lastCheckAt === null) return 'unknown';
    if (n.lastSeenAt === null || n.lastSeenAt < n.lastCheckAt) return 'offline';
  }
  return (load.usage !== null && load.usage >= DEGRADED_LOAD) || load.overQuota ? 'degraded' : 'online';
}

/**
 * Uptime in percent over [from, to]: the five-minute samples in which the relay was up, out of those
 * since the first sample (a relay added later is not counted down for before). Null without samples.
 */
export function uptime(samples: Array<{ at: number; up: boolean }>, from: number, to: number): number | null {
  // The samples whose five minutes fall in the range.
  const inRange = samples.filter((s) => s.at > from - SAMPLE_MS && s.at <= to);
  if (!inRange.length) return null;
  const start = Math.max(from, Math.min(...inRange.map((s) => s.at)));
  // Every five minutes since then; the current five minutes only once they were sampled.
  const current = to - (to % SAMPLE_MS);
  const expected = Math.max(1, Math.floor((to - start) / SAMPLE_MS) + (inRange.some((s) => s.at >= current) ? 1 : 0));
  const up = inRange.filter((s) => s.up).length;
  return Math.round(Math.min(1, up / expected) * 10_000) / 100;
}

const accessType = z.enum(['customer', 'beta', 'test', 'free']);
const plan = z.enum(['remote', 'viewer']);
const id = z.coerce.number().int().positive();
const note = z.string().trim().max(300).nullable().default(null);
const when = z.number().int().positive();
const mbps = (bps: number) => Math.round((bps * 8) / 10_000) / 100;
const ranges = { '1h': HOUR, '6h': 6 * HOUR, '24h': 24 * HOUR, '7d': 7 * DAY, '30d': 30 * DAY } as const;
/** Points on a chart per range: raw samples up to a day, hours for a week, six hours for a month. */
const BUCKET = { '1h': SAMPLE_MS, '6h': SAMPLE_MS, '24h': SAMPLE_MS, '7d': HOUR, '30d': 6 * HOUR } as const;

export function ceoRoutes(app: FastifyInstance, deps: CeoDeps): { monitor: () => Promise<void> } {
  const { db } = deps;

  const ceo = (request: FastifyRequest) => {
    const me = deps.account(request);
    if (!deps.isCeo(me)) throw new CeoError(403, 'Only for the CEO of Vidalune.');
    return me;
  };

  /** Writes down what happened (who, what, to whom, and the details). */
  const record = (actor: string, action: string, target: string, detail?: Record<string, unknown>) =>
    db.insert(ceoEvents).values({ at: deps.now(), actor, action, target, detail: detail ? JSON.stringify(detail) : null }).run();

  /** The main relay (vidalune.com itself) always exists. */
  const mainRelay = () => {
    const found = db.select().from(relayNodes).where(isNull(relayNodes.url)).orderBy(relayNodes.id).get();
    if (found) return found;
    return db.insert(relayNodes).values({ name: 'vidalune.com', region: null, url: null, capacityMbps: deps.mainCapacityMbps || 1000, note: null, active: true, createdAt: deps.now() }).returning().get();
  };

  const grantsOf = (accountIds: number[]) => {
    const map = new Map<number, Grant[]>();
    if (!accountIds.length) return map;
    for (const g of db.select().from(accessGrants).where(inArray(accessGrants.accountId, accountIds)).all()) {
      const list = map.get(g.accountId);
      if (list) list.push(g);
      else map.set(g.accountId, [g]);
    }
    return map;
  };

  const lastActive = (accountIds: number[]) => {
    if (!accountIds.length) return new Map<number, string>();
    return new Map(
      db
        .select({ accountId: accountActivity.accountId, day: sql<string>`max(${accountActivity.day})` })
        .from(accountActivity)
        .where(inArray(accountActivity.accountId, accountIds))
        .groupBy(accountActivity.accountId)
        .all()
        .map((r) => [r.accountId, r.day]),
    );
  };

  /** Puts an account's plan in line with its active grant (none: no remote access). */
  const applyGrants = (accountId: number, by: string) => {
    const t = deps.now();
    const g = activeGrant(db.select().from(accessGrants).where(eq(accessGrants.accountId, accountId)).all(), t);
    db.update(accounts)
      .set(g ? { plan: g.plan, planUntil: g.endsAt, planNote: g.note ?? `${g.type} (${by})`, planChangedAt: t } : { plan: 'free', planUntil: null, planNote: null, planChangedAt: t })
      .where(eq(accounts.id, accountId))
      .run();
    deps.accessChanged();
  };

  const grantView = (g: Grant, owner?: { email: string; name: string | null }) => ({
    id: g.id,
    accountId: g.accountId,
    ...(owner ? { email: owner.email, name: owner.name } : {}),
    type: g.type,
    plan: g.plan,
    startsAt: g.startsAt,
    endsAt: g.endsAt,
    status: grantStatus(g, deps.now()),
    note: g.note,
    grantedBy: g.grantedBy,
    createdAt: g.createdAt,
    revokedAt: g.revokedAt,
    revokedBy: g.revokedBy,
    source: g.source,
  });

  const accountOf = (accountId: number) => {
    const a = db.select().from(accounts).where(eq(accounts.id, accountId)).get();
    if (!a) throw new CeoError(404, 'This customer does not exist (any more).');
    return a;
  };
  const who = (a: Pick<Account, 'email' | 'name'>) => (a.name ? `${a.name} <${a.email}>` : a.email);

  // ---- relays: figures per relay (servers, customers, clients, traffic)

  const nodeOf = (s: { relayNodeId: number | null; accountRelay: number | null }, mainId: number) => s.relayNodeId ?? s.accountRelay ?? mainId;

  const relayStats = (nodeIds: number[]) => {
    deps.relay.flush();
    const main = mainRelay();
    const t = deps.now();
    const since = dayOf(t - 29 * DAY);
    const all = db
      .select({ id: servers.id, name: servers.name, accountId: servers.accountId, relayNodeId: servers.relayNodeId, accountRelay: accounts.relayNodeId, relayEnabled: servers.relayEnabled, lastSeenAt: servers.lastSeenAt, limitMbps: servers.relayLimitMbps, email: accounts.email, ownerName: accounts.name })
      .from(servers)
      .leftJoin(accounts, eq(accounts.id, servers.accountId))
      .where(isNotNull(servers.relaySlug))
      .all();
    const month = new Map(
      db
        .select({ serverId: relayTraffic.serverId, out: sql<number>`sum(${relayTraffic.bytesOut})`, errors: sql<number>`sum(${relayTraffic.errors})`, requests: sql<number>`sum(${relayTraffic.requests})` })
        .from(relayTraffic)
        .where(gte(relayTraffic.day, since))
        .groupBy(relayTraffic.serverId)
        .all()
        .map((r) => [r.serverId, r]),
    );
    // This calendar month (UTC): what counts against a hosting's monthly traffic allowance.
    const monthStart = dayOf(t).slice(0, 8) + '01';
    const calendar = new Map(
      db
        .select({ serverId: relayTraffic.serverId, out: sql<number>`sum(${relayTraffic.bytesOut})` })
        .from(relayTraffic)
        .where(gte(relayTraffic.day, monthStart))
        .groupBy(relayTraffic.serverId)
        .all()
        .map((r) => [r.serverId, Number(r.out)]),
    );
    const live = deps.relay.now();
    return new Map(
      nodeIds.map((nid) => {
        const assigned = all.filter((s) => nodeOf(s, main.id) === nid);
        const clients = assigned.flatMap((s) => deps.relay.clients(s.id).map((c) => ({ ...c, serverId: s.id })));
        return [
          nid,
          {
            servers: assigned.length,
            customers: new Set(assigned.map((s) => s.accountId).filter(Boolean)).size,
            connected: assigned.filter((s) => deps.relay.connected(s.id)).length,
            clients: clients.length,
            clientList: clients,
            mbpsNow: mbps(assigned.reduce((n, s) => n + (live.bps.get(s.id) ?? 0), 0)),
            month: {
              out: assigned.reduce((n, s) => n + Number(month.get(s.id)?.out ?? 0), 0),
              requests: assigned.reduce((n, s) => n + Number(month.get(s.id)?.requests ?? 0), 0),
              errors: assigned.reduce((n, s) => n + Number(month.get(s.id)?.errors ?? 0), 0),
            },
            thisMonthOut: assigned.reduce((n, s) => n + (calendar.get(s.id) ?? 0), 0),
            assigned,
          },
        ] as const;
      }),
    );
  };
  type Stats = ReturnType<typeof relayStats> extends Map<number, infer V> ? V : never;

  const samplesOf = (nodeIds: number[], from: number) =>
    nodeIds.length ? db.select().from(relaySamples).where(and(inArray(relaySamples.nodeId, nodeIds), gte(relaySamples.at, from - SAMPLE_MS))).orderBy(relaySamples.at).all() : [];

  const nodeView = (n: Node, s: Stats, mainId: number, samples: Array<typeof relaySamples.$inferSelect>) => {
    const t = deps.now();
    const usage = n.capacityMbps ? Math.round((s.mbpsNow / n.capacityMbps) * 1000) / 10 : 0;
    const usedPercent = n.monthlyQuotaGb ? Math.round((s.thisMonthOut / (n.monthlyQuotaGb * 1e9)) * 1000) / 10 : null;
    const mine = samples.filter((x) => x.nodeId === n.id);
    const peak = mine.reduce((m, x) => Math.max(m, x.peakMbps ?? 0), 0);
    return {
      id: n.id,
      name: n.name,
      region: n.region,
      url: n.url,
      main: n.id === mainId,
      capacityMbps: n.capacityMbps,
      note: n.note,
      active: n.active,
      createdAt: n.createdAt,
      status: relayStatus(n, n.id === mainId, { usage, overQuota: usedPercent !== null && usedPercent >= 100 }),
      /** The main relay is this service: up while it runs. */
      lastSeenAt: n.id === mainId ? t : n.lastSeenAt,
      lastCheckAt: n.id === mainId ? t : n.lastCheckAt,
      uptime30: uptime(mine.map((x) => ({ at: x.at, up: x.up })), t - 30 * DAY, t),
      peakMbps30: mine.length ? Math.round(peak * 100) / 100 : null,
      servers: s.servers,
      customers: s.customers,
      connected: s.connected,
      clients: s.clients,
      mbpsNow: s.mbpsNow,
      usage,
      availableMbps: Math.max(0, Math.round((n.capacityMbps - s.mbpsNow) * 100) / 100),
      month: s.month,
      /** The hosting's monthly allowance: used this calendar month (GB), and what happens beyond it. */
      quota: { monthlyGb: n.monthlyQuotaGb, overQuotaMbps: n.overQuotaMbps, usedGb: Math.round((s.thisMonthOut / 1e9) * 10) / 10, usedPercent },
    };
  };

  const allRelays = () => {
    const main = mainRelay();
    const nodes = db.select().from(relayNodes).orderBy(relayNodes.id).all();
    const stats = relayStats(nodes.map((n) => n.id));
    const samples = samplesOf(
      nodes.map((n) => n.id),
      deps.now() - 30 * DAY,
    );
    return nodes.map((n) => nodeView(n, stats.get(n.id)!, main.id, samples));
  };

  // ---- customers: the figures, and the view of one

  const serversByAccount = (ids: number[]) => {
    const owned = new Map<number, Array<{ id: string; name: string; relayNodeId: number | null; lastSeenAt: number }>>();
    if (!ids.length) return owned;
    for (const s of db.select({ id: servers.id, name: servers.name, accountId: servers.accountId, relayNodeId: servers.relayNodeId, lastSeenAt: servers.lastSeenAt }).from(servers).where(inArray(servers.accountId, ids)).all()) {
      const list = owned.get(s.accountId!) ?? [];
      list.push({ id: s.id, name: s.name, relayNodeId: s.relayNodeId, lastSeenAt: s.lastSeenAt });
      owned.set(s.accountId!, list);
    }
    return owned;
  };

  const customerViews = (rows: Account[]) => {
    const t = deps.now();
    const ids = rows.map((a) => a.id);
    const grants = grantsOf(ids);
    const last = lastActive(ids);
    const owned = serversByAccount(ids);
    const nodes = new Map(db.select({ id: relayNodes.id, name: relayNodes.name }).from(relayNodes).all().map((n) => [n.id, n.name]));
    const main = mainRelay();
    const activeFrom = dayOf(t - ACTIVE_DAYS * DAY);
    return rows.map((a) => {
      const list = grants.get(a.id) ?? [];
      const g = activeGrant(list, t);
      const next = list.filter((x) => x.revokedAt === null && x.startsAt > t).sort((x, y) => x.startsAt - y.startsAt)[0] ?? null;
      const lastDay = last.get(a.id) ?? null;
      const active = !!lastDay && lastDay >= activeFrom;
      const relayId = a.relayNodeId ?? main.id;
      return {
        id: a.id,
        email: a.email,
        name: a.name,
        createdAt: a.createdAt,
        lastActive: lastDay,
        active,
        status: (a.suspendedAt !== null ? 'suspended' : active ? 'active' : 'inactive') as CustomerStatus,
        /** Added by the CEO; waits until the customer signs up with this address. */
        invited: a.passwordHash === '',
        access: g ? { grantId: g.id, type: g.type, plan: g.plan, startsAt: g.startsAt, endsAt: g.endsAt, status: grantStatus(g, t) } : null,
        scheduled: next ? { grantId: next.id, type: next.type, startsAt: next.startsAt } : null,
        /** A plan set on the old admin page, without a grant (no type known). */
        plan: a.plan !== 'free' && (a.planUntil === null || a.planUntil > t) ? { plan: a.plan, until: a.planUntil } : null,
        relay: { id: relayId, name: nodes.get(relayId) ?? 'vidalune.com' },
        servers: (owned.get(a.id) ?? []).map((s) => ({ ...s, connected: deps.relay.connected(s.id) })),
      };
    });
  };

  // ---- overview: the figures at a glance

  const accessSummary = () => {
    const t = deps.now();
    const all = db.select({ id: accounts.id }).from(accounts).all();
    const grants = grantsOf(all.map((a) => a.id));
    const byType: Record<AccessType, number> = { customer: 0, beta: 0, test: 0, free: 0 };
    let withAccess = 0;
    let expired = 0;
    let expiring7 = 0;
    let expiring14 = 0;
    for (const a of all) {
      const list = grants.get(a.id) ?? [];
      const g = activeGrant(list, t);
      if (g) {
        withAccess++;
        byType[g.type]++;
        if (g.endsAt !== null && g.endsAt < t + 7 * DAY) expiring7++;
        if (g.endsAt !== null && g.endsAt < t + EXPIRING_DAYS * DAY) expiring14++;
      } else if (list.some((x) => x.revokedAt === null && x.endsAt !== null && x.endsAt <= t) && !list.some((x) => x.revokedAt === null && x.startsAt > t)) {
        // Had access that ran out (not taken back), and nothing new planned.
        expired++;
      }
    }
    return { total: withAccess, byType, expiringIn7Days: expiring7, expiringIn14Days: expiring14, expired };
  };

  const eventView = (e: typeof ceoEvents.$inferSelect) => ({ id: e.id, at: e.at, actor: e.actor, action: e.action, target: e.target, detail: e.detail ? (JSON.parse(e.detail) as Record<string, unknown>) : null });

  app.get('/api/ceo/dashboard', async (request) => {
    ceo(request);
    const t = deps.now();
    const all = db.select({ id: accounts.id, createdAt: accounts.createdAt }).from(accounts).all();
    const created = (from: number, to: number) => all.filter((a) => a.createdAt >= from && a.createdAt < to).length;
    const activeSince = (from: number) =>
      Number(db.select({ n: sql<number>`count(distinct ${accountActivity.accountId})` }).from(accountActivity).where(gte(accountActivity.day, dayOf(from))).get()?.n ?? 0);
    const relays = allRelays();
    const on = relays.filter((r) => r.active);
    const capacity = on.reduce((n, r) => n + r.capacityMbps, 0) || deps.mainCapacityMbps;
    const mbpsNow = Math.round(on.reduce((n, r) => n + r.mbpsNow, 0) * 100) / 100;
    const live = deps.relay.now();
    return {
      customers: {
        total: all.length,
        active: activeSince(t - ACTIVE_DAYS * DAY),
        new7: created(t - 7 * DAY, t + 1),
        new30: created(t - 30 * DAY, t + 1),
        /** New accounts in the last 30 days against the 30 before. */
        growth30: growth(created(t - 30 * DAY, t + 1), created(t - 60 * DAY, t - 30 * DAY)),
        suspended: Number(db.select({ n: sql<number>`count(*)` }).from(accounts).where(isNotNull(accounts.suspendedAt)).get()?.n ?? 0),
      },
      access: accessSummary(),
      relays: {
        nodes: on.length,
        online: on.filter((r) => r.status === 'online' || r.status === 'degraded').length,
        offline: on.filter((r) => r.status === 'offline').length,
        capacityMbps: capacity,
        mbpsNow,
        usage: capacity ? Math.round((mbpsNow / capacity) * 1000) / 10 : 0,
        availableMbps: Math.max(0, Math.round((capacity - mbpsNow) * 100) / 100),
        tunnels: live.tunnels,
        sending: live.active,
        clients: on.reduce((n, r) => n + r.clients, 0),
        list: relays.map((r) => ({ id: r.id, name: r.name, region: r.region, main: r.main, status: r.status, capacityMbps: r.capacityMbps, mbpsNow: r.mbpsNow, usage: r.usage, clients: r.clients, connected: r.connected, uptime30: r.uptime30, lastSeenAt: r.lastSeenAt })),
        /** Relays that used 80 % or more of their hosting's monthly traffic allowance. */
        nearQuota: on
          .filter((r) => r.quota.monthlyGb && r.quota.usedPercent !== null && r.quota.usedPercent >= 80)
          .map((r) => ({ id: r.id, name: r.name, usedGb: r.quota.usedGb, monthlyGb: r.quota.monthlyGb, overQuotaMbps: r.quota.overQuotaMbps })),
      },
      servers: {
        total: Number(db.select({ n: sql<number>`count(*)` }).from(servers).where(isNotNull(servers.accountId)).get()?.n ?? 0),
        online: Number(db.select({ n: sql<number>`count(*)` }).from(servers).where(and(isNotNull(servers.accountId), gte(servers.lastSeenAt, t - 2 * HOUR))).get()?.n ?? 0),
        connected: live.tunnels,
      },
      dns: deps.directDnsUsage?.() ?? null,
      activity: db.select().from(ceoEvents).orderBy(desc(ceoEvents.at), desc(ceoEvents.id)).limit(8).all().map(eventView),
    };
  });

  app.get('/api/ceo/activity', async (request) => {
    ceo(request);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), before: z.coerce.number().int().positive().optional() }).parse(request.query);
    const rows = db
      .select()
      .from(ceoEvents)
      .where(q.before ? lt(ceoEvents.id, q.before) : undefined)
      .orderBy(desc(ceoEvents.id))
      .limit(q.limit)
      .all();
    return { events: rows.map(eventView) };
  });

  // ---- customers

  app.get('/api/ceo/customers', async (request) => {
    ceo(request);
    const q = z
      .object({
        q: z.string().trim().toLowerCase().max(254).default(''),
        type: z.enum(['all', 'customer', 'beta', 'test', 'free', 'none']).default('all'),
        status: z.enum(['all', 'active', 'inactive', 'new', 'suspended', 'expiring', 'invited']).default('all'),
        sort: z.enum(['created', 'lastActive', 'expires', 'name']).default('created'),
        dir: z.enum(['asc', 'desc']).optional(),
        page: z.coerce.number().int().min(1).max(1000).default(1),
      })
      .parse(request.query);
    const t = deps.now();
    const rows = db
      .select()
      .from(accounts)
      .orderBy(desc(accounts.createdAt))
      .all()
      .filter((a) => !q.q || a.email.includes(q.q) || (a.name ?? '').toLowerCase().includes(q.q));
    const list = customerViews(rows)
      .filter((c) => (q.type === 'all' ? true : q.type === 'none' ? !c.access : c.access?.type === q.type))
      .filter((c) =>
        q.status === 'all'
          ? true
          : q.status === 'new'
            ? c.createdAt >= t - 30 * DAY
            : q.status === 'expiring'
              ? c.access?.status === 'expiring'
              : q.status === 'invited'
                ? c.invited
                : c.status === q.status,
      );
    // Ascending by default for names and end dates, newest first for dates that passed.
    const dir = (q.dir ?? (q.sort === 'name' || q.sort === 'expires' ? 'asc' : 'desc')) === 'asc' ? 1 : -1;
    const key = (c: (typeof list)[number]): string | number | null =>
      q.sort === 'name' ? (c.name ?? c.email).toLowerCase() : q.sort === 'lastActive' ? c.lastActive : q.sort === 'expires' ? (c.access ? (c.access.endsAt ?? Number.MAX_SAFE_INTEGER) : null) : c.createdAt;
    list.sort((a, b) => {
      const x = key(a);
      const y = key(b);
      // Without a value (never active, no access): always last.
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
    const size = 50;
    return { total: list.length, page: q.page, pageSize: size, customers: list.slice((q.page - 1) * size, q.page * size) };
  });

  const relayChoice = (relayId: number | null | undefined) => {
    if (relayId === undefined) return undefined;
    const main = mainRelay();
    if (relayId === null || relayId === main.id) return null;
    const node = db.select().from(relayNodes).where(eq(relayNodes.id, relayId)).get();
    if (!node || !node.active) throw new CeoError(400, 'Choose a relay that is on.');
    return node.id;
  };

  /**
   * Adds a customer by hand: a Vidalune account for this address, optionally with access and a relay
   * right away. They choose their password by signing up with the same address.
   */
  app.post('/api/ceo/customers', async (request) => {
    const me = ceo(request);
    const body = z
      .object({
        email: z.string().trim().toLowerCase().max(254).email('Enter a valid email address.'),
        name: z.string().trim().max(100).nullable().default(null),
        note,
        relayId: id.nullable().optional(),
        access: z
          .object({ type: accessType, plan: plan.default('remote'), startsAt: when.optional(), endsAt: when.nullable().default(null), note })
          .nullable()
          .default(null),
      })
      .parse(request.body);
    if (db.select().from(accounts).where(eq(accounts.email, body.email)).get()) throw new CeoError(409, 'There is already a Vidalune account with this email address.');
    const t = deps.now();
    const relayNodeId = relayChoice(body.relayId) ?? null;
    if (body.access) checkDates(body.access.startsAt ?? t, body.access.endsAt, t);
    const a = db
      .insert(accounts)
      .values({ email: body.email, passwordHash: '', createdAt: t, name: body.name || null, note: body.note || null, relayNodeId })
      .returning()
      .get();
    record(me.email, 'customer.created', who(a), { relayId: relayNodeId });
    if (body.access) {
      const g = db
        .insert(accessGrants)
        .values({ accountId: a.id, type: body.access.type, plan: body.access.plan, startsAt: body.access.startsAt ?? t, endsAt: body.access.endsAt, note: body.access.note || null, grantedBy: me.email, createdAt: t })
        .returning()
        .get();
      applyGrants(a.id, me.email);
      record(me.email, 'access.granted', who(a), { type: g.type, plan: g.plan, startsAt: g.startsAt, endsAt: g.endsAt });
    }
    return customerViews([accountOf(a.id)])[0];
  });

  /** One customer: who, their access over time, servers, devices signed in, and what happened. */
  app.get('/api/ceo/customers/:id', async (request) => {
    ceo(request);
    const p = z.object({ id }).parse(request.params);
    const a = accountOf(p.id);
    const t = deps.now();
    const view = customerViews([a])[0];
    const grants = db.select().from(accessGrants).where(eq(accessGrants.accountId, a.id)).orderBy(desc(accessGrants.startsAt), desc(accessGrants.id)).all();
    const devices = Number(db.select({ n: sql<number>`count(*)` }).from(accountSessions).where(and(eq(accountSessions.accountId, a.id), gte(accountSessions.expiresAt, t))).get()?.n ?? 0);
    const activeDays = Number(
      db
        .select({ n: sql<number>`count(*)` })
        .from(accountActivity)
        .where(and(eq(accountActivity.accountId, a.id), gte(accountActivity.day, dayOf(t - 29 * DAY))))
        .get()?.n ?? 0,
    );
    const events = db
      .select()
      .from(ceoEvents)
      .where(sql`${ceoEvents.target} = ${a.email} or ${ceoEvents.target} like ${`%<${a.email}>`}`)
      .orderBy(desc(ceoEvents.id))
      .limit(20)
      .all();
    return {
      ...view,
      note: a.note,
      suspendedAt: a.suspendedAt,
      suspendedBy: a.suspendedBy,
      grants: grants.map((g) => grantView(g)),
      /** Browsers and apps signed in to this account now. */
      devices,
      activeDays30: activeDays,
      servers: view.servers.map((s) => ({ ...s, clients: deps.relay.clients(s.id).length, connectedSince: deps.relay.connectedSince(s.id) })),
      activity: events.map(eventView),
    };
  });

  /** Name, note and relay of a customer (the relay moves their servers along). */
  app.put('/api/ceo/customers/:id', async (request) => {
    const me = ceo(request);
    const p = z.object({ id }).parse(request.params);
    const body = z
      .object({ name: z.string().trim().max(100).nullable().optional(), note: z.string().trim().max(300).nullable().optional(), relayId: id.nullable().optional() })
      .refine((b) => b.name !== undefined || b.note !== undefined || b.relayId !== undefined, 'Nothing to change.')
      .parse(request.body);
    const a = accountOf(p.id);
    const relayNodeId = relayChoice(body.relayId);
    db.update(accounts)
      .set({ ...(body.name !== undefined ? { name: body.name || null } : {}), ...(body.note !== undefined ? { note: body.note || null } : {}), ...(relayNodeId !== undefined ? { relayNodeId } : {}) })
      .where(eq(accounts.id, a.id))
      .run();
    if (relayNodeId !== undefined) db.update(servers).set({ relayNodeId }).where(eq(servers.accountId, a.id)).run();
    record(me.email, 'customer.updated', who(accountOf(a.id)), { ...body });
    return customerViews([accountOf(a.id)])[0];
  });

  /** Suspends a customer: signed out everywhere, and their servers no longer reachable through Vidalune. */
  app.post('/api/ceo/customers/:id/suspend', async (request) => {
    const me = ceo(request);
    const p = z.object({ id }).parse(request.params);
    const body = z.object({ reason: z.string().trim().max(300).nullable().default(null) }).parse(request.body ?? {});
    const a = accountOf(p.id);
    if (a.id === me.id || deps.isCeo(a)) throw new CeoError(400, 'The CEO account cannot be suspended.');
    if (a.suspendedAt !== null) throw new CeoError(409, 'This customer is already suspended.');
    db.update(accounts).set({ suspendedAt: deps.now(), suspendedBy: me.email }).where(eq(accounts.id, a.id)).run();
    deps.signOut(a.id);
    deps.accessChanged();
    record(me.email, 'customer.suspended', who(a), body.reason ? { reason: body.reason } : undefined);
    return customerViews([accountOf(a.id)])[0];
  });

  app.post('/api/ceo/customers/:id/unsuspend', async (request) => {
    const me = ceo(request);
    const p = z.object({ id }).parse(request.params);
    const a = accountOf(p.id);
    if (a.suspendedAt === null) throw new CeoError(409, 'This customer is not suspended.');
    db.update(accounts).set({ suspendedAt: null, suspendedBy: null }).where(eq(accounts.id, a.id)).run();
    record(me.email, 'customer.unsuspended', who(a));
    return customerViews([accountOf(a.id)])[0];
  });

  // ---- access: give, change, extend, take back

  function checkDates(startsAt: number, endsAt: number | null, t: number) {
    if (endsAt !== null && endsAt <= t) throw new CeoError(400, 'Choose an end date in the future.');
    if (endsAt !== null && endsAt <= startsAt) throw new CeoError(400, 'The end date comes after the start date.');
  }

  app.get('/api/ceo/access', async (request) => {
    ceo(request);
    const q = z
      .object({ show: z.enum(['active', 'expiring', 'expired', 'scheduled', 'all']).default('active'), type: z.enum(['all', 'customer', 'beta', 'test', 'free']).default('all') })
      .parse(request.query);
    const t = deps.now();
    const rows = db
      .select({ g: accessGrants, email: accounts.email, name: accounts.name })
      .from(accessGrants)
      .innerJoin(accounts, eq(accounts.id, accessGrants.accountId))
      .orderBy(desc(accessGrants.createdAt))
      .limit(2000)
      .all();
    const list = rows.filter(({ g }) => {
      if (q.type !== 'all' && g.type !== q.type) return false;
      const s = grantStatus(g, t);
      return q.show === 'all' ? true : q.show === 'active' ? s === 'active' || s === 'expiring' : s === q.show;
    });
    return { summary: accessSummary(), grants: list.slice(0, 500).map(({ g, email, name }) => grantView(g, { email, name })) };
  });

  /** Gives access: to an account (by id or email), what, why, from when and until when (or for how many days). */
  app.post('/api/ceo/access', async (request) => {
    const me = ceo(request);
    const body = z
      .object({
        accountId: id.optional(),
        email: z.string().trim().toLowerCase().max(254).email().optional(),
        type: accessType,
        plan: plan.default('remote'),
        days: z.number().int().min(1).max(3650).nullable().optional(),
        startsAt: when.optional(),
        until: when.nullable().optional(),
        note,
      })
      .refine((b) => b.accountId || b.email, 'Choose an account.')
      .parse(request.body);
    const t = deps.now();
    const target = db.select().from(accounts).where(body.accountId ? eq(accounts.id, body.accountId) : eq(accounts.email, body.email!)).get();
    if (!target) throw new CeoError(404, 'There is no Vidalune account with this email address.');
    const startsAt = body.startsAt ?? t;
    const endsAt = body.until ?? (body.days ? Math.max(startsAt, t) + body.days * DAY : null);
    checkDates(startsAt, endsAt, t);
    const g = db.insert(accessGrants).values({ accountId: target.id, type: body.type, plan: body.plan, startsAt, endsAt, note: body.note || null, grantedBy: me.email, createdAt: t }).returning().get();
    applyGrants(target.id, me.email);
    record(me.email, 'access.granted', who(target), { type: g.type, plan: g.plan, startsAt, endsAt });
    return grantView(g, target);
  });

  /** Changes access: a new end (or none), days added to the current end, another type or plan, a note. */
  app.put('/api/ceo/access/:id', async (request) => {
    const me = ceo(request);
    const p = z.object({ id }).parse(request.params);
    const body = z
      .object({
        until: when.nullable().optional(),
        addDays: z.number().int().min(1).max(3650).optional(),
        type: accessType.optional(),
        plan: plan.optional(),
        note: z.string().trim().max(300).nullable().optional(),
      })
      .refine((b) => b.until !== undefined || b.addDays !== undefined || b.type !== undefined || b.plan !== undefined || b.note !== undefined, 'Nothing to change.')
      .parse(request.body);
    const g = db.select().from(accessGrants).where(eq(accessGrants.id, p.id)).get();
    if (!g || g.revokedAt !== null) throw new CeoError(404, 'Not found.');
    const t = deps.now();
    const endsAt = body.until !== undefined ? body.until : body.addDays ? Math.max(g.endsAt ?? t, t) + body.addDays * DAY : g.endsAt;
    if (endsAt !== g.endsAt) checkDates(g.startsAt, endsAt, t);
    db.update(accessGrants)
      .set({ endsAt, ...(body.type ? { type: body.type } : {}), ...(body.plan ? { plan: body.plan } : {}), ...(body.note !== undefined ? { note: body.note || null } : {}) })
      .where(eq(accessGrants.id, g.id))
      .run();
    applyGrants(g.accountId, me.email);
    const after = db.select().from(accessGrants).where(eq(accessGrants.id, g.id)).get()!;
    const owner = accountOf(g.accountId);
    record(me.email, body.addDays || body.until !== undefined ? 'access.extended' : 'access.changed', who(owner), {
      before: { type: g.type, plan: g.plan, endsAt: g.endsAt },
      after: { type: after.type, plan: after.plan, endsAt: after.endsAt },
    });
    return grantView(after, owner);
  });

  /** Takes access back now (kept in the history). */
  app.delete('/api/ceo/access/:id', async (request) => {
    const me = ceo(request);
    const p = z.object({ id }).parse(request.params);
    const g = db.select().from(accessGrants).where(eq(accessGrants.id, p.id)).get();
    if (!g || g.revokedAt !== null) throw new CeoError(404, 'Not found.');
    db.update(accessGrants).set({ revokedAt: deps.now(), revokedBy: me.email }).where(eq(accessGrants.id, g.id)).run();
    applyGrants(g.accountId, me.email);
    record(me.email, 'access.revoked', who(accountOf(g.accountId)), { type: g.type, plan: g.plan });
    return { ok: true };
  });

  // ---- relays

  app.get('/api/ceo/relays', async (request) => {
    ceo(request);
    const relays = allRelays();
    const on = relays.filter((r) => r.active);
    const capacity = on.reduce((n, r) => n + r.capacityMbps, 0);
    const now = Math.round(on.reduce((n, r) => n + r.mbpsNow, 0) * 100) / 100;
    return {
      relays,
      /** The main relay's total and the default per server (Mbit/s; 0: no limit). */
      defaults: { maxMbps: deps.mainCapacityMbps, serverMbps: deps.defaultServerMbps },
      totals: { capacityMbps: capacity, mbpsNow: now, availableMbps: Math.max(0, Math.round((capacity - now) * 100) / 100), usage: capacity ? Math.round((now / capacity) * 1000) / 10 : 0 },
    };
  });

  const relayBody = z.object({
    name: z.string().trim().min(1).max(60),
    region: z.string().trim().max(60).nullable().default(null),
    url: z
      .string()
      .trim()
      .max(300)
      .refine((u) => /^https:\/\/[^\s/]+(\/[^\s]*)?$/i.test(u), 'Enter the relay’s https address.'),
    capacityMbps: z.number().int().min(1).max(1_000_000),
    /** Null: unlimited traffic. */
    monthlyQuotaGb: z.number().int().min(1).max(10_000_000).nullable().default(null),
    overQuotaMbps: z.number().int().min(1).max(100_000).nullable().default(null),
    note,
  });

  const oneRelay = (nodeId: number) => {
    const main = mainRelay();
    const n = db.select().from(relayNodes).where(eq(relayNodes.id, nodeId)).get();
    if (!n) throw new CeoError(404, 'Not found.');
    return nodeView(n, relayStats([n.id]).get(n.id)!, main.id, samplesOf([n.id], deps.now() - 30 * DAY));
  };

  /** Registers another relay: its name, region, address and capacity. */
  app.post('/api/ceo/relays', async (request) => {
    const me = ceo(request);
    const body = relayBody.parse(request.body);
    mainRelay();
    const row = db
      .insert(relayNodes)
      .values({ ...body, note: body.note || null, active: true, createdAt: deps.now() })
      .returning()
      .get();
    record(me.email, 'relay.created', row.name, { region: row.region, url: row.url, capacityMbps: row.capacityMbps });
    return oneRelay(row.id);
  });

  app.put('/api/ceo/relays/:id', async (request) => {
    const me = ceo(request);
    const p = z.object({ id }).parse(request.params);
    const main = mainRelay();
    const body = relayBody.partial().extend({ active: z.boolean().optional() }).parse(request.body);
    if (p.id === main.id && (body.url !== undefined || body.active === false)) throw new CeoError(400, 'The main relay is vidalune.com itself: its address stays, and it stays on.');
    const before = db.select().from(relayNodes).where(eq(relayNodes.id, p.id)).get();
    if (!before) throw new CeoError(404, 'Not found.');
    db.update(relayNodes).set(body).where(eq(relayNodes.id, p.id)).run();
    // A relay turned off: its servers and customers go back to the main relay.
    if (body.active === false) {
      db.update(servers).set({ relayNodeId: null }).where(eq(servers.relayNodeId, p.id)).run();
      db.update(accounts).set({ relayNodeId: null }).where(eq(accounts.relayNodeId, p.id)).run();
    }
    const { active, ...changes } = body;
    if (active !== undefined && active !== before.active) record(me.email, active ? 'relay.enabled' : 'relay.disabled', before.name);
    if (Object.keys(changes).length) record(me.email, 'relay.updated', before.name, { ...changes });
    return oneRelay(p.id);
  });

  /** Removes a relay (not the main one): its servers and customers go back to the main relay. */
  app.delete('/api/ceo/relays/:id', async (request) => {
    const me = ceo(request);
    const p = z.object({ id }).parse(request.params);
    const main = mainRelay();
    if (p.id === main.id) throw new CeoError(400, 'The main relay is vidalune.com itself and stays.');
    const n = db.select().from(relayNodes).where(eq(relayNodes.id, p.id)).get();
    if (!n) throw new CeoError(404, 'Not found.');
    const moved = db.update(servers).set({ relayNodeId: null }).where(eq(servers.relayNodeId, p.id)).run().changes;
    db.update(accounts).set({ relayNodeId: null }).where(eq(accounts.relayNodeId, p.id)).run();
    db.delete(relayNodes).where(eq(relayNodes.id, p.id)).run();
    record(me.email, 'relay.removed', n.name, { serversMoved: moved });
    return { ok: true, moved };
  });

  /** One relay: its servers, customers and clients, and traffic and errors per day (the last 30 days). */
  app.get('/api/ceo/relays/:id', async (request) => {
    ceo(request);
    const p = z.object({ id }).parse(request.params);
    const main = mainRelay();
    const node = db.select().from(relayNodes).where(eq(relayNodes.id, p.id)).get();
    if (!node) throw new CeoError(404, 'Not found.');
    const s = relayStats([node.id]).get(node.id)!;
    const t = deps.now();
    const ids = s.assigned.map((x) => x.id);
    const perDay = ids.length
      ? db
          .select({ day: relayTraffic.day, out: sql<number>`sum(${relayTraffic.bytesOut})`, requests: sql<number>`sum(${relayTraffic.requests})`, errors: sql<number>`sum(${relayTraffic.errors})` })
          .from(relayTraffic)
          .where(and(inArray(relayTraffic.serverId, ids), gte(relayTraffic.day, dayOf(t - 29 * DAY))))
          .groupBy(relayTraffic.day)
          .all()
      : [];
    const byDay = new Map(perDay.map((r) => [r.day, r]));
    const live = deps.relay.now();
    const byServer = new Map(s.assigned.map((x) => [x.id, x]));
    // Customers here: by their own choice of relay, or because one of their servers is here.
    const customerIds = [...new Set([...s.assigned.map((x) => x.accountId).filter((x): x is number => x !== null), ...db.select({ id: accounts.id }).from(accounts).where(eq(accounts.relayNodeId, node.id)).all().map((a) => a.id)])];
    return {
      ...nodeView(node, s, main.id, samplesOf([node.id], t - 30 * DAY)),
      /** A server's limit when it has none of its own (Mbit/s; 0: none). */
      serverDefaultMbps: deps.defaultServerMbps,
      days: daysBetween(t - 29 * DAY, t).map((d) => ({ day: d, out: Number(byDay.get(d)?.out ?? 0), requests: Number(byDay.get(d)?.requests ?? 0), errors: Number(byDay.get(d)?.errors ?? 0) })),
      serverList: s.assigned.map((x) => ({
        id: x.id,
        name: x.name,
        owner: x.email,
        ownerName: x.ownerName,
        accountId: x.accountId,
        relayOn: x.relayEnabled,
        connected: deps.relay.connected(x.id),
        connectedSince: deps.relay.connectedSince(x.id),
        lastSeenAt: x.lastSeenAt,
        mbpsNow: mbps(live.bps.get(x.id) ?? 0),
        clients: deps.relay.clients(x.id).length,
        limitMbps: x.limitMbps,
      })),
      /** Viewers' devices watching through this relay now (per server; nothing identifying is kept). */
      clientList: s.clientList.map((c) => {
        const srv = byServer.get(c.serverId);
        return { serverId: c.serverId, server: srv?.name ?? null, customer: srv?.ownerName || srv?.email || null, device: c.device, since: c.since, lastSeen: c.lastSeen, bytes: c.bytes };
      }),
      customerList: customerViews(customerIds.length ? db.select().from(accounts).where(inArray(accounts.id, customerIds)).all() : []).map((c) => ({ id: c.id, email: c.email, name: c.name, status: c.status, access: c.access, servers: c.servers.length })),
    };
  });

  /** A relay over time: speed, clients, load and uptime, from the five-minute samples. */
  app.get('/api/ceo/relays/:id/history', async (request) => {
    ceo(request);
    const p = z.object({ id }).parse(request.params);
    const q = z.object({ range: z.enum(['1h', '6h', '24h', '7d', '30d']).default('24h') }).parse(request.query);
    const n = db.select().from(relayNodes).where(eq(relayNodes.id, p.id)).get();
    if (!n) throw new CeoError(404, 'Not found.');
    const t = deps.now();
    const from = t - ranges[q.range];
    const samples = samplesOf([n.id], from).filter((x) => x.at >= from - SAMPLE_MS);
    const size = BUCKET[q.range];
    const buckets = new Map<number, typeof samples>();
    for (const x of samples) {
      const b = x.at - (x.at % size);
      const list = buckets.get(b);
      if (list) list.push(x);
      else buckets.set(b, [x]);
    }
    const avg = (xs: Array<number | null>) => {
      const v = xs.filter((x): x is number => x !== null);
      return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null;
    };
    const max = (xs: Array<number | null>) => {
      const v = xs.filter((x): x is number => x !== null);
      return v.length ? Math.max(...v) : null;
    };
    const points = [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([at, xs]) => {
        const m = avg(xs.map((x) => x.mbps));
        return {
          at,
          mbps: m,
          peakMbps: max(xs.map((x) => x.peakMbps)),
          load: m !== null && n.capacityMbps ? Math.round((m / n.capacityMbps) * 1000) / 10 : null,
          clients: max(xs.map((x) => x.clients)),
          servers: max(xs.map((x) => x.servers)),
          up: xs.every((x) => x.up),
        };
      });
    const peak = max(samples.map((x) => x.peakMbps));
    const mean = avg(samples.map((x) => x.mbps));
    return {
      range: q.range,
      available: samples.length > 0,
      /** How long samples go back: longer ranges than this show what there is. */
      since: samples[0]?.at ?? null,
      points,
      peakMbps: peak,
      avgLoad: mean !== null && n.capacityMbps ? Math.round((mean / n.capacityMbps) * 1000) / 10 : null,
      uptime: uptime(samples, from, t),
    };
  });

  /** Assigns (or moves) servers to a relay: one server, or a customer (all their servers, now and later). */
  app.post('/api/ceo/relays/:id/assign', async (request) => {
    const me = ceo(request);
    const p = z.object({ id }).parse(request.params);
    const body = z
      .object({ serverId: z.string().max(64).optional(), accountId: id.optional() })
      .refine((b) => b.serverId || b.accountId, 'Choose a server or a customer.')
      .parse(request.body);
    const main = mainRelay();
    const node = db.select().from(relayNodes).where(eq(relayNodes.id, p.id)).get();
    if (!node || !node.active) throw new CeoError(404, 'Not found.');
    const target = node.id === main.id ? null : node.id;
    if (body.accountId) {
      const a = accountOf(body.accountId);
      db.update(accounts).set({ relayNodeId: target }).where(eq(accounts.id, a.id)).run();
      const moved = db.update(servers).set({ relayNodeId: target }).where(eq(servers.accountId, a.id)).run().changes;
      record(me.email, 'relay.customerAssigned', node.name, { customer: who(a), servers: moved });
      return { ok: true, moved };
    }
    const srv = db.select().from(servers).where(eq(servers.id, body.serverId!)).get();
    if (!srv) throw new CeoError(404, 'No servers found.');
    // One server: named explicitly (also the main relay), so its customer's relay does not apply to it.
    db.update(servers).set({ relayNodeId: node.id }).where(eq(servers.id, srv.id)).run();
    record(me.email, 'relay.serverAssigned', node.name, { server: srv.name });
    return { ok: true, moved: 1 };
  });

  /** Takes a server off a relay: back to the main relay. */
  app.delete('/api/ceo/relays/:id/servers/:serverId', async (request) => {
    const me = ceo(request);
    const p = z.object({ id, serverId: z.string().max(64) }).parse(request.params);
    const srv = db.select().from(servers).where(eq(servers.id, p.serverId)).get();
    const node = db.select().from(relayNodes).where(eq(relayNodes.id, p.id)).get();
    const owner = srv?.accountId ? db.select().from(accounts).where(eq(accounts.id, srv.accountId)).get() : undefined;
    if (!srv || !node || (srv.relayNodeId ?? owner?.relayNodeId ?? null) !== p.id) throw new CeoError(404, 'Not found.');
    // Off this relay for good: when the customer as a whole is here, this server says the main relay itself.
    db.update(servers)
      .set({ relayNodeId: owner?.relayNodeId === p.id ? mainRelay().id : null })
      .where(eq(servers.id, srv.id))
      .run();
    record(me.email, 'relay.serverRemoved', node.name, { server: srv.name });
    return { ok: true };
  });

  /** A server's own speed limit through the relay (Mbit/s; null: the default). */
  app.put('/api/ceo/servers/:id/relay-limit', async (request) => {
    const me = ceo(request);
    const p = z.object({ id: z.string().max(64) }).parse(request.params);
    const { limitMbps } = z.object({ limitMbps: z.number().int().min(1).max(10_000).nullable() }).parse(request.body);
    const srv = db.select().from(servers).where(eq(servers.id, p.id)).get();
    if (!srv) throw new CeoError(404, 'Not found.');
    db.update(servers).set({ relayLimitMbps: limitMbps }).where(eq(servers.id, srv.id)).run();
    deps.relay.refreshLimit(srv.id);
    record(me.email, 'server.limitChanged', srv.name, { before: srv.relayLimitMbps, after: limitMbps });
    return { ok: true, limitMbps };
  });

  /** Takes a customer off a relay: they and their servers go back to the main relay. */
  app.delete('/api/ceo/relays/:id/customers/:accountId', async (request) => {
    const me = ceo(request);
    const p = z.object({ id, accountId: id }).parse(request.params);
    const node = db.select().from(relayNodes).where(eq(relayNodes.id, p.id)).get();
    const a = accountOf(p.accountId);
    if (!node) throw new CeoError(404, 'Not found.');
    db.update(accounts).set({ relayNodeId: null }).where(and(eq(accounts.id, a.id), eq(accounts.relayNodeId, p.id))).run();
    db.update(servers).set({ relayNodeId: null }).where(and(eq(servers.accountId, a.id), eq(servers.relayNodeId, p.id))).run();
    record(me.email, 'relay.customerRemoved', node.name, { customer: who(a) });
    return { ok: true };
  });

  // ---- statistics over time

  app.get('/api/ceo/statistics', async (request) => {
    ceo(request);
    const q = z
      .object({
        range: z.enum(['24h', '7d', '30d', '90d', '365d']).optional(),
        days: z.coerce
          .number()
          .int()
          .refine((d) => [7, 30, 90, 365].includes(d), 'Choose 7, 30, 90 or 365 days.')
          .optional(),
      })
      .parse(request.query);
    const range = q.range ?? (q.days ? (`${q.days}d` as '7d' | '30d' | '90d' | '365d') : '90d');
    const t = deps.now();
    const spanMs = range === '24h' ? DAY : Number(range.slice(0, -1)) * DAY;
    const from = t - spanMs;
    const nDays = range === '24h' ? 1 : Number(range.slice(0, -1));
    const days = daysBetween(t - (nDays - 1) * DAY, t);
    const first = days[0];
    const accountsAll = db.select({ createdAt: accounts.createdAt }).from(accounts).all();
    const createdAll = accountsAll.map((a) => dayOf(a.createdAt));
    const before = createdAll.filter((d) => d < first).length;
    const newPerDay = new Map<string, number>();
    for (const d of createdAll) if (d >= first) newPerDay.set(d, (newPerDay.get(d) ?? 0) + 1);
    const activePerDay = new Map(
      db
        .select({ day: accountActivity.day, n: sql<number>`count(*)` })
        .from(accountActivity)
        .where(gte(accountActivity.day, first))
        .groupBy(accountActivity.day)
        .all()
        .map((r) => [r.day, Number(r.n)]),
    );
    const grantsPerDay = new Map<string, number>();
    for (const g of db.select({ createdAt: accessGrants.createdAt }).from(accessGrants).where(gte(accessGrants.createdAt, Date.parse(first))).all()) {
      const d = dayOf(g.createdAt);
      grantsPerDay.set(d, (grantsPerDay.get(d) ?? 0) + 1);
    }
    deps.relay.flush();
    const traffic = new Map(
      db
        .select({ day: relayTraffic.day, out: sql<number>`sum(${relayTraffic.bytesOut})`, errors: sql<number>`sum(${relayTraffic.errors})` })
        .from(relayTraffic)
        .where(gte(relayTraffic.day, first))
        .groupBy(relayTraffic.day)
        .all()
        .map((r) => [r.day, r]),
    );
    // Access in force at the end of each day (from the grants' own dates).
    const grants = db.select().from(accessGrants).all();
    let total = before;
    const series = days.map((d) => {
      total += newPerDay.get(d) ?? 0;
      const end = Math.min(t, Date.parse(d) + DAY - 1);
      const withAccess = new Set(grants.filter((g) => g.startsAt <= end && (g.endsAt === null || g.endsAt > end) && (g.revokedAt === null || g.revokedAt > end)).map((g) => g.accountId)).size;
      return {
        day: d,
        accounts: total,
        newAccounts: newPerDay.get(d) ?? 0,
        activeAccounts: activePerDay.get(d) ?? 0,
        withAccess,
        grants: grantsPerDay.get(d) ?? 0,
        relayOut: Number(traffic.get(d)?.out ?? 0),
        relayErrors: Number(traffic.get(d)?.errors ?? 0),
      };
    });

    // Relays over the period, from the five-minute samples (what exists of it).
    const relays = allRelays().filter((r) => r.active);
    const samples = samplesOf(
      relays.map((r) => r.id),
      from,
    ).filter((x) => x.at >= from - SAMPLE_MS);
    const capacity = relays.reduce((n, r) => n + r.capacityMbps, 0);
    // Totals per moment (all relays together) for peak and average load.
    const perMoment = new Map<number, { mbps: number; peak: number; clients: number }>();
    for (const x of samples) {
      const m = perMoment.get(x.at) ?? { mbps: 0, peak: 0, clients: 0 };
      m.mbps += x.mbps ?? 0;
      m.peak += x.peakMbps ?? 0;
      m.clients += x.clients ?? 0;
      perMoment.set(x.at, m);
    }
    const moments = [...perMoment.entries()].sort((a, b) => a[0] - b[0]);
    const uptimes = relays.map((r) => uptime(samples.filter((x) => x.nodeId === r.id), from, t)).filter((u): u is number => u !== null);
    const activeInPeriod = Number(db.select({ n: sql<number>`count(distinct ${accountActivity.accountId})` }).from(accountActivity).where(gte(accountActivity.day, dayOf(from))).get()?.n ?? 0);
    const createdIn = (a: number, b: number) => accountsAll.filter((x) => x.createdAt >= a && x.createdAt < b).length;
    return {
      range,
      days: series,
      /** Hour by hour for the last day (from the samples). */
      hours:
        range === '24h'
          ? moments.reduce<Array<{ at: number; mbps: number; peakMbps: number; clients: number }>>((out, [at, m]) => {
              const h = at - (at % HOUR);
              const last = out.at(-1);
              if (last && last.at === h) {
                last.mbps = Math.max(last.mbps, Math.round(m.mbps * 100) / 100);
                last.peakMbps = Math.max(last.peakMbps, Math.round(m.peak * 100) / 100);
                last.clients = Math.max(last.clients, m.clients);
              } else out.push({ at: h, mbps: Math.round(m.mbps * 100) / 100, peakMbps: Math.round(m.peak * 100) / 100, clients: m.clients });
              return out;
            }, [])
          : null,
      summary: {
        customers: {
          total: accountsAll.length,
          active: activeInPeriod,
          new: createdIn(from, t + 1),
          growth: growth(createdIn(from, t + 1), createdIn(from - spanMs, from)),
        },
        access: accessSummary(),
        relays: {
          total: relays.length,
          online: relays.filter((r) => r.status === 'online' || r.status === 'degraded').length,
          offline: relays.filter((r) => r.status === 'offline').length,
          capacityMbps: capacity,
          mbpsNow: Math.round(relays.reduce((n, r) => n + r.mbpsNow, 0) * 100) / 100,
          clientsNow: relays.reduce((n, r) => n + r.clients, 0),
          serversNow: relays.reduce((n, r) => n + r.connected, 0),
          /** Null: no samples in this period yet. */
          peakMbps: moments.length ? Math.round(Math.max(...moments.map(([, m]) => m.peak)) * 100) / 100 : null,
          avgLoad: moments.length && capacity ? Math.round((moments.reduce((n, [, m]) => n + m.mbps, 0) / moments.length / capacity) * 1000) / 10 : null,
          uptime: uptimes.length ? Math.round((uptimes.reduce((a, b) => a + b, 0) / uptimes.length) * 100) / 100 : null,
          historySince: samples[0]?.at ?? null,
        },
      },
    };
  });

  // ---- the monitor: every five minutes, check the relays and write down their state

  let running = false;
  const monitor = async () => {
    if (running) return;
    running = true;
    try {
      const t = deps.now();
      const at = t - (t % SAMPLE_MS);
      // Access that starts (or ended) since the last round: the plan follows.
      for (const r of db
        .selectDistinct({ accountId: accessGrants.accountId })
        .from(accessGrants)
        .where(and(isNull(accessGrants.revokedAt), sql`(${accessGrants.startsAt} between ${t - 2 * SAMPLE_MS} and ${t}) or (${accessGrants.endsAt} between ${t - 2 * SAMPLE_MS} and ${t})`))
        .all())
        applyGrants(r.accountId, 'schedule');
      const main = mainRelay();
      const nodes = db.select().from(relayNodes).where(eq(relayNodes.active, true)).all();
      const stats = relayStats(nodes.map((n) => n.id));
      const snaps = deps.relay.snapshots();
      for (const n of nodes) {
        let up = true;
        if (n.id !== main.id && n.url) {
          try {
            const res = await (deps.fetchImpl ?? fetch)(`${n.url.replace(/\/+$/, '')}/health`, { signal: AbortSignal.timeout(5000) });
            up = res.ok;
          } catch {
            up = false;
          }
          const was = n.lastCheckAt === null ? null : n.lastSeenAt !== null && n.lastSeenAt >= n.lastCheckAt;
          db.update(relayNodes)
            .set({ lastCheckAt: t, ...(up ? { lastSeenAt: t } : {}) })
            .where(eq(relayNodes.id, n.id))
            .run();
          if (was !== null && was !== up) record('system', up ? 'relay.online' : 'relay.offline', n.name);
        }
        const s = stats.get(n.id)!;
        const ids = s.assigned.map((x) => x.id);
        const totals = snaps.map((m) => ids.reduce((sum, sid) => sum + (m.get(sid) ?? 0), 0));
        db.insert(relaySamples)
          .values({
            nodeId: n.id,
            at,
            up,
            mbps: totals.length ? mbps(totals.reduce((a, b) => a + b, 0) / totals.length) : s.mbpsNow,
            peakMbps: totals.length ? mbps(Math.max(...totals)) : s.mbpsNow,
            clients: s.clients,
            servers: s.connected,
          })
          .onConflictDoUpdate({ target: [relaySamples.nodeId, relaySamples.at], set: { up, clients: s.clients, servers: s.connected } })
          .run();
      }
      db.delete(relaySamples).where(lt(relaySamples.at, t - SAMPLES_KEPT_MS)).run();
    } finally {
      running = false;
    }
  };

  return { monitor };
}
