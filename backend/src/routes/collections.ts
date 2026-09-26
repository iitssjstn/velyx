import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireAdmin, requireUser } from '../app.js';
import { collectionItems, collections, movies, shows } from '../db/schema.js';
import { Catalog, type MovieCard, type ShowCard } from '../services/catalog.js';
import { visibleCollections, type VisibleCollection } from '../services/collections.js';
import { sortTitle } from '../services/parser.js';
import { HttpError, notFound, parseId } from '../http-error.js';

const collectionBody = z.object({
  name: z.string().trim().min(1).max(100),
  overview: z.string().trim().max(2000).nullable().optional(),
});
const collectionUpdate = collectionBody.partial();
const itemBody = z
  .object({ movieId: z.number().int().positive().optional(), showId: z.number().int().positive().optional() })
  .refine((b) => Boolean(b.movieId) !== Boolean(b.showId), 'Provide either movieId or showId.');

export async function collectionRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const db = ctx.db;
  const catalog = new Catalog(db);

  const visible = (request: { user: { id: number; role: 'admin' | 'user' } | null }) =>
    visibleCollections(db, ctx.access.scope(request.user!), request.user!.role === 'admin');

  /** Cards for the collection's members; TMDB collections in release order, manual ones in the order items were added. */
  function memberCards(userId: number, c: VisibleCollection): Array<MovieCard | ShowCard> {
    const movieIds = c.members.filter((m) => m.movieId).map((m) => m.movieId!);
    const showIds = c.members.filter((m) => m.showId).map((m) => m.showId!);
    const movieRows = movieIds.length ? db.select().from(movies).where(inArray(movies.id, movieIds)).all() : [];
    const showRows = showIds.length ? db.select().from(shows).where(inArray(shows.id, showIds)).all() : [];
    const cards = [...catalog.movieCards(userId, movieRows), ...catalog.showCards(userId, showRows)];
    if (c.row.kind === 'auto') {
      const release = new Map(movieRows.map((m) => [m.id, m.releaseDate ?? String(m.year ?? '')]));
      return cards.sort((a, b) => (release.get(a.id) ?? '').localeCompare(release.get(b.id) ?? '') || a.title.localeCompare(b.title));
    }
    const order = (card: MovieCard | ShowCard) => c.members.findIndex((m) => (card.type === 'movie' ? m.movieId === card.id : m.showId === card.id));
    return cards.sort((a, b) => order(a) - order(b));
  }

  function summary(userId: number, c: VisibleCollection) {
    let posterPath = c.row.posterPath;
    let backdropPath = c.row.backdropPath;
    if (!posterPath || !backdropPath) {
      // Manual collections borrow artwork from their first item.
      const first = memberCards(userId, c)[0];
      posterPath ??= first?.posterPath ?? null;
      backdropPath ??= first?.backdropPath ?? null;
    }
    return {
      id: c.row.id,
      kind: c.row.kind,
      name: c.row.name,
      overview: c.row.overview,
      posterPath,
      backdropPath,
      itemCount: c.members.length,
    };
  }

  function manualCollection(idParam: string) {
    const row = db.select().from(collections).where(eq(collections.id, parseId(idParam))).get();
    if (!row) throw notFound('Collection');
    if (row.kind !== 'manual') throw new HttpError(400, 'Collections from TMDB are managed automatically and cannot be edited.');
    return row;
  }

  app.get('/api/collections', { preHandler: requireUser }, async (request) => visible(request).map((c) => summary(request.user!.id, c)));

  app.get<{ Params: { id: string } }>('/api/collections/:id', { preHandler: requireUser }, async (request) => {
    const id = parseId(request.params.id);
    const c = visible(request).find((x) => x.row.id === id);
    if (!c) throw notFound('Collection');
    return { ...summary(request.user!.id, c), items: memberCards(request.user!.id, c) };
  });

  // ---- admin: manual collections
  app.post('/api/collections', { preHandler: requireAdmin }, async (request) => {
    const body = collectionBody.parse(request.body);
    const row = db
      .insert(collections)
      .values({ kind: 'manual', name: body.name, sortTitle: sortTitle(body.name), overview: body.overview || null })
      .returning()
      .get();
    ctx.audit.record('collection.created', { actor: request.user, ip: request.ip, target: row.name });
    return { id: row.id, kind: row.kind, name: row.name, overview: row.overview, posterPath: null, backdropPath: null, itemCount: 0 };
  });

  app.put<{ Params: { id: string } }>('/api/collections/:id', { preHandler: requireAdmin }, async (request) => {
    const row = manualCollection(request.params.id);
    const body = collectionUpdate.parse(request.body);
    const patch: Partial<typeof collections.$inferInsert> = { updatedAt: Date.now() };
    if (body.name) {
      patch.name = body.name;
      patch.sortTitle = sortTitle(body.name);
    }
    if (body.overview !== undefined) patch.overview = body.overview || null;
    db.update(collections).set(patch).where(eq(collections.id, row.id)).run();
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/collections/:id', { preHandler: requireAdmin }, async (request) => {
    const row = manualCollection(request.params.id);
    db.delete(collections).where(eq(collections.id, row.id)).run();
    ctx.audit.record('collection.deleted', { actor: request.user, ip: request.ip, target: row.name });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/collections/:id/items', { preHandler: requireAdmin }, async (request) => {
    const row = manualCollection(request.params.id);
    const body = itemBody.parse(request.body);
    if (body.movieId && !db.select({ id: movies.id }).from(movies).where(eq(movies.id, body.movieId)).get()) throw notFound('Movie');
    if (body.showId && !db.select({ id: shows.id }).from(shows).where(eq(shows.id, body.showId)).get()) throw notFound('Show');
    db.insert(collectionItems)
      .values({ collectionId: row.id, movieId: body.movieId ?? null, showId: body.showId ?? null })
      .onConflictDoNothing()
      .run();
    return { ok: true };
  });

  app.delete<{ Params: { id: string; type: string; itemId: string } }>('/api/collections/:id/items/:type/:itemId', { preHandler: requireAdmin }, async (request) => {
    const row = manualCollection(request.params.id);
    const itemId = parseId(request.params.itemId);
    const { type } = request.params;
    if (type !== 'movie' && type !== 'show') throw new HttpError(400, 'Type must be movie or show.');
    const cond = type === 'movie' ? eq(collectionItems.movieId, itemId) : eq(collectionItems.showId, itemId);
    db.delete(collectionItems).where(and(eq(collectionItems.collectionId, row.id), cond)).run();
    return { ok: true };
  });
}
