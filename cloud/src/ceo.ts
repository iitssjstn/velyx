import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from './db/client.js';
import { accessGrants, accountActivity, accounts, relayNodes, relayTraffic, servers } from './db/schema.js';

/**
 * The CEO panel (/ceo): the business side of Vidalune. Customers (how many, active, new, growth),
 * access (who has what, why and until when; given, extended and taken back by hand, ready for
 * billing later), relays (capacity, which customers use which, traffic and errors) and figures over
 * time. Only real data from this service: no revenue until payments exist, no guesses. Every call
 * checks that the signed-in account is one of CEO_EMAILS.
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
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** An account counts as active when it used Vidalune (website or app) in this many days. */
export const ACTIVE_DAYS = 30;

type Account = typeof accounts.$inferSelect;
type Grant = typeof accessGrants.$inferSelect;
export type AccessType = Grant['type'];

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
  };
  /** Access changed: tunnels of servers that lost it close now. */
  accessChanged: () => void;
}

/** The grant that counts now: not taken back, started, not ended (the latest one when several). */
export function activeGrant(grants: Grant[], now: number): Grant | null {
  return (
    grants
      .filter((g) => g.revokedAt === null && g.startsAt <= now && (g.endsAt === null || g.endsAt > now))
      .sort((a, b) => b.startsAt - a.startsAt || b.id - a.id)[0] ?? null
  );
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

const accessType = z.enum(['customer', 'beta', 'test', 'free']);
const plan = z.enum(['remote', 'viewer']);
const id = z.coerce.number().int().positive();
const note = z.string().trim().max(300).nullable().default(null);

export function ceoRoutes(app: FastifyInstance, deps: CeoDeps): void {
  const { db } = deps;

  const ceo = (request: FastifyRequest) => {
    const me = deps.account(request);
    if (!deps.isCeo(me)) throw new CeoError(403, 'Only for the CEO of Vidalune.');
    return me;
  };

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

  const grantView = (g: Grant, email?: string) => ({
    id: g.id,
    accountId: g.accountId,
    ...(email ? { email } : {}),
    type: g.type,
    plan: g.plan,
    startsAt: g.startsAt,
    endsAt: g.endsAt,
    note: g.note,
    grantedBy: g.grantedBy,
    createdAt: g.createdAt,
    revokedAt: g.revokedAt,
    revokedBy: g.revokedBy,
    source: g.source,
  });

  // ---- dashboard: the figures at a glance

  app.get('/api/ceo/dashboard', async (request) => {
    ceo(request);
    const t = deps.now();
    const all = db.select({ id: accounts.id, createdAt: accounts.createdAt }).from(accounts).all();
    const created = (from: number, to: number) => all.filter((a) => a.createdAt >= from && a.createdAt < to).length;
    const activeSince = (from: number) =>
      Number(db.select({ n: sql<number>`count(distinct ${accountActivity.accountId})` }).from(accountActivity).where(gte(accountActivity.day, dayOf(from))).get()?.n ?? 0);
    const grants = grantsOf(all.map((a) => a.id));
    const byType: Record<AccessType, number> = { customer: 0, beta: 0, test: 0, free: 0 };
    let withAccess = 0;
    for (const a of all) {
      const g = activeGrant(grants.get(a.id) ?? [], t);
      if (!g) continue;
      withAccess++;
      byType[g.type]++;
    }
    const expiring = db
      .select({ n: sql<number>`count(*)` })
      .from(accessGrants)
      .where(and(isNull(accessGrants.revokedAt), isNotNull(accessGrants.endsAt), gte(accessGrants.endsAt, t), sql`${accessGrants.endsAt} < ${t + 14 * DAY}`))
      .get();
    deps.relay.flush();
    const live = deps.relay.now();
    const nodes = db.select().from(relayNodes).where(eq(relayNodes.active, true)).all();
    const capacity = nodes.reduce((n, r) => n + r.capacityMbps, 0) || deps.mainCapacityMbps;
    const mbpsNow = Math.round(([...live.bps.values()].reduce((a, b) => a + b, 0) * 8) / 10_000) / 100;
    return {
      customers: {
        total: all.length,
        active: activeSince(t - ACTIVE_DAYS * DAY),
        new7: created(t - 7 * DAY, t + 1),
        new30: created(t - 30 * DAY, t + 1),
        /** New accounts in the last 30 days against the 30 before. */
        growth30: growth(created(t - 30 * DAY, t + 1), created(t - 60 * DAY, t - 30 * DAY)),
      },
      access: { total: withAccess, byType, expiringIn14Days: Number(expiring?.n ?? 0) },
      relays: { nodes: nodes.length || 1, capacityMbps: capacity, mbpsNow, usage: capacity ? Math.round((mbpsNow / capacity) * 1000) / 10 : 0, tunnels: live.tunnels, sending: live.active },
      servers: {
        total: Number(db.select({ n: sql<number>`count(*)` }).from(servers).where(isNotNull(servers.accountId)).get()?.n ?? 0),
        online: Number(db.select({ n: sql<number>`count(*)` }).from(servers).where(and(isNotNull(servers.accountId), gte(servers.lastSeenAt, t - 2 * 3_600_000))).get()?.n ?? 0),
      },
    };
  });

  // ---- customers

  app.get('/api/ceo/customers', async (request) => {
    ceo(request);
    const q = z
      .object({
        q: z.string().trim().toLowerCase().max(254).default(''),
        type: z.enum(['all', 'customer', 'beta', 'test', 'free', 'none']).default('all'),
        status: z.enum(['all', 'active', 'inactive', 'new']).default('all'),
        page: z.coerce.number().int().min(1).max(1000).default(1),
      })
      .parse(request.query);
    const t = deps.now();
    const rows = db.select().from(accounts).orderBy(desc(accounts.createdAt)).all().filter((a) => !q.q || a.email.includes(q.q));
    const ids = rows.map((a) => a.id);
    const grants = grantsOf(ids);
    const last = lastActive(ids);
    const owned = new Map<number, Array<{ id: string; name: string; relayNodeId: number | null; lastSeenAt: number }>>();
    if (ids.length)
      for (const s of db.select({ id: servers.id, name: servers.name, accountId: servers.accountId, relayNodeId: servers.relayNodeId, lastSeenAt: servers.lastSeenAt }).from(servers).where(isNotNull(servers.accountId)).all()) {
        const list = owned.get(s.accountId!) ?? [];
        list.push({ id: s.id, name: s.name, relayNodeId: s.relayNodeId, lastSeenAt: s.lastSeenAt });
        owned.set(s.accountId!, list);
      }
    const activeFrom = dayOf(t - ACTIVE_DAYS * DAY);
    const list = rows
      .map((a) => {
        const g = activeGrant(grants.get(a.id) ?? [], t);
        const lastDay = last.get(a.id) ?? null;
        return {
          id: a.id,
          email: a.email,
          createdAt: a.createdAt,
          lastActive: lastDay,
          active: !!lastDay && lastDay >= activeFrom,
          access: g ? { grantId: g.id, type: g.type, plan: g.plan, endsAt: g.endsAt } : null,
          /** A plan set on the old admin page, without a grant (no type known). */
          plan: a.plan !== 'free' && (a.planUntil === null || a.planUntil > t) ? { plan: a.plan, until: a.planUntil } : null,
          servers: (owned.get(a.id) ?? []).map((s) => ({ ...s, connected: deps.relay.connected(s.id) })),
        };
      })
      .filter((c) => (q.type === 'all' ? true : q.type === 'none' ? !c.access : c.access?.type === q.type))
      .filter((c) => (q.status === 'all' ? true : q.status === 'active' ? c.active : q.status === 'inactive' ? !c.active : c.createdAt >= t - 30 * DAY));
    const size = 50;
    return { total: list.length, page: q.page, pageSize: size, customers: list.slice((q.page - 1) * size, q.page * size) };
  });

  // ---- access: give, extend, take back

  app.get('/api/ceo/access', async (request) => {
    ceo(request);
    const q = z.object({ show: z.enum(['active', 'expiring', 'all']).default('active') }).parse(request.query);
    const t = deps.now();
    const rows = db.select({ g: accessGrants, email: accounts.email }).from(accessGrants).innerJoin(accounts, eq(accounts.id, accessGrants.accountId)).orderBy(desc(accessGrants.createdAt)).limit(1000).all();
    const live = (g: Grant) => g.revokedAt === null && (g.endsAt === null || g.endsAt > t);
    const list = rows.filter(({ g }) => (q.show === 'all' ? true : q.show === 'active' ? live(g) : live(g) && g.endsAt !== null && g.endsAt < t + 14 * DAY));
    return { grants: list.slice(0, 300).map(({ g, email }) => grantView(g, email)) };
  });

  /** Gives access: to an account (by id or email), what, why, and until when (or for how many days). */
  app.post('/api/ceo/access', async (request) => {
    const me = ceo(request);
    const body = z
      .object({
        accountId: id.optional(),
        email: z.string().trim().toLowerCase().max(254).email().optional(),
        type: accessType,
        plan: plan.default('remote'),
        days: z.number().int().min(1).max(3650).nullable().optional(),
        until: z.number().int().positive().nullable().optional(),
        note,
      })
      .refine((b) => b.accountId || b.email, 'Choose an account.')
      .parse(request.body);
    const t = deps.now();
    const target = db.select().from(accounts).where(body.accountId ? eq(accounts.id, body.accountId) : eq(accounts.email, body.email!)).get();
    if (!target) throw new CeoError(404, 'There is no Vidalune account with this email address.');
    const endsAt = body.until ?? (body.days ? t + body.days * DAY : null);
    if (endsAt !== null && endsAt <= t) throw new CeoError(400, 'Choose an end date in the future.');
    const g = db.insert(accessGrants).values({ accountId: target.id, type: body.type, plan: body.plan, startsAt: t, endsAt, note: body.note || null, grantedBy: me.email, createdAt: t }).returning().get();
    applyGrants(target.id, me.email);
    return grantView(g, target.email);
  });

  /** Extends access: a new end (or none), or a number of days added to the current end. */
  app.put('/api/ceo/access/:id', async (request) => {
    const me = ceo(request);
    const p = z.object({ id }).parse(request.params);
    const body = z
      .object({ until: z.number().int().positive().nullable().optional(), addDays: z.number().int().min(1).max(3650).optional(), type: accessType.optional(), note: z.string().trim().max(300).nullable().optional() })
      .refine((b) => b.until !== undefined || b.addDays !== undefined || b.type !== undefined || b.note !== undefined, 'Nothing to change.')
      .parse(request.body);
    const g = db.select().from(accessGrants).where(eq(accessGrants.id, p.id)).get();
    if (!g || g.revokedAt !== null) throw new CeoError(404, 'Not found.');
    const t = deps.now();
    const endsAt = body.until !== undefined ? body.until : body.addDays ? Math.max(g.endsAt ?? t, t) + body.addDays * DAY : g.endsAt;
    if (endsAt !== null && endsAt <= t) throw new CeoError(400, 'Choose an end date in the future.');
    db.update(accessGrants)
      .set({ endsAt, ...(body.type ? { type: body.type } : {}), ...(body.note !== undefined ? { note: body.note || null } : {}) })
      .where(eq(accessGrants.id, g.id))
      .run();
    applyGrants(g.accountId, me.email);
    return grantView(db.select().from(accessGrants).where(eq(accessGrants.id, g.id)).get()!);
  });

  /** Takes access back now (kept in the history). */
  app.delete('/api/ceo/access/:id', async (request) => {
    const me = ceo(request);
    const p = z.object({ id }).parse(request.params);
    const g = db.select().from(accessGrants).where(eq(accessGrants.id, p.id)).get();
    if (!g || g.revokedAt !== null) throw new CeoError(404, 'Not found.');
    db.update(accessGrants).set({ revokedAt: deps.now(), revokedBy: me.email }).where(eq(accessGrants.id, g.id)).run();
    applyGrants(g.accountId, me.email);
    return { ok: true };
  });

  // ---- relays

  const relayStats = (nodeIds: number[]) => {
    deps.relay.flush();
    const main = mainRelay();
    const t = deps.now();
    const since = dayOf(t - 29 * DAY);
    const all = db.select({ id: servers.id, name: servers.name, accountId: servers.accountId, relayNodeId: servers.relayNodeId, relayEnabled: servers.relayEnabled, email: accounts.email }).from(servers).leftJoin(accounts, eq(accounts.id, servers.accountId)).where(isNotNull(servers.relaySlug)).all();
    const nodeOf = (s: { relayNodeId: number | null }) => s.relayNodeId ?? main.id;
    const month = new Map(
      db
        .select({ serverId: relayTraffic.serverId, out: sql<number>`sum(${relayTraffic.bytesOut})`, errors: sql<number>`sum(${relayTraffic.errors})`, requests: sql<number>`sum(${relayTraffic.requests})` })
        .from(relayTraffic)
        .where(gte(relayTraffic.day, since))
        .groupBy(relayTraffic.serverId)
        .all()
        .map((r) => [r.serverId, r]),
    );
    const live = deps.relay.now();
    return new Map(
      nodeIds.map((nid) => {
        const assigned = all.filter((s) => nodeOf(s) === nid);
        const mbpsNow = Math.round((assigned.reduce((n, s) => n + (live.bps.get(s.id) ?? 0), 0) * 8) / 10_000) / 100;
        return [
          nid,
          {
            servers: assigned.length,
            customers: new Set(assigned.map((s) => s.accountId).filter(Boolean)).size,
            connected: assigned.filter((s) => deps.relay.connected(s.id)).length,
            mbpsNow,
            month: {
              out: assigned.reduce((n, s) => n + Number(month.get(s.id)?.out ?? 0), 0),
              requests: assigned.reduce((n, s) => n + Number(month.get(s.id)?.requests ?? 0), 0),
              errors: assigned.reduce((n, s) => n + Number(month.get(s.id)?.errors ?? 0), 0),
            },
            assigned,
          },
        ] as const;
      }),
    );
  };

  const nodeView = (n: typeof relayNodes.$inferSelect, s: ReturnType<typeof relayStats> extends Map<number, infer V> ? V : never, mainId: number) => ({
    id: n.id,
    name: n.name,
    region: n.region,
    url: n.url,
    main: n.id === mainId,
    capacityMbps: n.capacityMbps,
    note: n.note,
    active: n.active,
    createdAt: n.createdAt,
    servers: s.servers,
    customers: s.customers,
    connected: s.connected,
    mbpsNow: s.mbpsNow,
    usage: n.capacityMbps ? Math.round((s.mbpsNow / n.capacityMbps) * 1000) / 10 : 0,
    month: s.month,
  });

  app.get('/api/ceo/relays', async (request) => {
    ceo(request);
    const main = mainRelay();
    const nodes = db.select().from(relayNodes).orderBy(relayNodes.id).all();
    const stats = relayStats(nodes.map((n) => n.id));
    return { relays: nodes.map((n) => nodeView(n, stats.get(n.id)!, main.id)) };
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
    note,
  });

  /** Registers another relay: its name, region, address and capacity. */
  app.post('/api/ceo/relays', async (request) => {
    ceo(request);
    const body = relayBody.parse(request.body);
    mainRelay();
    const row = db.insert(relayNodes).values({ ...body, note: body.note || null, active: true, createdAt: deps.now() }).returning().get();
    return nodeView(row, relayStats([row.id]).get(row.id)!, mainRelay().id);
  });

  app.put('/api/ceo/relays/:id', async (request) => {
    ceo(request);
    const p = z.object({ id }).parse(request.params);
    const main = mainRelay();
    const body = relayBody.partial().extend({ active: z.boolean().optional() }).parse(request.body);
    if (p.id === main.id && (body.url !== undefined || body.active === false)) throw new CeoError(400, 'The main relay is vidalune.com itself: its address stays, and it stays on.');
    const res = db.update(relayNodes).set(body).where(eq(relayNodes.id, p.id)).run();
    if (!res.changes) throw new CeoError(404, 'Not found.');
    // A relay turned off: its servers go back to the main relay.
    if (body.active === false) db.update(servers).set({ relayNodeId: null }).where(eq(servers.relayNodeId, p.id)).run();
    const row = db.select().from(relayNodes).where(eq(relayNodes.id, p.id)).get()!;
    return nodeView(row, relayStats([row.id]).get(row.id)!, main.id);
  });

  /** One relay: its servers and customers, and traffic and errors per day (the last 30 days). */
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
    return {
      ...nodeView(node, s, main.id),
      days: daysBetween(t - 29 * DAY, t).map((d) => ({ day: d, out: Number(byDay.get(d)?.out ?? 0), requests: Number(byDay.get(d)?.requests ?? 0), errors: Number(byDay.get(d)?.errors ?? 0) })),
      serverList: s.assigned.map((x) => ({ id: x.id, name: x.name, owner: x.email, relayOn: x.relayEnabled, connected: deps.relay.connected(x.id), mbpsNow: Math.round(((live.bps.get(x.id) ?? 0) * 8) / 10_000) / 100 })),
    };
  });

  /** Assigns (or moves) servers to a relay: one server, or every server of a customer. */
  app.post('/api/ceo/relays/:id/assign', async (request) => {
    ceo(request);
    const p = z.object({ id }).parse(request.params);
    const body = z.object({ serverId: z.string().max(64).optional(), accountId: id.optional() }).refine((b) => b.serverId || b.accountId, 'Choose a server or a customer.').parse(request.body);
    const main = mainRelay();
    const node = db.select().from(relayNodes).where(eq(relayNodes.id, p.id)).get();
    if (!node || !node.active) throw new CeoError(404, 'Not found.');
    const res = db
      .update(servers)
      .set({ relayNodeId: node.id === main.id ? null : node.id })
      .where(body.serverId ? eq(servers.id, body.serverId) : eq(servers.accountId, body.accountId!))
      .run();
    if (!res.changes) throw new CeoError(404, 'No servers found.');
    return { ok: true, moved: res.changes };
  });

  /** Takes a server off a relay: back to the main relay. */
  app.delete('/api/ceo/relays/:id/servers/:serverId', async (request) => {
    ceo(request);
    const p = z.object({ id, serverId: z.string().max(64) }).parse(request.params);
    const res = db.update(servers).set({ relayNodeId: null }).where(and(eq(servers.id, p.serverId), eq(servers.relayNodeId, p.id))).run();
    if (!res.changes) throw new CeoError(404, 'Not found.');
    return { ok: true };
  });

  // ---- statistics over time

  app.get('/api/ceo/statistics', async (request) => {
    ceo(request);
    const q = z.object({ days: z.coerce.number().int().refine((d) => [30, 90, 365].includes(d), 'Choose 30, 90 or 365 days.').default(90) }).parse(request.query);
    const t = deps.now();
    const days = daysBetween(t - (q.days - 1) * DAY, t);
    const first = days[0];
    const createdAll = db.select({ createdAt: accounts.createdAt }).from(accounts).all().map((a) => dayOf(a.createdAt));
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
    return {
      days: days.map((d) => {
        total += newPerDay.get(d) ?? 0;
        const end = Date.parse(d) + DAY - 1;
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
      }),
    };
  });

}
