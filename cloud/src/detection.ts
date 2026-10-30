import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from './db/client.js';
import { detectionOverrides, detectionPrints, detectionReports, detectionTitles } from './db/schema.js';

/**
 * Shared intro/recap/credits detection. Servers that turned it on report where they found each
 * part (by TMDB show, season and episode, with the episode's length) and a few audio fingerprints
 * of a season's intro and credits; every server asks for a season's profile: the timings most
 * servers agree on, corrections by the CEO (which every server takes over its own result), and
 * fingerprints to match against its own files. Nothing about files, users or viewing is sent or kept.
 */

export type Kind = 'recap' | 'intro' | 'credits';
export type Source = 'audio' | 'chapters' | 'video' | 'manual';

export interface Report {
  serverId: string;
  episode: number;
  kind: Kind;
  duration: number;
  start: number;
  end: number;
  source: Source;
}

/** What the servers agree on for one part of one cut of an episode. */
export interface Agreement {
  episode: number;
  kind: Kind;
  /** The episode's length (the median of the servers that agree). */
  duration: number;
  start: number;
  end: number;
  /** Servers that found (about) the same. */
  confirmations: number;
  /** Servers that reported this part for this cut at all. */
  reports: number;
  /** One of them set it by hand. */
  manual: boolean;
}

/** Lengths within this many seconds are the same cut of an episode. */
export const DURATION_TOLERANCE = 2;
/** Starts and ends within this many seconds describe the same part. */
export const TIMING_TOLERANCE = 2;

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (n: number) => Math.round(n * 10) / 10;

/**
 * Per episode and part: the cuts (lengths) it was reported for, and in each the timing most
 * servers agree on. A correction by hand counts double when choosing, never in `confirmations`.
 */
export function consensus(reports: Report[]): Agreement[] {
  const groups = new Map<string, Report[]>();
  for (const r of reports) {
    const key = `${r.episode}:${r.kind}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const out: Agreement[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.duration - b.duration);
    // Cuts: a gap of more than the tolerance between lengths starts another one.
    const cuts: Report[][] = [];
    for (const r of sorted) {
      const last = cuts[cuts.length - 1];
      if (last && r.duration - last[last.length - 1].duration <= DURATION_TOLERANCE) last.push(r);
      else cuts.push([r]);
    }
    for (const cut of cuts) {
      let best: Report[] = [];
      const weight = (g: Report[]) => g.reduce((n, r) => n + (r.source === 'manual' ? 2 : 1), 0);
      for (const r of cut) {
        const agree = cut.filter((o) => Math.abs(o.start - r.start) <= TIMING_TOLERANCE && Math.abs(o.end - r.end) <= TIMING_TOLERANCE);
        if (weight(agree) > weight(best)) best = agree;
      }
      const manual = best.filter((r) => r.source === 'manual');
      // A correction by hand is taken as it is; otherwise the middle of what was found.
      const pick = manual.length ? manual : best;
      out.push({
        episode: cut[0].episode,
        kind: cut[0].kind,
        duration: round(median(best.map((r) => r.duration))),
        start: round(median(pick.map((r) => r.start))),
        end: round(median(pick.map((r) => r.end))),
        confirmations: new Set(best.map((r) => r.serverId)).size,
        reports: new Set(cut.map((r) => r.serverId)).size,
        manual: manual.length > 0,
      });
    }
  }
  return out.sort((a, b) => a.episode - b.episode || a.kind.localeCompare(b.kind) || a.duration - b.duration);
}

/** Fingerprints per season and kind a server keeps here, and at most that many given out. */
const PRINTS_PER_SERVER = 3;
const PRINTS_OUT = 6;
/** Hashes per fingerprint: ~0.093 s each, so a bit over six minutes at most. */
const MAX_WORDS = 4096;

const tmdbShow = z.coerce.number().int().positive().max(100_000_000);
const season = z.coerce.number().int().min(0).max(10_000);
const seconds = z.number().min(0).max(36_000);
const part = z
  .object({ kind: z.enum(['recap', 'intro', 'credits']), start: seconds, end: seconds, source: z.enum(['audio', 'chapters', 'video', 'manual']) })
  .refine((p) => p.end > p.start, 'A part ends after it starts.');
const reportBody = z.object({
  tmdbShow,
  season,
  episodes: z
    .array(
      z.object({
        episode: z.number().int().min(0).max(10_000),
        duration: z.number().min(60).max(36_000),
        parts: z.array(part).max(3),
      }),
    )
    .max(200),
  prints: z
    .array(z.object({ kind: z.enum(['intro', 'credits']), words: z.string().max(Math.ceil((MAX_WORDS * 4) / 3) + 4).base64() }))
    .max(PRINTS_PER_SERVER * 2)
    .optional(),
});

export function detectionRoutes(
  app: FastifyInstance,
  deps: { db: DB; server: (request: FastifyRequest) => { id: string }; now: () => number; limit: (key: string) => void },
): void {
  const { db } = deps;

  /** A season's profile for one server: what all servers agree on, and others' fingerprints. */
  const profile = (serverId: string, show: number, s: number) => {
    const reports = db.select().from(detectionReports).where(and(eq(detectionReports.tmdbShow, show), eq(detectionReports.season, s))).all();
    const prints = db
      .select()
      .from(detectionPrints)
      .where(and(eq(detectionPrints.tmdbShow, show), eq(detectionPrints.season, s)))
      .orderBy(desc(detectionPrints.updatedAt))
      .all()
      .filter((p) => p.serverId !== serverId);
    const out = (kind: 'intro' | 'credits') =>
      prints
        .filter((p) => p.kind === kind)
        .slice(0, PRINTS_OUT)
        .map((p) => ({ kind, words: p.words.toString('base64') }));
    return {
      tmdbShow: show,
      season: s,
      servers: new Set(reports.map((r) => r.serverId)).size,
      parts: consensus(reports),
      // What this server itself reported: it knows then which agreement is about its own files.
      mine: reports.filter((r) => r.serverId === serverId).map((r) => ({ episode: r.episode, kind: r.kind, duration: r.duration, start: r.start, end: r.end })),
      prints: [...out('intro'), ...out('credits')],
      // Corrections by the CEO: they go before anything a server found.
      overrides: db
        .select()
        .from(detectionOverrides)
        .where(and(eq(detectionOverrides.tmdbShow, show), eq(detectionOverrides.season, s)))
        .orderBy(detectionOverrides.episode, detectionOverrides.kind, detectionOverrides.duration)
        .all()
        .map((o) => ({ episode: o.episode, kind: o.kind, duration: o.duration, start: o.start, end: o.end })),
    };
  };

  app.get('/api/detection/:tmdbShow/:season', async (request) => {
    const me = deps.server(request);
    deps.limit(`detection-read:${me.id}`);
    const p = z.object({ tmdbShow, season }).parse(request.params);
    return profile(me.id, p.tmdbShow, p.season);
  });

  /** A server reports what it found in a season (replacing what it said before about those episodes). */
  app.post('/api/detection/reports', async (request) => {
    const me = deps.server(request);
    deps.limit(`detection-write:${me.id}`);
    const body = reportBody.parse(request.body);
    const t = deps.now();
    const numbers = [...new Set(body.episodes.map((e) => e.episode))];
    db.transaction((tx) => {
      if (numbers.length)
        tx.delete(detectionReports)
          .where(and(eq(detectionReports.serverId, me.id), eq(detectionReports.tmdbShow, body.tmdbShow), eq(detectionReports.season, body.season), inArray(detectionReports.episode, numbers)))
          .run();
      const rows = body.episodes.flatMap((e) =>
        // One of each kind per episode (the last one wins).
        [...new Map(e.parts.map((p) => [p.kind, p])).values()].map((p) => ({ serverId: me.id, tmdbShow: body.tmdbShow, season: body.season, episode: e.episode, kind: p.kind, duration: e.duration, start: p.start, end: p.end, source: p.source, updatedAt: t })),
      );
      for (let i = 0; i < rows.length; i += 200) tx.insert(detectionReports).values(rows.slice(i, i + 200)).onConflictDoNothing().run();
      if (body.prints) {
        tx.delete(detectionPrints).where(and(eq(detectionPrints.serverId, me.id), eq(detectionPrints.tmdbShow, body.tmdbShow), eq(detectionPrints.season, body.season))).run();
        for (const kind of ['intro', 'credits'] as const) {
          const mine = body.prints.filter((p) => p.kind === kind).slice(0, PRINTS_PER_SERVER);
          mine.forEach((p, slot) => {
            const words = Buffer.from(p.words, 'base64');
            if (words.length < 4 * 20 || words.length % 4 !== 0 || words.length > MAX_WORDS * 4) return;
            tx.insert(detectionPrints).values({ serverId: me.id, tmdbShow: body.tmdbShow, season: body.season, kind, slot, words, updatedAt: t }).run();
          });
        }
      }
    });
    return profile(me.id, body.tmdbShow, body.season);
  });
}

/** A short, stable label for a server in the Control Center (never its id). */
export const serverLabel = (serverId: string) => createHash('sha256').update(serverId).digest('hex').slice(0, 6);

const sameCut = (a: number, b: number) => Math.abs(a - b) <= DURATION_TOLERANCE;
const PAGE_SIZE = 25;
/** A show TMDB did not know is asked again after this long. */
const TITLE_RETRY_MS = 86_400_000;

export interface DetectionCeoDeps {
  db: DB;
  /** The signed-in CEO (throws 401/403 otherwise). */
  ceo: (request: FastifyRequest) => { id: number; email: string };
  /** Writes down what the CEO did. */
  record: (actor: string, action: string, target: string, detail?: Record<string, unknown>) => void;
  /** A show's name at TMDB (null: TMDB does not know it; undefined: not available now). */
  showTitle: (tmdbShow: number) => Promise<string | null | undefined>;
  now: () => number;
}

const kind = z.enum(['recap', 'intro', 'credits']);
const episodeParams = z.object({ tmdbShow, season, episode: z.coerce.number().int().min(0).max(10_000) }).strict();
const overrideBody = z
  .object({ kind, duration: z.number().min(60).max(36_000), start: seconds, end: seconds })
  .strict()
  .refine((b) => b.end > b.start, 'A part ends after it starts.')
  .refine((b) => b.end <= b.duration, 'A part ends within the episode.');

/**
 * The Control Center's view of shared detection: every season servers reported, what they agree
 * on, what administrators corrected by hand (proposals), and the CEO's own corrections.
 */
export function detectionCeoRoutes(app: FastifyInstance, deps: DetectionCeoDeps): void {
  const { db } = deps;
  const where = (show: number, s: number) => `TMDB ${show} S${String(s).padStart(2, '0')}`;

  /** Known names; unknown ones (of these shows) looked up now, a few at a time. */
  const titles = async (shows: number[]): Promise<Map<number, string | null>> => {
    const out = new Map<number, string | null>();
    if (!shows.length) return out;
    const known = db.select().from(detectionTitles).where(inArray(detectionTitles.tmdbShow, shows)).all();
    for (const k of known) out.set(k.tmdbShow, k.title);
    const missing = shows.filter((id) => {
      const k = known.find((x) => x.tmdbShow === id);
      return !k || (k.title === null && deps.now() - k.fetchedAt > TITLE_RETRY_MS);
    });
    await Promise.all(
      missing.map(async (id) => {
        const title = await deps.showTitle(id).catch(() => undefined);
        // Not reachable now: ask again next time. Unknown at TMDB: wait a day.
        if (title === undefined) return;
        const row = { tmdbShow: id, title, fetchedAt: deps.now() };
        db.insert(detectionTitles).values(row).onConflictDoUpdate({ target: detectionTitles.tmdbShow, set: row }).run();
        out.set(id, title);
      }),
    );
    return out;
  };

  /** Corrections by hand from servers not (yet) settled by a correction of the CEO. */
  const openProposals = (reports: Array<typeof detectionReports.$inferSelect>, overrides: Array<typeof detectionOverrides.$inferSelect>) =>
    reports.filter((r) => r.source === 'manual' && !overrides.some((o) => o.episode === r.episode && o.kind === r.kind && sameCut(o.duration, r.duration)));

  app.get('/api/ceo/detection', async (request) => {
    deps.ceo(request);
    const q = z.object({ q: z.string().trim().max(200).default(''), page: z.coerce.number().int().min(1).max(10_000).default(1) }).strict().parse(request.query);
    const seasons = new Map<string, { tmdbShow: number; season: number; servers: number; episodes: number; updatedAt: number }>();
    for (const r of db
      .select({ tmdbShow: detectionReports.tmdbShow, season: detectionReports.season, servers: sql<number>`count(distinct ${detectionReports.serverId})`, episodes: sql<number>`count(distinct ${detectionReports.episode})`, updatedAt: sql<number>`max(${detectionReports.updatedAt})` })
      .from(detectionReports)
      .groupBy(detectionReports.tmdbShow, detectionReports.season)
      .all())
      seasons.set(`${r.tmdbShow}:${r.season}`, r);
    for (const o of db
      .select({ tmdbShow: detectionOverrides.tmdbShow, season: detectionOverrides.season, updatedAt: sql<number>`max(${detectionOverrides.updatedAt})` })
      .from(detectionOverrides)
      .groupBy(detectionOverrides.tmdbShow, detectionOverrides.season)
      .all()) {
      const key = `${o.tmdbShow}:${o.season}`;
      const have = seasons.get(key);
      if (have) have.updatedAt = Math.max(have.updatedAt, o.updatedAt);
      else seasons.set(key, { tmdbShow: o.tmdbShow, season: o.season, servers: 0, episodes: 0, updatedAt: o.updatedAt });
    }
    let list = [...seasons.values()];
    if (q.q) {
      const id = /^\d+$/.test(q.q) ? Number(q.q) : null;
      const needle = q.q.toLowerCase();
      const named = new Set(db.select().from(detectionTitles).all().filter((t) => t.title?.toLowerCase().includes(needle)).map((t) => t.tmdbShow));
      list = list.filter((x) => x.tmdbShow === id || named.has(x.tmdbShow));
    }
    list.sort((a, b) => b.updatedAt - a.updatedAt || a.tmdbShow - b.tmdbShow || a.season - b.season);
    const total = list.length;
    const page = list.slice((q.page - 1) * PAGE_SIZE, q.page * PAGE_SIZE);
    const names = await titles([...new Set(page.map((x) => x.tmdbShow))]);
    const items = page.map((x) => {
      const reports = db.select().from(detectionReports).where(and(eq(detectionReports.tmdbShow, x.tmdbShow), eq(detectionReports.season, x.season))).all();
      const overrides = db.select().from(detectionOverrides).where(and(eq(detectionOverrides.tmdbShow, x.tmdbShow), eq(detectionOverrides.season, x.season))).all();
      return { ...x, title: names.get(x.tmdbShow) ?? null, overrides: overrides.length, proposals: openProposals(reports, overrides).length };
    });
    return { items, total, page: q.page, pageSize: PAGE_SIZE };
  });

  app.get('/api/ceo/detection/:tmdbShow/:season', async (request) => {
    deps.ceo(request);
    const p = z.object({ tmdbShow, season }).strict().parse(request.params);
    const reports = db.select().from(detectionReports).where(and(eq(detectionReports.tmdbShow, p.tmdbShow), eq(detectionReports.season, p.season))).all();
    const overrides = db.select().from(detectionOverrides).where(and(eq(detectionOverrides.tmdbShow, p.tmdbShow), eq(detectionOverrides.season, p.season))).all();
    type Entry = {
      episode: number;
      kind: Kind;
      duration: number;
      consensus: { start: number; end: number; confirmations: number; reports: number; manual: boolean } | null;
      proposals: Array<{ server: string; start: number; end: number }>;
      override: { start: number; end: number; updatedAt: number } | null;
    };
    const entries: Entry[] = [];
    const entryFor = (episode: number, k: Kind, duration: number) => {
      let e = entries.find((x) => x.episode === episode && x.kind === k && sameCut(x.duration, duration));
      if (!e) {
        e = { episode, kind: k, duration, consensus: null, proposals: [], override: null };
        entries.push(e);
      }
      return e;
    };
    for (const a of consensus(reports)) entryFor(a.episode, a.kind, a.duration).consensus = { start: a.start, end: a.end, confirmations: a.confirmations, reports: a.reports, manual: a.manual };
    for (const o of overrides) entryFor(o.episode, o.kind, o.duration).override = { start: o.start, end: o.end, updatedAt: o.updatedAt };
    for (const r of openProposals(reports, overrides)) entryFor(r.episode, r.kind, r.duration).proposals.push({ server: serverLabel(r.serverId), start: r.start, end: r.end });
    const order: Kind[] = ['recap', 'intro', 'credits'];
    entries.sort((a, b) => a.episode - b.episode || a.duration - b.duration || order.indexOf(a.kind) - order.indexOf(b.kind));
    const names = await titles([p.tmdbShow]);
    return { tmdbShow: p.tmdbShow, season: p.season, title: names.get(p.tmdbShow) ?? null, servers: new Set(reports.map((r) => r.serverId)).size, entries };
  });

  /** Sets the CEO's correction for one cut of an episode (replacing an earlier one of that cut). */
  app.put('/api/ceo/detection/:tmdbShow/:season/:episode', async (request) => {
    const me = deps.ceo(request);
    const p = episodeParams.parse(request.params);
    const b = overrideBody.parse(request.body);
    const round = (n: number) => Math.round(n * 10) / 10;
    const before = db
      .select()
      .from(detectionOverrides)
      .where(and(eq(detectionOverrides.tmdbShow, p.tmdbShow), eq(detectionOverrides.season, p.season), eq(detectionOverrides.episode, p.episode), eq(detectionOverrides.kind, b.kind)))
      .all()
      .filter((o) => sameCut(o.duration, b.duration));
    const row = { tmdbShow: p.tmdbShow, season: p.season, episode: p.episode, kind: b.kind, duration: round(b.duration), start: round(b.start), end: round(b.end), updatedAt: deps.now(), updatedBy: me.id };
    db.transaction((tx) => {
      if (before.length) tx.delete(detectionOverrides).where(inArray(detectionOverrides.id, before.map((o) => o.id))).run();
      tx.insert(detectionOverrides).values(row).run();
    });
    deps.record(me.email, 'detection.corrected', `${where(p.tmdbShow, p.season)}E${String(p.episode).padStart(2, '0')}`, {
      kind: b.kind,
      duration: row.duration,
      start: row.start,
      end: row.end,
      before: before[0] ? { start: before[0].start, end: before[0].end } : null,
    });
    return { ok: true, override: { episode: row.episode, kind: row.kind, duration: row.duration, start: row.start, end: row.end } };
  });

  app.delete('/api/ceo/detection/:tmdbShow/:season/:episode', async (request) => {
    const me = deps.ceo(request);
    const p = episodeParams.parse(request.params);
    const q = z.object({ kind, duration: z.coerce.number().min(60).max(36_000) }).strict().parse(request.query);
    const gone = db
      .select()
      .from(detectionOverrides)
      .where(and(eq(detectionOverrides.tmdbShow, p.tmdbShow), eq(detectionOverrides.season, p.season), eq(detectionOverrides.episode, p.episode), eq(detectionOverrides.kind, q.kind)))
      .all()
      .filter((o) => sameCut(o.duration, q.duration));
    if (!gone.length) throw new DetectionError(404, 'There is no correction for this part.');
    db.delete(detectionOverrides).where(inArray(detectionOverrides.id, gone.map((o) => o.id))).run();
    deps.record(me.email, 'detection.correctionRemoved', `${where(p.tmdbShow, p.season)}E${String(p.episode).padStart(2, '0')}`, { kind: q.kind, duration: gone[0].duration, start: gone[0].start, end: gone[0].end });
    return { ok: true };
  });
}

export class DetectionError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
