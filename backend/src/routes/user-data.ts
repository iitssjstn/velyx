import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireUser } from '../app.js';
import { episodes, favorites, watchlist, watchProgress } from '../db/schema.js';
import { Catalog } from '../services/catalog.js';
import { HttpError, notFound, parseId } from '../http-error.js';
import { assertEpisode, assertMovie, assertShow } from '../services/access.js';

/** Fraction of the runtime after which an item counts as watched. */
export const COMPLETION_THRESHOLD = 0.9;

const progressBody = z
  .object({
    movieId: z.number().int().positive().optional(),
    episodeId: z.number().int().positive().optional(),
    positionSec: z.number().min(0).max(60 * 60 * 24),
    durationSec: z.number().min(0).max(60 * 60 * 24),
  })
  .refine((b) => Boolean(b.movieId) !== Boolean(b.episodeId), 'Provide either movieId or episodeId.');

const watchedBody = z
  .object({
    movieId: z.number().int().positive().optional(),
    episodeId: z.number().int().positive().optional(),
    showId: z.number().int().positive().optional(),
    seasonId: z.number().int().positive().optional(),
    watched: z.boolean(),
  })
  .refine((b) => [b.movieId, b.episodeId, b.showId, b.seasonId].filter(Boolean).length === 1, 'Provide exactly one item.');

const savedBody = z
  .object({ movieId: z.number().int().positive().optional(), showId: z.number().int().positive().optional() })
  .refine((b) => Boolean(b.movieId) !== Boolean(b.showId), 'Provide either movieId or showId.');

export function saveProgress(
  ctx: AppContext,
  userId: number,
  target: { movieId?: number; episodeId?: number },
  positionSec: number,
  durationSec: number,
) {
  const db = ctx.db;
  const where = target.movieId
    ? and(eq(watchProgress.userId, userId), eq(watchProgress.movieId, target.movieId))
    : and(eq(watchProgress.userId, userId), eq(watchProgress.episodeId, target.episodeId!));
  const existing = db.select().from(watchProgress).where(where).get();
  const reached = durationSec > 0 && positionSec / durationSec >= COMPLETION_THRESHOLD;
  const completed = reached || (existing?.completed ?? false);
  const justCompleted = reached && !existing?.completed;
  if (justCompleted && target.movieId) removeFromWatchlist(ctx, userId, { movieId: target.movieId });
  // Once finished, the resume point resets so the next play starts at the beginning.
  const position = justCompleted ? 0 : positionSec;
  if (existing) {
    return db
      .update(watchProgress)
      .set({
        positionSec: position,
        durationSec: durationSec || existing.durationSec,
        completed,
        playCount: existing.playCount + (justCompleted ? 1 : 0),
        updatedAt: Date.now(),
      })
      .where(eq(watchProgress.id, existing.id))
      .returning()
      .get();
  }
  return db
    .insert(watchProgress)
    .values({
      userId,
      movieId: target.movieId ?? null,
      episodeId: target.episodeId ?? null,
      positionSec: position,
      durationSec,
      completed,
      playCount: justCompleted ? 1 : 0,
      updatedAt: Date.now(),
    })
    .returning()
    .get();
}

/** A finished movie leaves the watchlist, like on other media servers. */
function removeFromWatchlist(ctx: AppContext, userId: number, target: { movieId?: number; showId?: number }): void {
  const cond = target.movieId ? eq(watchlist.movieId, target.movieId) : eq(watchlist.showId, target.showId!);
  ctx.db.delete(watchlist).where(and(eq(watchlist.userId, userId), cond)).run();
}

function setWatched(ctx: AppContext, userId: number, target: { movieId?: number; episodeId?: number }, watched: boolean): void {
  const where = target.movieId
    ? and(eq(watchProgress.userId, userId), eq(watchProgress.movieId, target.movieId))
    : and(eq(watchProgress.userId, userId), eq(watchProgress.episodeId, target.episodeId!));
  if (!watched) {
    ctx.db.delete(watchProgress).where(where).run();
    return;
  }
  if (target.movieId) removeFromWatchlist(ctx, userId, { movieId: target.movieId });
  const existing = ctx.db.select().from(watchProgress).where(where).get();
  if (existing) {
    ctx.db
      .update(watchProgress)
      .set({ completed: true, positionSec: 0, playCount: existing.completed ? existing.playCount : existing.playCount + 1, updatedAt: Date.now() })
      .where(eq(watchProgress.id, existing.id))
      .run();
  } else {
    ctx.db
      .insert(watchProgress)
      .values({ userId, movieId: target.movieId ?? null, episodeId: target.episodeId ?? null, completed: true, playCount: 1, updatedAt: Date.now() })
      .run();
  }
}

export async function userDataRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const db = ctx.db;
  const catalog = new Catalog(db);

  app.get('/api/progress', { preHandler: requireUser }, async (request) => {
    const rows = db.select().from(watchProgress).where(eq(watchProgress.userId, request.user!.id)).orderBy(desc(watchProgress.updatedAt)).limit(200).all();
    return rows.map((r) => ({
      movieId: r.movieId,
      episodeId: r.episodeId,
      positionSec: r.positionSec,
      durationSec: r.durationSec,
      completed: r.completed,
      playCount: r.playCount,
      updatedAt: r.updatedAt,
    }));
  });

  app.post('/api/progress', { preHandler: requireUser }, async (request) => {
    const body = progressBody.parse(request.body);
    const scope = ctx.access.scope(request.user!);
    if (body.movieId) assertMovie(db, scope, body.movieId);
    if (body.episodeId) assertEpisode(db, scope, body.episodeId);
    const row = saveProgress(ctx, request.user!.id, body, body.positionSec, body.durationSec);
    return { positionSec: row.positionSec, durationSec: row.durationSec, completed: row.completed };
  });

  app.post('/api/progress/watched', { preHandler: requireUser }, async (request) => {
    const body = watchedBody.parse(request.body);
    const userId = request.user!.id;
    const scope = ctx.access.scope(request.user!);
    if (body.movieId) {
      assertMovie(db, scope, body.movieId);
      setWatched(ctx, userId, { movieId: body.movieId }, body.watched);
    } else if (body.episodeId) {
      assertEpisode(db, scope, body.episodeId);
      setWatched(ctx, userId, { episodeId: body.episodeId }, body.watched);
    } else {
      const eps = body.showId
        ? db.select({ id: episodes.id, showId: episodes.showId }).from(episodes).where(eq(episodes.showId, body.showId)).all()
        : db.select({ id: episodes.id, showId: episodes.showId }).from(episodes).where(eq(episodes.seasonId, body.seasonId!)).all();
      if (!eps.length) throw notFound(body.showId ? 'Show' : 'Season');
      assertShow(db, scope, eps[0].showId);
      db.transaction(() => {
        for (const e of eps) setWatched(ctx, userId, { episodeId: e.id }, body.watched);
        if (body.showId && body.watched) removeFromWatchlist(ctx, userId, { showId: body.showId });
      });
    }
    return { ok: true };
  });

  // ---- favorites and watchlist share the same shape
  for (const [name, table] of [
    ['favorites', favorites],
    ['watchlist', watchlist],
  ] as const) {
    const flag = name === 'favorites' ? 'favorite' : 'watchlist';

    app.get(`/api/${name}`, { preHandler: requireUser }, async (request) =>
      catalog.savedCards(name, request.user!.id, ctx.access.scope(request.user!)),
    );

    app.post(`/api/${name}`, { preHandler: requireUser }, async (request) => {
      const body = savedBody.parse(request.body);
      const scope = ctx.access.scope(request.user!);
      if (body.movieId) assertMovie(db, scope, body.movieId);
      if (body.showId) assertShow(db, scope, body.showId);
      db.insert(table)
        .values({ userId: request.user!.id, movieId: body.movieId ?? null, showId: body.showId ?? null })
        .onConflictDoNothing()
        .run();
      return { [flag]: true };
    });

    app.delete<{ Params: { type: string; id: string } }>(`/api/${name}/:type/:id`, { preHandler: requireUser }, async (request) => {
      const id = parseId(request.params.id);
      const userId = request.user!.id;
      if (request.params.type === 'movie') db.delete(table).where(and(eq(table.userId, userId), eq(table.movieId, id))).run();
      else if (request.params.type === 'show') db.delete(table).where(and(eq(table.userId, userId), eq(table.showId, id))).run();
      else throw new HttpError(400, 'Type must be movie or show.');
      return { [flag]: false };
    });
  }

  /** Removes a favorite by its own id (kept for API completeness). */
  app.delete<{ Params: { id: string } }>('/api/favorites/:id', { preHandler: requireUser }, async (request) => {
    const id = parseId(request.params.id);
    const res = db.delete(favorites).where(and(eq(favorites.id, id), eq(favorites.userId, request.user!.id))).run();
    if (res.changes === 0) throw notFound('Favorite');
    return { favorite: false };
  });

}
