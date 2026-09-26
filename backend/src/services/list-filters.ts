import { and, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { movies, shows } from '../db/schema.js';
import { scopeCondition, type LibraryScope } from './access.js';

/**
 * Query parameters of the movie/show lists. Smart collections store a subset of these (see
 * FILTER_KEYS) and are evaluated with the same SQL, per viewer.
 */
export const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(60),
  sort: z.enum(['title', 'added', 'year', 'rating', 'release', 'watched', 'runtime']).default('title'),
  order: z.enum(['asc', 'desc']).optional(),
  genre: z.coerce.number().int().positive().optional(),
  library: z.coerce.number().int().positive().optional(),
  /** Watch state; 'completed' is the TV name for 'watched'. */
  filter: z.enum(['all', 'unwatched', 'in-progress', 'watched', 'completed', 'favorites', 'watchlist']).default('all'),
  resolution: z.enum(['4k', '1080p', '720p', 'sd']).optional(),
  hdr: z.enum(['1', 'true']).optional(),
  yearFrom: z.coerce.number().int().min(1870).max(2100).optional(),
  yearTo: z.coerce.number().int().min(1870).max(2100).optional(),
  minRating: z.coerce.number().min(0).max(10).optional(),
  /** Movies no longer than this many minutes. */
  maxRuntime: z.coerce.number().int().min(1).max(1000).optional(),
});

export type ListQuery = z.infer<typeof listQuery>;

/** Keys a smart collection may store (everything that selects items; not paging). */
export const FILTER_KEYS = ['sort', 'order', 'genre', 'filter', 'resolution', 'hdr', 'yearFrom', 'yearTo', 'minRating', 'maxRuntime'] as const;

/** Resolution buckets by width (or height for unusual aspect ratios), matching resolutionLabel in the UI. */
const RESOLUTION_SQL: Record<string, SQL> = {
  '4k': sql`(mf.width >= 3800 OR mf.height >= 2100)`,
  '1080p': sql`(mf.width >= 1900 OR mf.height >= 1000) AND mf.width < 3800 AND mf.height < 2100`,
  '720p': sql`(mf.width >= 1200 OR mf.height >= 700) AND mf.width < 1900 AND mf.height < 1000`,
  sd: sql`mf.width < 1200 AND mf.height < 700`,
};

export const movieRuntime = sql`coalesce(${movies.runtime}, (SELECT max(duration_sec) / 60 FROM media_files WHERE movie_id = ${movies.id}))`;

/** WHERE clause for a movie list, including the viewer's library access. */
export function movieListWhere(q: Partial<ListQuery>, userId: number, scope: LibraryScope): SQL | undefined {
  const conds: SQL[] = [];
  const vis = scopeCondition(scope, movies.libraryId);
  if (vis) conds.push(vis);
  if (q.genre) conds.push(sql`${movies.id} IN (SELECT movie_id FROM movie_genres WHERE genre_id = ${q.genre})`);
  if (q.library) conds.push(eq(movies.libraryId, q.library));
  if (q.filter === 'watched' || q.filter === 'completed') conds.push(sql`${movies.id} IN (SELECT movie_id FROM watch_progress WHERE user_id = ${userId} AND completed = 1 AND movie_id IS NOT NULL)`);
  if (q.filter === 'unwatched') conds.push(sql`${movies.id} NOT IN (SELECT movie_id FROM watch_progress WHERE user_id = ${userId} AND completed = 1 AND movie_id IS NOT NULL)`);
  if (q.filter === 'in-progress') conds.push(sql`${movies.id} IN (SELECT movie_id FROM watch_progress WHERE user_id = ${userId} AND completed = 0 AND position_sec >= 30 AND movie_id IS NOT NULL)`);
  if (q.filter === 'favorites') conds.push(sql`${movies.id} IN (SELECT movie_id FROM favorites WHERE user_id = ${userId} AND movie_id IS NOT NULL)`);
  if (q.filter === 'watchlist') conds.push(sql`${movies.id} IN (SELECT movie_id FROM watchlist WHERE user_id = ${userId} AND movie_id IS NOT NULL)`);
  if (q.resolution) conds.push(sql`EXISTS (SELECT 1 FROM media_files mf WHERE mf.movie_id = ${movies.id} AND ${RESOLUTION_SQL[q.resolution]})`);
  if (q.hdr) conds.push(sql`EXISTS (SELECT 1 FROM media_files mf WHERE mf.movie_id = ${movies.id} AND mf.video_range IN ('HDR10', 'HLG', 'DV'))`);
  if (q.yearFrom) conds.push(sql`${movies.year} >= ${q.yearFrom}`);
  if (q.yearTo) conds.push(sql`${movies.year} <= ${q.yearTo}`);
  if (q.minRating !== undefined) conds.push(sql`${movies.rating} >= ${q.minRating}`);
  if (q.maxRuntime) conds.push(sql`${movieRuntime} <= ${q.maxRuntime}`);
  return conds.length ? and(...conds) : undefined;
}

/** WHERE clause for a show list, including the viewer's library access. */
export function showListWhere(q: Partial<ListQuery>, userId: number, scope: LibraryScope): SQL | undefined {
  const conds: SQL[] = [];
  const vis = scopeCondition(scope, shows.libraryId);
  if (vis) conds.push(vis);
  if (q.genre) conds.push(sql`${shows.id} IN (SELECT show_id FROM show_genres WHERE genre_id = ${q.genre})`);
  if (q.library) conds.push(eq(shows.libraryId, q.library));
  const watchedCount = sql`(SELECT count(*) FROM watch_progress wp JOIN episodes e ON e.id = wp.episode_id WHERE wp.user_id = ${userId} AND wp.completed = 1 AND e.show_id = ${shows.id})`;
  const totalCount = sql`(SELECT count(*) FROM episodes e WHERE e.show_id = ${shows.id})`;
  if (q.filter === 'watched' || q.filter === 'completed') conds.push(sql`${watchedCount} >= ${totalCount}`);
  if (q.filter === 'unwatched') conds.push(sql`${watchedCount} = 0`);
  if (q.filter === 'in-progress') conds.push(sql`${watchedCount} > 0 AND ${watchedCount} < ${totalCount}`);
  if (q.filter === 'favorites') conds.push(sql`${shows.id} IN (SELECT show_id FROM favorites WHERE user_id = ${userId} AND show_id IS NOT NULL)`);
  if (q.filter === 'watchlist') conds.push(sql`${shows.id} IN (SELECT show_id FROM watchlist WHERE user_id = ${userId} AND show_id IS NOT NULL)`);
  if (q.yearFrom) conds.push(sql`${shows.year} >= ${q.yearFrom}`);
  if (q.yearTo) conds.push(sql`${shows.year} <= ${q.yearTo}`);
  if (q.minRating !== undefined) conds.push(sql`${shows.rating} >= ${q.minRating}`);
  return conds.length ? and(...conds) : undefined;
}
