import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireAdmin, requireUser } from '../app.js';
import { movies, seerrRequests, shows } from '../db/schema.js';
import { HttpError } from '../http-error.js';
import type { RequestState } from '../services/seerr.js';

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

  /** Which of these are in the library already (by TMDB id). */
  const inLibrary = (items: Array<{ mediaType: 'movie' | 'tv'; tmdbId: number }>) => {
    const ids = (t: 'movie' | 'tv') => items.filter((i) => i.mediaType === t).map((i) => i.tmdbId);
    const m = ids('movie');
    const s = ids('tv');
    const haveMovies = new Set(m.length ? db.select({ id: movies.tmdbId }).from(movies).where(and(isNotNull(movies.tmdbId), inArray(movies.tmdbId, m))).all().map((r) => r.id) : []);
    const haveShows = new Set(s.length ? db.select({ id: shows.tmdbId }).from(shows).where(and(isNotNull(shows.tmdbId), inArray(shows.tmdbId, s))).all().map((r) => r.id) : []);
    return (i: { mediaType: 'movie' | 'tv'; tmdbId: number }) => (i.mediaType === 'movie' ? haveMovies : haveShows).has(i.tmdbId);
  };

  app.get('/api/seerr/search', { preHandler: requireUser }, async (request) => {
    const q = z.object({ q: z.string().trim().min(1).max(100), page: z.coerce.number().int().min(1).max(50).default(1) }).parse(request.query);
    const r = await ctx.seerr.search(q.q, q.page, lang(request.user!.language));
    const have = inLibrary(r.results);
    return { ...r, results: r.results.map((x) => ({ ...x, inLibrary: have(x) })) };
  });

  app.get('/api/seerr/:type/:id', { preHandler: requireUser }, async (request) => {
    const p = z.object({ type: mediaType, id: tmdbId }).parse(request.params);
    const d = await ctx.seerr.details(p.type, p.id, lang(request.user!.language));
    return { ...d, inLibrary: inLibrary([d])(d) };
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
    if (inLibrary([d])(d)) throw new HttpError(409, 'This is already in the library.');
    const r = await ctx.seerr.request(body.mediaType, body.tmdbId, body.mediaType === 'tv' ? body.seasons : null);
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
}
