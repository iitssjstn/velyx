import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { episodes, favorites, mediaFiles, movies, shows, watchProgress } from '../db/schema.js';

export interface ProgressInfo {
  positionSec: number;
  durationSec: number;
  completed: boolean;
  updatedAt: number;
}

export interface MovieCard {
  type: 'movie';
  id: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  rating: number | null;
  runtime: number | null;
  overview: string | null;
  addedAt: number;
  progress: ProgressInfo | null;
  favorite: boolean;
}

export interface ShowCard {
  type: 'show';
  id: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  rating: number | null;
  overview: string | null;
  addedAt: number;
  episodeCount: number;
  watchedCount: number;
  favorite: boolean;
}

type MovieRow = typeof movies.$inferSelect;
type ShowRow = typeof shows.$inferSelect;

function progressFromRow(r: typeof watchProgress.$inferSelect | undefined): ProgressInfo | null {
  if (!r) return null;
  return { positionSec: r.positionSec, durationSec: r.durationSec, completed: r.completed, updatedAt: r.updatedAt };
}

export class Catalog {
  constructor(private readonly db: DB) {}

  movieProgress(userId: number, movieIds: number[]): Map<number, ProgressInfo> {
    const map = new Map<number, ProgressInfo>();
    if (!movieIds.length) return map;
    const rows = this.db
      .select()
      .from(watchProgress)
      .where(and(eq(watchProgress.userId, userId), inArray(watchProgress.movieId, movieIds)))
      .all();
    for (const r of rows) if (r.movieId) map.set(r.movieId, progressFromRow(r)!);
    return map;
  }

  episodeProgress(userId: number, episodeIds: number[]): Map<number, ProgressInfo> {
    const map = new Map<number, ProgressInfo>();
    if (!episodeIds.length) return map;
    for (let i = 0; i < episodeIds.length; i += 500) {
      const rows = this.db
        .select()
        .from(watchProgress)
        .where(and(eq(watchProgress.userId, userId), inArray(watchProgress.episodeId, episodeIds.slice(i, i + 500))))
        .all();
      for (const r of rows) if (r.episodeId) map.set(r.episodeId, progressFromRow(r)!);
    }
    return map;
  }

  favoriteIds(userId: number): { movies: Set<number>; shows: Set<number> } {
    const rows = this.db.select().from(favorites).where(eq(favorites.userId, userId)).all();
    return {
      movies: new Set(rows.filter((r) => r.movieId).map((r) => r.movieId!)),
      shows: new Set(rows.filter((r) => r.showId).map((r) => r.showId!)),
    };
  }

  movieCards(userId: number, rows: MovieRow[]): MovieCard[] {
    const progress = this.movieProgress(userId, rows.map((r) => r.id));
    const favs = this.favoriteIds(userId);
    return rows.map((m) => ({
      type: 'movie',
      id: m.id,
      title: m.title,
      year: m.year,
      posterPath: m.posterPath,
      backdropPath: m.backdropPath,
      rating: m.rating,
      runtime: m.runtime,
      overview: m.overview,
      addedAt: m.addedAt,
      progress: progress.get(m.id) ?? null,
      favorite: favs.movies.has(m.id),
    }));
  }

  showCards(userId: number, rows: ShowRow[]): ShowCard[] {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const counts = this.db
      .select({ showId: episodes.showId, total: sql<number>`count(*)` })
      .from(episodes)
      .where(inArray(episodes.showId, ids))
      .groupBy(episodes.showId)
      .all();
    const watched = this.db
      .select({ showId: episodes.showId, total: sql<number>`count(*)` })
      .from(watchProgress)
      .innerJoin(episodes, eq(episodes.id, watchProgress.episodeId))
      .where(and(eq(watchProgress.userId, userId), eq(watchProgress.completed, true), inArray(episodes.showId, ids)))
      .groupBy(episodes.showId)
      .all();
    const countMap = new Map(counts.map((c) => [c.showId, Number(c.total)]));
    const watchedMap = new Map(watched.map((c) => [c.showId, Number(c.total)]));
    const favs = this.favoriteIds(userId);
    return rows.map((s) => ({
      type: 'show',
      id: s.id,
      title: s.title,
      year: s.year,
      posterPath: s.posterPath,
      backdropPath: s.backdropPath,
      rating: s.rating,
      overview: s.overview,
      addedAt: s.lastEpisodeAddedAt,
      episodeCount: countMap.get(s.id) ?? 0,
      watchedCount: watchedMap.get(s.id) ?? 0,
      favorite: favs.shows.has(s.id),
    }));
  }

  /** Best file for an item: prefers files that probed successfully and have the highest resolution. */
  primaryFile(where: { movieId?: number; episodeId?: number }) {
    const files = this.db
      .select()
      .from(mediaFiles)
      .where(where.movieId ? eq(mediaFiles.movieId, where.movieId) : eq(mediaFiles.episodeId, where.episodeId!))
      .orderBy(desc(mediaFiles.height), desc(mediaFiles.size))
      .all();
    return files.find((f) => !f.probeError) ?? files[0] ?? null;
  }

  /** The episode that follows `episodeId` in airing order (next episode of the season, or first of the next season). */
  nextEpisode(episodeId: number) {
    const ep = this.db.select().from(episodes).where(eq(episodes.id, episodeId)).get();
    if (!ep) return null;
    return (
      this.db
        .select()
        .from(episodes)
        .where(
          and(
            eq(episodes.showId, ep.showId),
            sql`(${episodes.seasonNumber} > ${ep.seasonNumber} OR (${episodes.seasonNumber} = ${ep.seasonNumber} AND ${episodes.episodeNumber} > ${ep.episodeNumber}))`,
          ),
        )
        .orderBy(episodes.seasonNumber, episodes.episodeNumber)
        .limit(1)
        .get() ?? null
    );
  }

  previousEpisode(episodeId: number) {
    const ep = this.db.select().from(episodes).where(eq(episodes.id, episodeId)).get();
    if (!ep) return null;
    return (
      this.db
        .select()
        .from(episodes)
        .where(
          and(
            eq(episodes.showId, ep.showId),
            sql`(${episodes.seasonNumber} < ${ep.seasonNumber} OR (${episodes.seasonNumber} = ${ep.seasonNumber} AND ${episodes.episodeNumber} < ${ep.episodeNumber}))`,
          ),
        )
        .orderBy(desc(episodes.seasonNumber), desc(episodes.episodeNumber))
        .limit(1)
        .get() ?? null
    );
  }
}
