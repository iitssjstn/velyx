import type { FastifyInstance, FastifyRequest } from 'fastify';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireAdmin, requireUser } from '../app.js';
import { episodes, mediaFiles, movies, seerrRequests, shows, users } from '../db/schema.js';
import { HttpError, parseId } from '../http-error.js';
import type { Download, RequestState } from '../services/seerr.js';
import { canSee } from '../services/access.js';
import type { SessionUser } from '../auth/sessions.js';

const mediaType = z.enum(['movie', 'tv']);
const tmdbId = z.coerce.number().int().positive().max(100_000_000);
/** Requests one person may make per hour. */
const REQUESTS_PER_HOUR = 20;
/** How long what Seerr knows of a show's seasons is used for its page's button. */
const SHOW_FRESH_MS = 5 * 60_000;
/** Only asked again after this long (a list of requests does not ask Seerr for each one every time). */
const STATE_FRESH_MS = 5 * 60_000;
/** While a request is being fetched, how far it is is asked again after this long. */
const DOWNLOAD_FRESH_MS = 15_000;
/** Seerr is asked about this many requests at most per list. */
const REFRESH_PER_LIST = 10;
/** States in which Sonarr or Radarr may be fetching a request. */
const FETCHING = new Set<string>(['approved', 'processing', 'partiallyAvailable']);

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
  /** Whether this person sees Seerr: administrators always, others unless an administrator turned it off for them. */
  const seerrAllowed = (user: SessionUser) =>
    user.role === 'admin' || (db.select({ on: users.seerrAccess }).from(users).where(eq(users.id, user.id)).get()?.on ?? false);
  const mayUseSeerr = async (request: FastifyRequest) => {
    if (!seerrAllowed(request.user!)) throw new HttpError(403, 'Seerr is turned off for your account.');
  };
  /** Signed in, and Seerr is not turned off for this person. */
  const seerrUser = { preHandler: [requireUser, mayUseSeerr] };

  app.get('/api/seerr', { preHandler: requireUser }, async (request) => ({ enabled: ctx.seerr.configured() && seerrAllowed(request.user!) }));

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
  /**
   * The seasons of these shows (by TMDB id) that are on this server: with at least one episode that
   * has a file. Anywhere on the server, also in libraries a person cannot see (asking Seerr for them
   * again would only fetch them twice).
   */
  const seasonsHere = (tmdbIds: number[]): Map<number, Set<number>> => {
    const map = new Map<number, Set<number>>();
    const ids = [...new Set(tmdbIds)];
    if (ids.length === 0) return map;
    const rows = db
      .selectDistinct({ tmdbId: shows.tmdbId, season: episodes.seasonNumber })
      .from(episodes)
      .innerJoin(shows, eq(shows.id, episodes.showId))
      .innerJoin(mediaFiles, eq(mediaFiles.episodeId, episodes.id))
      .where(inArray(shows.tmdbId, ids))
      .all();
    for (const r of rows) if (r.tmdbId !== null) map.set(r.tmdbId, (map.get(r.tmdbId) ?? new Set()).add(r.season));
    return map;
  };
  const open = (s: RequestState | null) => s === null || s === 'declined' || s === 'failed';
  const withLibrary = <T extends { mediaType: 'movie' | 'tv'; tmdbId: number; state?: RequestState | null; seasons?: Array<{ seasonNumber: number; state: RequestState | null }> }>(items: T[], user: SessionUser) => {
    const local = inLibrary(items, user);
    // Anywhere on this server (also in libraries this user cannot see).
    const anywhere = inLibrary(items);
    const here = seasonsHere(items.filter((x) => x.mediaType === 'tv' && x.seasons).map((x) => x.tmdbId));
    return items.map((x) => {
      const l = local(x);
      // This server decides what is here: a title removed from it can still be "available" in
      // Seerr for a while (until Seerr checks again). Then it is shown as not here, and requestable.
      const removed = anywhere(x) === null;
      const gone = (s: RequestState | null | undefined) => removed && (s === 'available' || s === 'partiallyAvailable');
      // A season on this server is there, also when Seerr never fetched it (it was there before):
      // one season of a show being here leaves the others requestable.
      const onServer = x.mediaType === 'tv' ? here.get(x.tmdbId) : undefined;
      const seasons = x.seasons?.map((s) => {
        const state = gone(s.state) ? null : s.state;
        return { ...s, state: open(state) && onServer?.has(s.seasonNumber) ? ('available' as const) : state };
      });
      return { ...x, ...(x.state !== undefined ? { state: gone(x.state) ? null : x.state } : {}), ...(seasons ? { seasons } : {}), inLibrary: l !== null, local: l };
    });
  };

  app.get('/api/seerr/search', seerrUser, async (request) => {
    const q = z.object({ q: z.string().trim().min(1).max(100), page: z.coerce.number().int().min(1).max(20).default(1) }).parse(request.query);
    const r = await ctx.seerr.search(q.q, q.page, lang(request.user!.language));
    return { ...r, results: withLibrary(r.results, request.user!) };
  });

  /** One row of the catalog for the home screen: trending, popular, a genre, coming soon. */
  app.get('/api/seerr/discover', seerrUser, async (request) => {
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

  /**
   * Whether a show has seasons left to request, for the "Request seasons" button on its page. What
   * Seerr knows is kept a few minutes (the page asks on every visit); what is here is looked up fresh.
   * Seerr away: the button stays (true), as before.
   */
  const showDetails = new Map<number, { at: number; details: Awaited<ReturnType<typeof ctx.seerr.details>> }>();
  const forget = (mediaType: string, id: number) => {
    if (mediaType === 'tv') showDetails.delete(id);
  };
  app.get('/api/seerr/tv/:id/open', seerrUser, async (request) => {
    const p = z.object({ id: tmdbId }).parse(request.params);
    let hit = showDetails.get(p.id);
    if (!hit || Date.now() - hit.at > SHOW_FRESH_MS) {
      try {
        hit = { at: Date.now(), details: await ctx.seerr.details('tv', p.id, lang(request.user!.language)) };
      } catch {
        return { open: true };
      }
      showDetails.delete(p.id);
      showDetails.set(p.id, hit);
      if (showDetails.size > 500) showDetails.delete(showDetails.keys().next().value!);
    }
    const d = withLibrary([hit.details], request.user!)[0]!;
    return { open: d.seasons.some((s) => open(s.state)) };
  });

  app.get('/api/seerr/:type/:id', seerrUser, async (request) => {
    const p = z.object({ type: mediaType, id: tmdbId }).parse(request.params);
    const d = await ctx.seerr.details(p.type, p.id, lang(request.user!.language));
    return withLibrary([d], request.user!)[0];
  });

  /** The trailer of a title that is not in the library: at TMDB, or through Seerr without a TMDB key. */
  app.get('/api/seerr/:type/:id/trailer', seerrUser, async (request) => {
    const p = z.object({ type: mediaType, id: tmdbId }).parse(request.params);
    return ctx.trailers.get(p.type, p.id, { viaSeerr: true });
  });

  /** Titles like this one, for its page (what is here opens straight away). */
  app.get('/api/seerr/:type/:id/recommendations', seerrUser, async (request) => {
    const p = z.object({ type: mediaType, id: tmdbId }).parse(request.params);
    const r = await ctx.seerr.recommendations(p.type, p.id, lang(request.user!.language));
    return { ...r, results: withLibrary(r.results, request.user!) };
  });

  const recent = new Map<number, number[]>();
  app.post('/api/seerr/requests', seerrUser, async (request) => {
    const body = z.object({ mediaType, tmdbId, seasons: z.array(z.number().int().min(1).max(1000)).max(200).nullable().default(null) }).parse(request.body);
    const user = request.user!;
    const now = Date.now();
    const mine = (recent.get(user.id) ?? []).filter((t) => t > now - 3_600_000);
    if (mine.length >= REQUESTS_PER_HOUR) throw new HttpError(429, 'You made many requests in the last hour. Try again later.');
    // Title and poster from Seerr itself (never taken from the browser).
    let d = await ctx.seerr.details(body.mediaType, body.tmdbId, lang(user.language));
    // A movie here is here; of a show, only the seasons that are here (the others can be requested).
    if (body.mediaType === 'movie' && inLibrary([d])(d) !== null) throw new HttpError(409, 'This is already in the library.');
    // Removed from this library but still (partly) available in Seerr: Seerr forgets it first, so it
    // can be requested again.
    if (await ctx.seerr.clearIfGone(body.mediaType, body.tmdbId)) d = await ctx.seerr.details(body.mediaType, body.tmdbId, lang(user.language));
    // A show with seasons requested before: only the others can be asked for.
    let seasons = body.seasons;
    if (body.mediaType === 'tv') {
      const here = seasonsHere([body.tmdbId]).get(body.tmdbId) ?? new Set<number>();
      const free = d.seasons.filter((s) => open(s.state) && !here.has(s.seasonNumber)).map((s) => s.seasonNumber);
      if (seasons) seasons = seasons.filter((n) => free.includes(n));
      else if (free.length < d.seasons.length) seasons = free;
      if (seasons && seasons.length === 0) {
        const asked = body.seasons ?? d.seasons.map((s) => s.seasonNumber);
        throw new HttpError(409, asked.length > 0 && asked.every((n) => here.has(n)) ? 'This is already in the library.' : 'This has already been requested.');
      }
    }
    const r = await ctx.seerr.request(body.mediaType, body.tmdbId, body.mediaType === 'tv' ? seasons : null);
    forget(body.mediaType, body.tmdbId);
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

  /** How far fetching each request is (by Seerr's request id), as last asked; kept in memory only. */
  const downloads = new Map<number, { at: number; download: Download | null }>();
  const downloadOf = (r: typeof seerrRequests.$inferSelect) => (FETCHING.has(r.state) ? (downloads.get(r.seerrId)?.download ?? null) : null);
  const view = (r: typeof seerrRequests.$inferSelect) => ({ id: r.id, mediaType: r.mediaType, tmdbId: r.tmdbId, title: r.title, posterPath: r.posterPath, state: r.state as RequestState | 'removed', download: downloadOf(r), createdAt: r.createdAt, updatedAt: r.updatedAt });

  /**
   * Asks Seerr where requests stand: every few minutes each, and every few seconds while one is being
   * fetched (for its progress). A few per list at most; Seerr away: the last known state.
   */
  const follow = async (rows: Array<typeof seerrRequests.$inferSelect>) => {
    if (!ctx.seerr.configured()) return;
    const now = Date.now();
    const due = rows
      .filter((r) => r.state !== 'available' && r.state !== 'removed')
      .filter((r) => now - r.updatedAt > STATE_FRESH_MS || (FETCHING.has(r.state) && now - (downloads.get(r.seerrId)?.at ?? 0) > DOWNLOAD_FRESH_MS))
      .slice(0, REFRESH_PER_LIST);
    await Promise.all(
      due.map(async (r) => {
        try {
          const status = await ctx.seerr.requestStatus(r.seerrId);
          const state = status?.state ?? 'removed';
          const at = Date.now();
          if (state !== r.state || at - r.updatedAt > STATE_FRESH_MS) {
            db.update(seerrRequests).set({ state, updatedAt: at }).where(eq(seerrRequests.id, r.id)).run();
            r.state = state;
            r.updatedAt = at;
          }
          downloads.delete(r.seerrId);
          downloads.set(r.seerrId, { at, download: status?.download ?? null });
          if (downloads.size > 1000) downloads.delete(downloads.keys().next().value!);
        } catch {
          /* Seerr unreachable: the last known state */
        }
      }),
    );
  };

  /** Your requests, with where they stand now and how far fetching them is. */
  app.get('/api/seerr/requests', seerrUser, async (request) => {
    const rows = db.select().from(seerrRequests).where(eq(seerrRequests.userId, request.user!.id)).orderBy(desc(seerrRequests.createdAt)).limit(50).all();
    await follow(rows);
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
    await follow(rows.map((x) => x.r));
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
    forget(row.mediaType, row.tmdbId);
    // No other request left for it: requestable again (instead of "being added" for good).
    try {
      await ctx.seerr.resetIfUnrequested(row.mediaType as 'movie' | 'tv', row.tmdbId);
    } catch {
      /* Seerr away: the request itself is gone; resetting the title is possible from its page */
    }
    ctx.audit.record('seerr.cancelled', { actor: request.user, ip: request.ip, target: row.title, detail: inSeerr ? undefined : 'no longer at Seerr' });
    return { ok: true, inSeerr };
  });

  /** Approves or declines a request that waits for approval in Seerr (from the website or the app). */
  app.post<{ Params: { id: string; action: string } }>('/api/admin/seerr/requests/:id/:action', { preHandler: requireAdmin }, async (request) => {
    const id = parseId(request.params.id);
    const { action } = z.object({ action: z.enum(['approve', 'decline']) }).strict().parse({ action: request.params.action });
    const row = db.select().from(seerrRequests).where(eq(seerrRequests.id, id)).get();
    if (!row) throw new HttpError(404, 'Request not found.');
    const state = await ctx.seerr.decide(row.seerrId, action === 'approve');
    const now = Date.now();
    db.update(seerrRequests).set({ state: state ?? 'removed', updatedAt: now }).where(eq(seerrRequests.id, id)).run();
    forget(row.mediaType, row.tmdbId);
    if (!state) throw new HttpError(404, 'Seerr no longer has this request.');
    ctx.audit.record(action === 'approve' ? 'seerr.approved' : 'seerr.declined', { actor: request.user, ip: request.ip, target: row.title });
    return view({ ...row, state, updatedAt: now });
  });

  /**
   * Makes a title requestable again: every request for it is cancelled in Seerr (whoever made it,
   * also outside Vidalune) and Seerr forgets it. Not for what is (partly) available already.
   */
  app.delete('/api/admin/seerr/media/:type/:id', { preHandler: requireAdmin }, async (request) => {
    const p = z.object({ type: mediaType, id: tmdbId }).parse(request.params);
    const r = await ctx.seerr.reset(p.type, p.id);
    forget(p.type, p.id);
    const mine = db.select().from(seerrRequests).where(and(eq(seerrRequests.mediaType, p.type), eq(seerrRequests.tmdbId, p.id))).all();
    db.delete(seerrRequests).where(and(eq(seerrRequests.mediaType, p.type), eq(seerrRequests.tmdbId, p.id))).run();
    ctx.audit.record('seerr.reset', { actor: request.user, ip: request.ip, target: mine[0]?.title ?? `${p.type} ${p.id}`, detail: `${r.requests} request(s)` });
    return { ok: true, requests: r.requests };
  });
}
