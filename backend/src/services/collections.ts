import { asc, eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { collectionItems, collections, movies, shows } from '../db/schema.js';
import { canSee, type LibraryScope } from './access.js';

/** TMDB collections are only worth showing when the library holds at least this many of their movies. */
export const MIN_AUTO_COLLECTION_SIZE = 2;

type CollectionRow = typeof collections.$inferSelect;

export interface CollectionMember {
  collectionId: number;
  movieId: number | null;
  showId: number | null;
  addedAt: number;
}

export interface VisibleCollection {
  row: CollectionRow;
  members: CollectionMember[];
}

/**
 * Collections as one user sees them: only members from libraries they can access, and only
 * collections that are worth showing. Admins also see empty manual collections so they can fill them.
 */
export function visibleCollections(db: DB, scope: LibraryScope, isAdmin: boolean): VisibleCollection[] {
  const rows = db.select().from(collections).orderBy(asc(collections.sortTitle)).all();
  const members = db
    .select({
      collectionId: collectionItems.collectionId,
      movieId: collectionItems.movieId,
      showId: collectionItems.showId,
      addedAt: collectionItems.addedAt,
      libraryId: sql<number | null>`coalesce(${movies.libraryId}, ${shows.libraryId})`,
    })
    .from(collectionItems)
    .leftJoin(movies, eq(movies.id, collectionItems.movieId))
    .leftJoin(shows, eq(shows.id, collectionItems.showId))
    .orderBy(asc(collectionItems.addedAt), asc(collectionItems.id))
    .all();
  const byCollection = new Map<number, CollectionMember[]>();
  for (const { libraryId, ...m } of members) {
    if (libraryId === null || !canSee(scope, libraryId)) continue;
    const list = byCollection.get(m.collectionId) ?? [];
    list.push(m);
    byCollection.set(m.collectionId, list);
  }
  return rows
    .map((row) => ({ row, members: byCollection.get(row.id) ?? [] }))
    .filter(({ row, members: m }) => (row.kind === 'auto' ? m.length >= MIN_AUTO_COLLECTION_SIZE : m.length > 0 || isAdmin));
}
