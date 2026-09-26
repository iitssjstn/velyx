import { and, count, desc, eq, gte, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { playbackSessions } from '../db/schema.js';

/** A viewing counts as a play once this much was actually watched. */
export const MIN_PLAY_SEC = 60;

export type Granularity = 'day' | 'week' | 'month';

export interface ActivityStats {
  days: number;
  from: number;
  totals: { plays: number; watchSec: number; movies: number; episodes: number; users: number };
  modes: { direct: { plays: number; watchSec: number }; remux: { plays: number; watchSec: number }; audioConverted: number };
  granularity: Granularity;
  /** Watch time per day, week (starting Monday) or month, oldest first, without gaps. */
  timeline: { period: string; watchSec: number; plays: number }[];
  topMovies: { id: number; title: string; subtitle: string | null; plays: number; watchSec: number }[];
  topShows: { id: number; title: string; plays: number; watchSec: number }[];
  topUsers: { userId: number | null; username: string; plays: number; watchSec: number }[];
  clients: { device: string; plays: number; watchSec: number }[];
}

export interface HistoryEntry {
  id: number;
  userId: number | null;
  username: string;
  kind: 'movie' | 'episode';
  movieId: number | null;
  episodeId: number | null;
  showId: number | null;
  title: string;
  subtitle: string | null;
  mode: 'direct' | 'remux';
  audioConversion: string | null;
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  bitrate: number | null;
  device: string | null;
  startedAt: number;
  endedAt: number | null;
  watchedSec: number;
  positionSec: number | null;
  durationSec: number | null;
}

const localDay = sql`${playbackSessions.startedAt} / 1000, 'unixepoch', 'localtime'`;

function granularityFor(days: number): Granularity {
  return days <= 31 ? 'day' : days <= 120 ? 'week' : 'month';
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Every period between `from` and `now` (local time), so quiet days show as zero. */
export function periods(from: number, now: number, g: Granularity): string[] {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  if (g === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (g === 'month') d.setDate(1);
  const out: string[] = [];
  while (d.getTime() <= now) {
    out.push(g === 'month' ? dayKey(d).slice(0, 7) : dayKey(d));
    if (g === 'day') d.setDate(d.getDate() + 1);
    else if (g === 'week') d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
  }
  return out;
}

/**
 * Watch statistics for the last `days` days, straight from playback_sessions (indexed on the start
 * time). Only viewings of at least a minute count as plays; watch time counts everything played.
 */
export function activityStats(db: DB, days: number, now = Date.now()): ActivityStats {
  const from = now - days * 86_400_000;
  const inRange = gte(playbackSessions.startedAt, from);
  const played = and(inRange, gte(playbackSessions.watchedSec, MIN_PLAY_SEC));
  const watch = sql<number>`coalesce(sum(${playbackSessions.watchedSec}), 0)`;
  const plays = sql<number>`coalesce(sum(case when ${playbackSessions.watchedSec} >= ${MIN_PLAY_SEC} then 1 else 0 end), 0)`;

  const t = db
    .select({
      plays,
      watchSec: watch,
      movies: sql<number>`count(distinct case when ${playbackSessions.watchedSec} >= ${MIN_PLAY_SEC} then ${playbackSessions.movieId} end)`,
      episodes: sql<number>`count(distinct case when ${playbackSessions.watchedSec} >= ${MIN_PLAY_SEC} then ${playbackSessions.episodeId} end)`,
      users: sql<number>`count(distinct case when ${playbackSessions.watchedSec} >= ${MIN_PLAY_SEC} then ${playbackSessions.username} end)`,
      audioConverted: sql<number>`coalesce(sum(case when ${playbackSessions.watchedSec} >= ${MIN_PLAY_SEC} and ${playbackSessions.audioConversion} is not null then 1 else 0 end), 0)`,
    })
    .from(playbackSessions)
    .where(inRange)
    .get()!;
  const byMode = db.select({ mode: playbackSessions.mode, plays, watchSec: watch }).from(playbackSessions).where(inRange).groupBy(playbackSessions.mode).all();
  const mode = (m: 'direct' | 'remux') => {
    const r = byMode.find((x) => x.mode === m);
    return { plays: r?.plays ?? 0, watchSec: r?.watchSec ?? 0 };
  };

  const granularity = granularityFor(days);
  const bucket =
    granularity === 'day'
      ? sql<string>`strftime('%Y-%m-%d', ${localDay})`
      : granularity === 'week'
        ? sql<string>`date(${localDay}, '-6 days', 'weekday 1')`
        : sql<string>`strftime('%Y-%m', ${localDay})`;
  const rows = new Map(
    db
      .select({ period: bucket, watchSec: watch, plays })
      .from(playbackSessions)
      .where(inRange)
      .groupBy(bucket)
      .all()
      .map((r) => [r.period, r]),
  );
  const timeline = periods(from, now, granularity).map((p) => ({ period: p, watchSec: rows.get(p)?.watchSec ?? 0, plays: rows.get(p)?.plays ?? 0 }));

  const latestTitle = sql<string>`max(${playbackSessions.title})`;
  const topMovies = db
    .select({ id: sql<number>`${playbackSessions.movieId}`, title: latestTitle, subtitle: sql<string | null>`max(${playbackSessions.subtitle})`, plays: count(), watchSec: watch })
    .from(playbackSessions)
    .where(and(played, isNotNull(playbackSessions.movieId)))
    .groupBy(playbackSessions.movieId)
    .orderBy(desc(count()), desc(watch))
    .limit(10)
    .all();
  const topShows = db
    .select({ id: sql<number>`${playbackSessions.showId}`, title: latestTitle, plays: count(), watchSec: watch })
    .from(playbackSessions)
    .where(and(played, isNotNull(playbackSessions.showId)))
    .groupBy(playbackSessions.showId)
    .orderBy(desc(count()), desc(watch))
    .limit(10)
    .all();
  const topUsers = db
    .select({ userId: sql<number | null>`max(${playbackSessions.userId})`, username: playbackSessions.username, plays, watchSec: watch })
    .from(playbackSessions)
    .where(inRange)
    .groupBy(playbackSessions.username)
    .orderBy(desc(watch))
    .limit(10)
    .all();
  const device = sql<string>`coalesce(${playbackSessions.device}, 'Unknown')`;
  const clients = db.select({ device, plays, watchSec: watch }).from(playbackSessions).where(inRange).groupBy(device).orderBy(desc(watch)).limit(10).all();

  return {
    days,
    from,
    totals: { plays: t.plays, watchSec: t.watchSec, movies: t.movies, episodes: t.episodes, users: t.users },
    modes: { direct: mode('direct'), remux: mode('remux'), audioConverted: t.audioConverted },
    granularity,
    timeline,
    topMovies,
    topShows,
    topUsers,
    clients,
  };
}

/** The activity log, newest first; optionally one user's or one kind of media. */
export function playbackHistory(db: DB, opts: { page: number; limit: number; userId?: number; kind?: 'movie' | 'episode' }): { total: number; items: HistoryEntry[] } {
  const conds: SQL[] = [];
  if (opts.userId !== undefined) conds.push(eq(playbackSessions.userId, opts.userId));
  if (opts.kind) conds.push(eq(playbackSessions.kind, opts.kind));
  const where = conds.length ? and(...conds) : undefined;
  const total = db.select({ n: count() }).from(playbackSessions).where(where).get()!.n;
  const items = db
    .select()
    .from(playbackSessions)
    .where(where)
    .orderBy(desc(playbackSessions.startedAt), desc(playbackSessions.id))
    .limit(opts.limit)
    .offset((opts.page - 1) * opts.limit)
    .all()
    .map(({ lastSeenAt: _l, mediaFileId: _f, startPositionSec: _s, ...r }) => r);
  return { total, items };
}
