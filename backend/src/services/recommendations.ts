import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { collectionItems, credits, movieGenres, movies, showGenres, shows } from '../db/schema.js';
import { scopeCondition, type LibraryScope } from './access.js';

/**
 * "More Like This" from metadata Velyx already has: shared collection, director/creator, lead cast
 * and genres, plus release-year proximity. Deterministic and cheap: candidates come from indexed
 * lookups (genre, person, collection), never from scanning the whole library.
 */
const WEIGHTS = { collection: 6, director: 4, cast: 2, genre: 2, yearClose: 1, yearNear: 0.5, rated: 0.5 };
const TOP_CAST = 5;

type Kind = 'movie' | 'show';

export interface Scored {
  id: number;
  score: number;
}

/** Combines per-signal matches into a ranked list (exported for tests). */
export function rankCandidates(
  target: { year: number | null },
  candidates: Map<number, { genres: number; cast: number; director: number; collection: number; year: number | null; rating: number | null }>,
  limit: number,
): Scored[] {
  const out: Scored[] = [];
  for (const [id, c] of candidates) {
    let score = c.genres * WEIGHTS.genre + c.cast * WEIGHTS.cast + c.director * WEIGHTS.director + c.collection * WEIGHTS.collection;
    // One shared genre alone is too weak a signal ("Drama").
    if (score <= WEIGHTS.genre && c.cast + c.director + c.collection === 0) continue;
    if (target.year && c.year) {
      const d = Math.abs(target.year - c.year);
      if (d <= 5) score += WEIGHTS.yearClose;
      else if (d <= 10) score += WEIGHTS.yearNear;
    }
    if ((c.rating ?? 0) >= 7) score += WEIGHTS.rated;
    out.push({ id, score });
  }
  return out.sort((a, b) => b.score - a.score || a.id - b.id).slice(0, limit);
}

export function similarItems(db: DB, scope: LibraryScope, kind: Kind, id: number, limit = 12): Scored[] {
  const table = kind === 'movie' ? movies : shows;
  const target = db.select({ year: table.year }).from(table).where(eq(table.id, id)).get();
  if (!target) return [];
  type Candidate = { genres: number; cast: number; director: number; collection: number; year: number | null; rating: number | null };
  const candidates = new Map<number, Candidate>();
  const get = (cid: number) => {
    let c = candidates.get(cid);
    if (!c) candidates.set(cid, (c = { genres: 0, cast: 0, director: 0, collection: 0, year: null, rating: null }));
    return c;
  };

  // Genres
  const link = kind === 'movie' ? movieGenres : showGenres;
  const linkId = kind === 'movie' ? movieGenres.movieId : showGenres.showId;
  const genreIds = db.select({ g: link.genreId }).from(link).where(eq(linkId, id)).all().map((r) => r.g);
  if (genreIds.length) {
    for (const r of db
      .select({ id: linkId, n: sql<number>`count(*)` })
      .from(link)
      .where(and(inArray(link.genreId, genreIds), ne(linkId, id)))
      .groupBy(linkId)
      .all())
      get(r.id).genres = Number(r.n);
  }

  // People: lead cast and directors (movies) / creators (shows)
  const creditCol = kind === 'movie' ? credits.movieId : credits.showId;
  const own = db.select({ person: credits.personId, kind: credits.kind, role: credits.role, order: credits.sortOrder }).from(credits).where(eq(creditCol, id)).all();
  const leadCast = own.filter((c) => c.kind === 'cast' && c.order < TOP_CAST).map((c) => c.person);
  const makerRole = kind === 'movie' ? 'Director' : 'Creator';
  const makers = own.filter((c) => c.kind === 'crew' && c.role === makerRole).map((c) => c.person);
  const people = [...new Set([...leadCast, ...makers])];
  if (people.length) {
    for (const r of db
      .select({ id: creditCol, person: credits.personId, kind: credits.kind, role: credits.role })
      .from(credits)
      .where(and(inArray(credits.personId, people), isNotNull(creditCol), ne(creditCol, id)))
      .all()) {
      const c = get(r.id!);
      if (r.kind === 'cast' && leadCast.includes(r.person)) c.cast++;
      else if (r.kind === 'crew' && r.role === makerRole && makers.includes(r.person)) c.director++;
    }
  }

  // Collections
  const itemCol = kind === 'movie' ? collectionItems.movieId : collectionItems.showId;
  const collectionIds = db.select({ c: collectionItems.collectionId }).from(collectionItems).where(eq(itemCol, id)).all().map((r) => r.c);
  if (collectionIds.length) {
    for (const r of db.select({ id: itemCol }).from(collectionItems).where(and(inArray(collectionItems.collectionId, collectionIds), isNotNull(itemCol), ne(itemCol, id))).all()) {
      get(r.id!).collection = 1;
    }
  }

  if (!candidates.size) return [];
  // Year, rating and library access for the candidates.
  const ids = [...candidates.keys()];
  const visible = new Set<number>();
  for (let i = 0; i < ids.length; i += 500) {
    for (const r of db
      .select({ id: table.id, year: table.year, rating: table.rating })
      .from(table)
      .where(and(inArray(table.id, ids.slice(i, i + 500)), scopeCondition(scope, table.libraryId)))
      .all()) {
      const c = candidates.get(r.id)!;
      c.year = r.year;
      c.rating = r.rating;
      visible.add(r.id);
    }
  }
  for (const cid of ids) if (!visible.has(cid)) candidates.delete(cid);
  return rankCandidates(target, candidates, limit);
}
