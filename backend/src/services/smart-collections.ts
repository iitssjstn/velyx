import { asc, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db/client.js';
import { collections, movies, shows } from '../db/schema.js';
import type { LibraryScope } from './access.js';
import { FILTER_KEYS, listQuery, movieListWhere, showListWhere, type ListQuery } from './list-filters.js';

/**
 * Smart collections are saved list filters, not copies of items: each is evaluated with the same
 * SQL as the Movies/TV Shows pages, for the viewer (their library access and watch state). A few
 * are built in; admins can save their own filter combinations.
 */
export type SmartKind = 'movies' | 'shows';

export interface SmartDefinition {
  key: string;
  name: string;
  kind: SmartKind;
  query: Partial<Record<(typeof FILTER_KEYS)[number], string>>;
}

export const BUILT_IN: SmartDefinition[] = [
  { key: 'recently-added', name: 'Recently Added', kind: 'movies', query: { sort: 'added' } },
  { key: 'unwatched', name: 'Unwatched Movies', kind: 'movies', query: { filter: 'unwatched', sort: 'added' } },
  { key: 'top-rated', name: 'Top Rated', kind: 'movies', query: { minRating: '8', sort: 'rating' } },
  { key: '4k', name: '4K Movies', kind: 'movies', query: { resolution: '4k' } },
  { key: '1080p', name: '1080p Movies', kind: 'movies', query: { resolution: '1080p' } },
  { key: 'hdr', name: 'HDR', kind: 'movies', query: { hdr: '1' } },
  { key: 'short', name: 'Short Movies', kind: 'movies', query: { maxRuntime: '95', sort: 'runtime', order: 'asc' } },
  { key: 'favorites', name: 'Favorites', kind: 'movies', query: { filter: 'favorites' } },
  { key: 'shows-in-progress', name: 'Shows in Progress', kind: 'shows', query: { filter: 'in-progress', sort: 'watched' } },
  { key: 'shows-unwatched', name: 'Unwatched Shows', kind: 'shows', query: { filter: 'unwatched', sort: 'added' } },
];

/** Validates stored or submitted rules: only list filters, with valid values. */
export const smartRules = z.object({
  kind: z.enum(['movies', 'shows']),
  query: z.partialRecord(z.enum(FILTER_KEYS), z.string().max(20)).superRefine((q, ctx) => {
    const parsed = listQuery.safeParse(q);
    if (!parsed.success) ctx.addIssue({ code: 'custom', message: parsed.error.issues[0]?.message ?? 'Invalid filter' });
  }),
});

export interface SmartCollectionView extends SmartDefinition {
  id: number | null;
  custom: boolean;
  count: number;
  posterPath: string | null;
  backdropPath: string | null;
}

function evaluate(db: DB, def: SmartDefinition, userId: number, scope: LibraryScope): Pick<SmartCollectionView, 'count' | 'posterPath' | 'backdropPath'> {
  const q = listQuery.parse(def.query) as ListQuery;
  const table = def.kind === 'movies' ? movies : shows;
  const where: SQL | undefined = def.kind === 'movies' ? movieListWhere(q, userId, scope) : showListWhere(q, userId, scope);
  const n = db.select({ n: count() }).from(table).where(where).get()!.n;
  if (!n) return { count: 0, posterPath: null, backdropPath: null };
  // Artwork: the first item with a poster, in the collection's own order.
  const order = q.sort === 'added' ? desc(def.kind === 'movies' ? movies.addedAt : shows.lastEpisodeAddedAt) : q.sort === 'rating' ? desc(table.rating) : asc(table.sortTitle);
  const first = db
    .select({ posterPath: table.posterPath, backdropPath: table.backdropPath })
    .from(table)
    .where(sql`${where ?? sql`1`} AND ${table.posterPath} IS NOT NULL`)
    .orderBy(order)
    .limit(1)
    .get();
  return { count: n, posterPath: first?.posterPath ?? null, backdropPath: first?.backdropPath ?? null };
}

/** Movies by decade, only decades that exist in the viewer's libraries. */
function decades(db: DB, userId: number, scope: LibraryScope): SmartDefinition[] {
  const where = movieListWhere({}, userId, scope);
  const rows = db
    .select({ decade: sql<number>`(${movies.year} / 10) * 10`, n: count() })
    .from(movies)
    .where(sql`${where ?? sql`1`} AND ${movies.year} IS NOT NULL`)
    .groupBy(sql`(${movies.year} / 10) * 10`)
    .orderBy(desc(sql`(${movies.year} / 10) * 10`))
    .all();
  return rows.filter((r) => r.n >= 2).map((r) => ({ key: `decade-${r.decade}`, name: `${r.decade}s`, kind: 'movies' as const, query: { yearFrom: String(r.decade), yearTo: String(r.decade + 9), sort: 'year', order: 'asc' } }));
}

/** All smart collections for a viewer, with how many items each holds for them (empty ones hidden). */
export function smartCollections(db: DB, userId: number, scope: LibraryScope, isAdmin: boolean): SmartCollectionView[] {
  const custom = db.select().from(collections).where(eq(collections.kind, 'smart')).orderBy(asc(collections.sortTitle)).all();
  const defs: Array<SmartDefinition & { id: number | null; custom: boolean }> = [
    ...custom.flatMap((c) => {
      const r = smartRules.safeParse(JSON.parse(c.rules ?? '{}'));
      return r.success ? [{ key: `custom-${c.id}`, id: c.id, custom: true, name: c.name, kind: r.data.kind, query: r.data.query }] : [];
    }),
    ...[...BUILT_IN, ...decades(db, userId, scope)].map((d) => ({ ...d, id: null, custom: false })),
  ];
  return defs
    .map((d) => ({ ...d, ...evaluate(db, d, userId, scope) }))
    // Admins keep seeing their own (empty) smart collections so they can manage them.
    .filter((d) => d.count > 0 || (d.custom && isAdmin));
}
