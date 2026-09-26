import { eq, inArray, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { episodes, libraries, movies, shows, userLibraries, users } from '../db/schema.js';
import type { SessionUser } from '../auth/sessions.js';
import { notFound } from '../http-error.js';

/**
 * The libraries a user may see. `all` is true for admins and for users without restrictions;
 * otherwise `ids` lists the allowed libraries (possibly none).
 */
export interface LibraryScope {
  all: boolean;
  ids: Set<number>;
}

export class LibraryAccess {
  constructor(private readonly db: DB) {}

  scope(user: Pick<SessionUser, 'id' | 'role'>): LibraryScope {
    if (user.role === 'admin') return { all: true, ids: new Set() };
    const u = this.db.select({ all: users.allLibraries }).from(users).where(eq(users.id, user.id)).get();
    if (!u || u.all) return { all: true, ids: new Set() };
    const rows = this.db.select({ id: userLibraries.libraryId }).from(userLibraries).where(eq(userLibraries.userId, user.id)).all();
    return { all: false, ids: new Set(rows.map((r) => r.id)) };
  }

  /** Library ids the admin has granted this user, or null for "all libraries". */
  grantedIds(userId: number): number[] | null {
    const u = this.db.select({ all: users.allLibraries }).from(users).where(eq(users.id, userId)).get();
    if (!u || u.all) return null;
    return this.db
      .select({ id: userLibraries.libraryId })
      .from(userLibraries)
      .where(eq(userLibraries.userId, userId))
      .all()
      .map((r) => r.id);
  }

  /** Replaces the user's library grants. `null` gives access to every library, including future ones. */
  setGrants(userId: number, libraryIds: number[] | null): void {
    this.db.transaction((tx) => {
      tx.delete(userLibraries).where(eq(userLibraries.userId, userId)).run();
      tx.update(users).set({ allLibraries: libraryIds === null }).where(eq(users.id, userId)).run();
      if (libraryIds?.length) {
        const existing = tx.select({ id: libraries.id }).from(libraries).where(inArray(libraries.id, libraryIds)).all();
        if (existing.length) tx.insert(userLibraries).values(existing.map((l) => ({ userId, libraryId: l.id }))).run();
      }
    });
  }
}

/** SQL condition limiting `libraryColumn` to the scope, or undefined when everything is visible. */
export function scopeCondition(scope: LibraryScope, libraryColumn: SQLWrapper): SQL | undefined {
  if (scope.all) return undefined;
  if (!scope.ids.size) return sql`0`;
  return inArray(libraryColumn as typeof movies.libraryId, [...scope.ids]);
}

export function canSee(scope: LibraryScope, libraryId: number): boolean {
  return scope.all || scope.ids.has(libraryId);
}

/** Helpers that 404 when an item is missing or outside the user's libraries (never reveal that it exists). */
export function assertMovie(db: DB, scope: LibraryScope, id: number) {
  const m = db.select().from(movies).where(eq(movies.id, id)).get();
  if (!m || !canSee(scope, m.libraryId)) throw notFound('Movie');
  return m;
}

export function assertShow(db: DB, scope: LibraryScope, id: number) {
  const s = db.select().from(shows).where(eq(shows.id, id)).get();
  if (!s || !canSee(scope, s.libraryId)) throw notFound('Show');
  return s;
}

export function assertEpisode(db: DB, scope: LibraryScope, id: number) {
  const row = db.select({ e: episodes, s: shows }).from(episodes).innerJoin(shows, eq(shows.id, episodes.showId)).where(eq(episodes.id, id)).get();
  if (!row || !canSee(scope, row.s.libraryId)) throw notFound('Episode');
  return row;
}
