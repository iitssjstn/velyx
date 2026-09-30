import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireAdmin, requireUser } from '../app.js';
import { movies, seerrRequests, shows, users } from '../db/schema.js';
import { HttpError, parseId } from '../http-error.js';
import type { RequestState } from '../services/seerr.js';
import { canSee } from '../services/access.js';
import type { SessionUser } from '../auth/sessions.js';

const mediaType = z.enum(['movie', 'tv']);
const tmdbId = z.coerce.number().int().positive().max(100_000_000);
/** Requests one person may make per hour. */
const REQUESTS_PER_HOUR = 20;
/** Only asked again after this long (a list of requests does not ask Seerr for each one every time). */
const STATE_FRESH_MS = 5 * 60_000;

/**
 * Seerr (optional): administrators set its address and API key; everyone signed in can search for
 * movies and shows that are not in the library, request them, and follow their requests. Seerr
 * decides what happens with a request (approval, downloading).
 */
export async function seerrRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { db } = ctx;
  const lang = (l: string | undefined) => (l === 'nl' ? 'nl' : 'en');

  // ---- administrators: the connection
  app.get('/api/admin/seerr', { preHandler: requireAdmin }, async () => {
    const s = ctx.settings.get().seerr;
    return { url: s.url, hasKey: !!s.apiKey };
  });

  app.put('/api/admin/seerr', { preHandler: requireAdmin }, async (request) => {
    const body = z
      .object({
        url: z
          .string()
          .trim()
          .max(300)
          .refine((u) => u === '' || /^https?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(u), 'Enter the address Seerr is opened at, such as http://192.168.1.10:5055.'),
        /** Left out: keep the saved key. */
        apiKey: z.string().trim().min(10).max(200).optional(),
      })
      .parse(request.body);
    const url = body.url.replace(/\/+$/, '');
    const current = ctx.settings.get().seerr;
    if (!url) {
      ctx.settings.update({ seerr: { url: '', apiKey: '' } });
      ctx.audit.record('seerr.settings', { actor: request.user, ip: request.ip, detail: 'off' });
      return { url: '', hasKey: false, version: null };
    }
    const apiKey = body.apiKey ?? current.apiKey;
    if (!apiKey) throw new HttpError(400, 'Enter the API key from Seerr (Settings → General).');
    // Only saved when it works: a wrong address or key is said now, not later to every user.
    const { version } = await ctx.seerr.test(url, apiKey);
    ctx.settings.update({ seerr: { url, apiKey } });
    ctx.audit.record('seerr.settings', { actor: request.user, ip: request.ip, detail: url });
    return { url, hasKey: true, version };
  });

  // ---- everyone signed in
  app.get('/api/seerr', { preHandler: requireUser }, async () => ({ enabled: ctx.seerr.configured() }));

  /**
   * Which of these are in the library already (by TMDB id), and where: a movie opens its player,
   * a show its next episode. Several copies of one title: the first one added. With a user, only
   * the libraries that user may see count.
   */
  const inLibrary = (items: Array<{ mediaType: 'movie' | 'tv'; tmdbId: number }>, user?: SessionUser) => {
    const scope = user ? ctx.access.scope(user) : null;
    const ids = (t: 'movie' | 'tv') => [...new Set(items.filter((i) => i.mediaType === t).map((i) => i.tmdbId))];
    const m = ids('movie');
    const s = ids('tv');
    const byTmdb = (rows: Array<{ id: number; tmdbId: number | null; libraryId: number }>) => {
      const map = new Map<number, number>();
      for (const r of rows) if (r.tmdbId !== null && (!scope || canSee(scope, r.libraryId)) && (!map.has(r.tmdbId) || r.id < map.get(r.tmdbId)!)) map.set(r.tmdbId, r.id);
      return map;
    };
    const haveMovies = byTmdb(m.length ? db.select({ id: movies.id, tmdbId: movies.tmdbId, libraryId: movies.libraryId }).from(movies).where(and(isNotNull(movies.tmdbId), inArray(movies.tmdbId, m))).all() : []);
    const haveShows = byTmdb(s.length ? db.select({ id: shows.id, tmdbId: shows.tmdbId, libraryId: shows.libraryId }).from(shows).where(and(isNotNull(shows.tmdbId), inArray(shows.tmdbId, s))).all() : []);
    return (i: { mediaType: 'movie' | 'tv'; tmdbId: number }): { type: 'movie' | 'show'; id: number } | null => {
      const id = (i.mediaType === 'movie' ? haveMovies : haveShows).get(i.tmdbId);
      return id === undefined ? null : { type: i.mediaType === 'movie' ? 'movie' : 'show', id };
    };
  };
  const withLibrary = <T extends { mediaType: 'movie' | 'tv'; tmdbId: number }>(items: T[], user: SessionUser) => {
    const local = inLibrary(items, user);
    return items.map((x) => {
      const l = local(x);
      return { ...x, inLibrary: l !== null, local: l };
    });
  };

  app.get('/api/seerr/search', { preHandler: requireUser }, async (request) => {
    const q = z.object({ q: z.string().trim().min(1).max(100), page: z.coerce.number().int().min(1).max(20).default(1) }).parse(request.query);
    const r = await ctx.seerr.search(q.q, q.page, lang(request.user!.language));
    return { ...r, results: withLibrary(r.results, request.user!) };
  });

  /** One row of the catalog for the home screen: trending, popular, a genre, coming soon. */
  app.get('/api/seerr/discover', { preHandler: requireUser }, async (request) => {
    const q = z
      .object({
        row: z.enum(['trending', 'movies', 'tv', 'upcomingMovies', 'upcomingTv']),
        genre: z.coerce.number().int().positive().max(100_000).optional(),
        page: z.coerce.number().int().min(1).max(20).default(1),
      })
      .refine((x) => x.genre === undefined || x.row === 'movies' || x.row === 'tv', 'Only movies and shows have genres.')
      .parse(request.query);
    const r = await ctx.seerr.discover({ kind: q.row, genre: q.genre }, q.page, lang(request.user!.language));
    return { ...r, results: withLibrary(r.results, request.user!) };
  });

  app.get('/api/seerr/:type/:id', { preHandler: requireUser }, async (request) => {
    const p = z.object({ type: mediaType, id: tmdbId }).parse(request.params);
    const d = await ctx.seerr.details(p.type, p.id, lang(request.user!.language));
    return withLibrary([d], request.user!)[0];
  });

  /** Titles like this one, for its page (what is here opens straight away). */
  app.get('/api/seerr/:type/:id/recommendations', { preHandler: requireUser }, async (request) => {
    const p = z.object({ type: mediaType, id: tmdbId }).parse(request.params);
    const r = await ctx.seerr.recommendations(p.type, p.id, lang(request.user!.language));
    return { ...r, results: withLibrary(r.results, request.user!) };
  });

  const recent = new Map<number, number[]>();
  app.post('/api/seerr/requests', { preHandler: requireUser }, async (request) => {
    const body = z.object({ mediaType, tmdbId, seasons: z.array(z.number().int().min(1).max(1000)).max(200).nullable().default(null) }).parse(request.body);
    const user = request.user!;
    const now = Date.now();
    const mine = (recent.get(user.id) ?? []).filter((t) => t > now - 3_600_000);
    if (mine.length >= REQUESTS_PER_HOUR) throw new HttpError(429, 'You made many requests in the last hour. Try again later.');
    // Title and poster from Seerr itself (never taken from the browser).
    const d = await ctx.seerr.details(body.mediaType, body.tmdbId, lang(user.language));
    if (inLibrary([d])(d) !== null) throw new HttpError(409, 'This is already in the library.');
    // A show with seasons requested before: only the others can be asked for.
    let seasons = body.seasons;
    if (body.mediaType === 'tv') {
      const open = d.seasons.filter((s) => s.state === null || s.state === 'declined' || s.state === 'failed').map((s) => s.seasonNumber);
      if (seasons) seasons = seasons.filter((n) => open.includes(n));
      else if (open.length < d.seasons.length) seasons = open;
      if (seasons && seasons.length === 0) throw new HttpError(409, 'This has already been requested.');
    }
    const r = await ctx.seerr.request(body.mediaType, body.tmdbId, body.mediaType === 'tv' ? seasons : null);
    mine.push(now);
    recent.set(user.id, mine);
    const row = db
      .insert(seerrRequests)
      .values({ userId: user.id, seerrId: r.id, mediaType: body.mediaType, tmdbId: body.tmdbId, title: d.title.slice(0, 300), posterPath: d.posterPath, state: r.state, createdAt: now, updatedAt: now })
      .returning()
      .get();
    ctx.audit.record('seerr.requested', { actor: user, ip: request.ip, target: `${d.title}${d.year ? ` (${d.year})` : ''}` });
    return view(row);
  });

  const view = (r: typeof seerrRequests.$inferSelect) => ({ id: r.id, mediaType: r.mediaType, tmdbId: r.tmdbId, title: r.title, posterPath: r.posterPath, state: r.state as RequestState | 'removed', createdAt: r.createdAt, updatedAt: r.updatedAt });

  /** Your requests, with where they stand now (asked of Seerr at most every few minutes each). */
  app.get('/api/seerr/requests', { preHandler: requireUser }, async (request) => {
    const rows = db.select().from(seerrRequests).where(eq(seerrRequests.userId, request.user!.id)).orderBy(desc(seerrRequests.createdAt)).limit(50).all();
    if (!ctx.seerr.configured()) return rows.map(view);
    const now = Date.now();
    const stale = rows.filter((r) => now - r.updatedAt > STATE_FRESH_MS && r.state !== 'available' && r.state !== 'removed').slice(0, 10);
    await Promise.all(
      stale.map(async (r) => {
        try {
          const state = (await ctx.seerr.requestStatus(r.seerrId)) ?? 'removed';
          db.update(seerrRequests).set({ state, updatedAt: now }).where(eq(seerrRequests.id, r.id)).run();
          r.state = state;
          r.updatedAt = now;
        } catch {
          /* Seerr unreachable: the last known state */
        }
      }),
    );
    return rows.map(view);
  });

  // ---- administrators: everyone's requests, and cancelling one

  app.get('/api/admin/seerr/requests', { preHandler: requireAdmin }, async () => {
    const rows = db
      .select({ r: seerrRequests, username: users.username, displayName: users.displayName })
      .from(seerrRequests)
      .leftJoin(users, eq(users.id, seerrRequests.userId))
      .orderBy(desc(seerrRequests.createdAt))
      .limit(200)
      .all();
    return rows.map((x) => ({ ...view(x.r), user: x.displayName || x.username || null }));
  });

  /**
   * Cancels a request: removed in Seerr (it may still be waiting for approval or being added) and
   * here. What Seerr already added to the library stays; nothing in the library is touched.
   */
  app.delete<{ Params: { id: string } }>('/api/admin/seerr/requests/:id', { preHandler: requireAdmin }, async (request) => {
    const id = parseId(request.params.id);
    const row = db.select().from(seerrRequests).where(eq(seerrRequests.id, id)).get();
    if (!row) throw new HttpError(404, 'Request not found.');
    // Seerr no longer having it is fine: it is removed here too.
    const inSeerr = await ctx.seerr.cancel(row.seerrId);
    db.delete(seerrRequests).where(eq(seerrRequests.id, id)).run();
    // No other request left for it: requestable again (instead of "being added" for good).
    try {
      await ctx.seerr.resetIfUnrequested(row.mediaType as 'movie' | 'tv', row.tmdbId);
    } catch {
      /* Seerr away: the request itself is gone; resetting the title is possible from its page */
    }
    ctx.audit.record('seerr.cancelled', { actor: request.user, ip: request.ip, target: row.title, detail: inSeerr ? undefined : 'no longer at Seerr' });
    return { ok: true, inSeerr };
  });

  /**
   * Makes a title requestable again: every request for it is cancelled in Seerr (whoever made it,
   * also outside Vidalune) and Seerr forgets it. Not for what is (partly) available already.
   */
  app.delete('/api/admin/seerr/media/:type/:id', { preHandler: requireAdmin }, async (request) => {
    const p = z.object({ type: mediaType, id: tmdbId }).parse(request.params);
    const r = await ctx.seerr.reset(p.type, p.id);
    const mine = db.select().from(seerrRequests).where(and(eq(seerrRequests.mediaType, p.type), eq(seerrRequests.tmdbId, p.id))).all();
    db.delete(seerrRequests).where(and(eq(seerrRequests.mediaType, p.type), eq(seerrRequests.tmdbId, p.id))).run();
    ctx.audit.record('seerr.reset', { actor: request.user, ip: request.ip, target: mine[0]?.title ?? `${p.type} ${p.id}`, detail: `${r.requests} request(s)` });
    return { ok: true, requests: r.requests };
  });
}
