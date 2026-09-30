import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from './db/client.js';
import { detectionPrints, detectionReports } from './db/schema.js';

/**
 * Shared intro/recap/credits detection. Servers that turned it on report where they found each
 * part (by TMDB show, season and episode, with the episode's length) and a few audio fingerprints
 * of a season's intro and credits; every server asks for a season's profile: the timings most
 * servers agree on, and fingerprints to match against its own files. Nothing about files, users
 * or viewing is sent or kept.
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
