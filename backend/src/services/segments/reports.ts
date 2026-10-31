import { and, count, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import type { DB } from '../../db/client.js';
import { episodes, mediaFiles, segmentReports, users } from '../../db/schema.js';

export const REPORT_KINDS = ['recap', 'intro', 'credits'] as const;
export const REPORT_PROBLEMS = ['starts-early', 'starts-late', 'ends-early', 'ends-late', 'not-there', 'missing'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export type ReportProblem = (typeof REPORT_PROBLEMS)[number];

/** Reports one user may send in an hour. */
export const REPORTS_PER_HOUR = 10;
const HOUR = 3_600_000;

/** How a problem reads in a message to administrators (translated through the server's catalog). */
export const PROBLEM_TEXT: Record<ReportProblem, string> = {
  'starts-early': 'starts too early',
  'starts-late': 'starts too late',
  'ends-early': 'ends too early',
  'ends-late': 'ends too late',
  'not-there': 'is marked but is not there',
  missing: 'is there but not marked',
};
export const KIND_TEXT: Record<ReportKind, string> = { recap: 'Recap', intro: 'Intro', credits: 'Credits' };

/** Reports sent by this user in the last hour (open, resolved or replaced alike). */
export function recentReports(db: DB, userId: number, now = Date.now()): number {
  return db.select({ n: count() }).from(segmentReports).where(and(eq(segmentReports.userId, userId), gte(segmentReports.createdAt, now - HOUR))).get()?.n ?? 0;
}

/** Stores a report; an open one of the same user, episode and part is replaced (marked done). */
export function addReport(db: DB, r: { episodeId: number; userId: number; kind: ReportKind; problem: ReportProblem; position: number | null }, now = Date.now()): void {
  db.transaction((tx) => {
    tx.update(segmentReports)
      .set({ resolvedAt: now })
      .where(and(eq(segmentReports.episodeId, r.episodeId), eq(segmentReports.userId, r.userId), eq(segmentReports.kind, r.kind), isNull(segmentReports.resolvedAt)))
      .run();
    tx.insert(segmentReports).values({ ...r, createdAt: now }).run();
  });
}

/** Open reports of these episodes, newest first, with the reporter's name. */
export function openReports(db: DB, episodeIds: number[]) {
  if (!episodeIds.length) return [];
  return db
    .select({ id: segmentReports.id, episodeId: segmentReports.episodeId, kind: segmentReports.kind, problem: segmentReports.problem, position: segmentReports.position, createdAt: segmentReports.createdAt, user: users.username })
    .from(segmentReports)
    .innerJoin(users, eq(users.id, segmentReports.userId))
    .where(and(inArray(segmentReports.episodeId, episodeIds), isNull(segmentReports.resolvedAt)))
    .orderBy(desc(segmentReports.createdAt))
    .all();
}

export function openReportCount(db: DB): number {
  return db.select({ n: count() }).from(segmentReports).where(isNull(segmentReports.resolvedAt)).get()?.n ?? 0;
}

/** Marks one open report done; false when there is no such open report. */
export function resolveReport(db: DB, id: number, now = Date.now()): { episodeId: number } | null {
  const row = db.select({ episodeId: segmentReports.episodeId }).from(segmentReports).where(and(eq(segmentReports.id, id), isNull(segmentReports.resolvedAt))).get();
  if (!row) return null;
  db.update(segmentReports).set({ resolvedAt: now }).where(eq(segmentReports.id, id)).run();
  return row;
}

/** All open reports of an episode done (it was corrected or analysed again). */
export function resolveEpisodeReports(db: DB, episodeIds: number[], now = Date.now()): number {
  if (!episodeIds.length) return 0;
  return db.update(segmentReports).set({ resolvedAt: now }).where(and(inArray(segmentReports.episodeId, episodeIds), isNull(segmentReports.resolvedAt))).run().changes;
}

/**
 * Open reports of a season, grouped per episode, file length, part and problem, for vidalune.com
 * (no users, no positions).
 */
export function seasonComplaints(db: DB, showId: number, season: number): Array<{ episode: number; duration: number; kind: ReportKind; problem: ReportProblem; count: number }> {
  const rows = db
    .select({ episodeId: segmentReports.episodeId, number: episodes.episodeNumber, kind: segmentReports.kind, problem: segmentReports.problem })
    .from(segmentReports)
    .innerJoin(episodes, eq(episodes.id, segmentReports.episodeId))
    .where(and(eq(episodes.showId, showId), eq(episodes.seasonNumber, season), isNull(segmentReports.resolvedAt)))
    .all();
  if (!rows.length) return [];
  // The length of the file playback picks first (the one detection analyses).
  const lengths = new Map<number, number>();
  for (const f of db
    .select({ episodeId: mediaFiles.episodeId, duration: mediaFiles.durationSec })
    .from(mediaFiles)
    .where(inArray(mediaFiles.episodeId, [...new Set(rows.map((r) => r.episodeId))]))
    .orderBy(desc(mediaFiles.height), mediaFiles.id)
    .all()) {
    if (f.episodeId !== null && f.duration && !lengths.has(f.episodeId)) lengths.set(f.episodeId, f.duration);
  }
  const groups = new Map<string, { episode: number; duration: number; kind: ReportKind; problem: ReportProblem; count: number }>();
  for (const r of rows) {
    const duration = lengths.get(r.episodeId);
    if (!duration || duration <= 60) continue;
    const key = `${r.number}:${r.kind}:${r.problem}`;
    const g = groups.get(key);
    if (g) g.count++;
    else groups.set(key, { episode: r.number, duration: Math.round(duration * 10) / 10, kind: r.kind, problem: r.problem, count: 1 });
  }
  return [...groups.values()];
}
