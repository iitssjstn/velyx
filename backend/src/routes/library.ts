import type { FastifyInstance } from 'fastify';
import { and, asc, count, desc, eq, inArray, or, sql, type SQLWrapper } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../app.js';
import { requireUser } from '../app.js';
import {
  credits,
  episodes,
  genres,
  libraries,
  mediaFiles,
  movieGenres,
  movies,
  people,
  seasons,
  showGenres,
  shows,
  subtitles,
  watchlist,
  watchProgress,
  continueDismissals,
} from '../db/schema.js';
import { ReplacementTracker } from '../services/replacements.js';
import { Catalog } from '../services/catalog.js';
import { notFound, parseId } from '../http-error.js';
import { languageName } from '../services/parser.js';
import { SEARCH_KIND, ftsQuery } from '../services/search.js';
import { similarItems } from '../services/recommendations.js';
import { listQuery, movieListWhere, movieRuntime, showListWhere } from '../services/list-filters.js';
import { visibleCollections } from '../services/collections.js';
import { assertEpisode, assertMovie, assertShow, canSee, scopeCondition } from '../services/access.js';

type FileRow = typeof mediaFiles.$inferSelect;

function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function fileInfo(f: FileRow, externalSubs: Array<typeof subtitles.$inferSelect> = []) {
  return {
    id: f.id,
    fileName: f.path.split('/').pop() ?? f.path,
    size: f.size,
    container: f.container,
    durationSec: f.durationSec,
    bitrate: f.bitrate,
    videoCodec: f.videoCodec,
    videoProfile: f.videoProfile,
    videoBitDepth: f.videoBitDepth,
    videoRange: f.videoRange,
    width: f.width,
    height: f.height,
    fps: f.fps,
    audioCodec: f.audioCodec,
    audioChannels: f.audioChannels,
    audioTracks: (f.audioTracks ?? []).map((a) => ({ ...a, languageName: a.language ? languageName(a.language) : null })),
    embeddedSubtitles: (f.subtitleTracks ?? []).map((s) => ({ ...s, languageName: s.language ? languageName(s.language) : null })),
    externalSubtitles: externalSubs.map((s) => ({ id: s.id, language: s.language, label: s.label, format: s.format, forced: s.forced })),
    probeError: f.probeError,
  };
}

export async function libraryRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const catalog = new Catalog(ctx.db);
  const replacements = new ReplacementTracker(ctx.db);
  const db = ctx.db;

  const scopeOf = (request: { user: { id: number; role: 'admin' | 'user' } | null }) => ctx.access.scope(request.user!);
  const inWatchlist = (userId: number, where: { movieId?: number; showId?: number }) =>
    Boolean(
      db
        .select({ id: watchlist.id })
        .from(watchlist)
        .where(and(eq(watchlist.userId, userId), where.movieId ? eq(watchlist.movieId, where.movieId) : eq(watchlist.showId, where.showId!)))
        .get(),
    );

  /** Collections (visible to this user) that contain the movie or show. */
  const collectionsOf = (request: { user: { id: number; role: 'admin' | 'user' } | null }, where: { movieId?: number; showId?: number }) =>
    visibleCollections(db, scopeOf(request), request.user!.role === 'admin')
      .filter((c) => c.members.some((m) => (where.movieId ? m.movieId === where.movieId : m.showId === where.showId)))
      .map((c) => ({ id: c.row.id, name: c.row.name, kind: c.row.kind }));

  const subsFor = (fileIds: number[]) =>
    fileIds.length ? db.select().from(subtitles).where(inArray(subtitles.mediaFileId, fileIds)).all() : [];

  // ------------------------------------------------------------------ home
  app.get('/api/home', { preHandler: requireUser }, async (request) => {
    const userId = request.user!.id;
    const scope = scopeOf(request);
    const movieVis = scopeCondition(scope, movies.libraryId);
    const showVis = scopeCondition(scope, shows.libraryId);

    // Continue watching: partially watched items + "next up" episodes of shows in progress.
    const inProgress = db
      .select()
      .from(watchProgress)
      .where(and(eq(watchProgress.userId, userId), eq(watchProgress.completed, false), sql`${watchProgress.positionSec} >= 30`))
      .orderBy(desc(watchProgress.updatedAt))
      .limit(30)
      .all();

    const latestCompletedPerShow = db
      .select({ showId: episodes.showId, episodeId: episodes.id, updatedAt: sql<number>`max(${watchProgress.updatedAt})` })
      .from(watchProgress)
      .innerJoin(episodes, eq(episodes.id, watchProgress.episodeId))
      .where(and(eq(watchProgress.userId, userId), eq(watchProgress.completed, true)))
      .groupBy(episodes.showId)
      .orderBy(desc(sql`max(${watchProgress.updatedAt})`))
      .limit(20)
      .all();

    type CW = {
      type: 'movie' | 'episode';
      id: number;
      title: string;
      subtitle: string | null;
      imagePath: string | null;
      posterPath: string | null;
      showId: number | null;
      progress: { positionSec: number; durationSec: number } | null;
      updatedAt: number;
    };
    const cw: CW[] = [];
    const showsInProgress = new Set<number>();

    for (const p of inProgress) {
      if (p.movieId) {
        const m = db.select().from(movies).where(eq(movies.id, p.movieId)).get();
        if (m && canSee(scope, m.libraryId))
          cw.push({
            type: 'movie',
            id: m.id,
            title: m.title,
            subtitle: m.year ? String(m.year) : null,
            imagePath: m.backdropPath,
            posterPath: m.posterPath,
            showId: null,
            progress: { positionSec: p.positionSec, durationSec: p.durationSec },
            updatedAt: p.updatedAt,
          });
      } else if (p.episodeId) {
        const row = db
          .select({ e: episodes, s: shows })
          .from(episodes)
          .innerJoin(shows, eq(shows.id, episodes.showId))
          .where(eq(episodes.id, p.episodeId))
          .get();
        if (row && canSee(scope, row.s.libraryId) && !showsInProgress.has(row.s.id)) {
          showsInProgress.add(row.s.id);
          cw.push({
            type: 'episode',
            id: row.e.id,
            title: row.s.title,
            subtitle: `S${row.e.seasonNumber} E${row.e.episodeNumber}${row.e.title ? ` · ${row.e.title}` : ''}`,
            imagePath: row.e.stillPath ?? row.s.backdropPath,
            posterPath: row.s.posterPath,
            showId: row.s.id,
            progress: { positionSec: p.positionSec, durationSec: p.durationSec },
            updatedAt: p.updatedAt,
          });
        }
      }
    }
    for (const c of latestCompletedPerShow) {
      if (showsInProgress.has(c.showId)) continue;
      // SQLite takes the bare episode id from the row holding max(updatedAt): the most recently completed episode.
      const next = catalog.nextEpisode(c.episodeId);
      if (!next) continue;
      const existing = db
        .select()
        .from(watchProgress)
        .where(and(eq(watchProgress.userId, userId), eq(watchProgress.episodeId, next.id)))
        .get();
      if (existing?.completed) continue;
      const s = db.select().from(shows).where(eq(shows.id, c.showId)).get();
      if (!s || !canSee(scope, s.libraryId)) continue;
      showsInProgress.add(s.id);
      cw.push({
        type: 'episode',
        id: next.id,
        title: s.title,
        subtitle: `Next: S${next.seasonNumber} E${next.episodeNumber}${next.title ? ` · ${next.title}` : ''}`,
        imagePath: next.stillPath ?? s.backdropPath,
        posterPath: s.posterPath,
        showId: s.id,
        progress: existing ? { positionSec: existing.positionSec, durationSec: existing.durationSec } : null,
        updatedAt: c.updatedAt,
      });
    }
    // Items the user removed from Continue Watching stay hidden until they are watched again.
    const dismissed = new Map(
      db
        .select()
        .from(continueDismissals)
        .where(eq(continueDismissals.userId, userId))
        .all()
        .map((d) => [`${d.kind}:${d.itemId}`, d.at]),
    );
    const visibleCw = cw.filter((c) => {
      const at = dismissed.get(c.type === 'movie' ? `movie:${c.id}` : `show:${c.showId}`);
      return at === undefined || c.updatedAt > at;
    });
    cw.splice(0, cw.length, ...visibleCw);
    cw.sort((a, b) => b.updatedAt - a.updatedAt);

    const recentMovies = db.select().from(movies).where(movieVis).orderBy(desc(movies.addedAt)).limit(20).all();
    const recentShows = db.select().from(shows).where(showVis).orderBy(desc(shows.lastEpisodeAddedAt)).limit(20).all();
    const recentlyAdded = [...catalog.movieCards(userId, recentMovies), ...catalog.showCards(userId, recentShows)]
      .sort((a, b) => b.addedAt - a.addedAt)
      .slice(0, 20);

    // Recently watched: completed items, newest first, one card per show.
    const watchedRows = db
      .select({ movieId: watchProgress.movieId, showId: episodes.showId })
      .from(watchProgress)
      .leftJoin(episodes, eq(episodes.id, watchProgress.episodeId))
      .where(and(eq(watchProgress.userId, userId), eq(watchProgress.completed, true)))
      .orderBy(desc(watchProgress.updatedAt))
      .limit(60)
      .all();
    const watchedMovieIds: number[] = [];
    const watchedShowIds: number[] = [];
    // Newest first across movies and shows together.
    const watchedOrder = new Map<string, number>();
    for (const w of watchedRows) {
      const key = w.movieId ? `movie:${w.movieId}` : w.showId ? `show:${w.showId}` : null;
      if (!key || watchedOrder.has(key)) continue;
      watchedOrder.set(key, watchedOrder.size);
      if (w.movieId) watchedMovieIds.push(w.movieId);
      else if (w.showId) watchedShowIds.push(w.showId);
    }
    const recentlyWatched = [
      ...catalog.movieCards(userId, watchedMovieIds.length ? db.select().from(movies).where(and(inArray(movies.id, watchedMovieIds), movieVis)).all() : []),
      ...catalog.showCards(userId, watchedShowIds.length ? db.select().from(shows).where(and(inArray(shows.id, watchedShowIds), showVis)).all() : []),
    ]
      .sort((a, b) => watchedOrder.get(`${a.type}:${a.id}`)! - watchedOrder.get(`${b.type}:${b.id}`)!)
      .slice(0, 20);

    const movieRow = db.select().from(movies).where(movieVis).orderBy(desc(movies.releaseDate), desc(movies.year)).limit(20).all();
    const showRow = db.select().from(shows).where(showVis).orderBy(desc(shows.rating)).limit(20).all();

    const favoritesSection = catalog.savedCards('favorites', userId, scope, 40);
    const watchlistSection = catalog.watchlistCards(userId, scope, 20);

    const hero = cw[0] ?? null;
    return {
      hero,
      continueWatching: cw.slice(0, 20),
      recentlyAdded,
      recentlyWatched,
      movies: catalog.movieCards(userId, movieRow),
      shows: catalog.showCards(userId, showRow),
      favorites: favoritesSection,
      watchlist: watchlistSection,
      counts: {
        movies: db.select({ n: count() }).from(movies).where(movieVis).get()!.n,
        shows: db.select({ n: count() }).from(shows).where(showVis).get()!.n,
        libraries: db.select({ n: count() }).from(libraries).where(scopeCondition(scope, libraries.id)).get()!.n,
      },
    };
  });

  const dismissBody = z.object({ type: z.enum(['movie', 'episode']), id: z.number().int().positive() });

  /** Removes a movie, or a show (via one of its episodes), from Continue Watching. */
  app.post('/api/home/continue/dismiss', { preHandler: requireUser }, async (request) => {
    const body = dismissBody.parse(request.body);
    const scope = scopeOf(request);
    const target = body.type === 'movie' ? { kind: 'movie' as const, itemId: assertMovie(db, scope, body.id).id } : { kind: 'show' as const, itemId: assertEpisode(db, scope, body.id).s.id };
    db.insert(continueDismissals)
      .values({ userId: request.user!.id, ...target, at: Date.now() })
      .onConflictDoUpdate({ target: [continueDismissals.userId, continueDismissals.kind, continueDismissals.itemId], set: { at: Date.now() } })
      .run();
    return { ok: true };
  });

  // ------------------------------------------------------------------ genres
  app.get<{ Querystring: { type?: string } }>('/api/genres', { preHandler: requireUser }, async (request) => {
    const scope = scopeOf(request);
    if (request.query.type === 'shows') {
      return db
        .select({ id: genres.id, name: genres.name, count: count() })
        .from(genres)
        .innerJoin(showGenres, eq(showGenres.genreId, genres.id))
        .innerJoin(shows, eq(shows.id, showGenres.showId))
        .where(scopeCondition(scope, shows.libraryId))
        .groupBy(genres.id)
        .orderBy(asc(genres.name))
        .all();
    }
    return db
      .select({ id: genres.id, name: genres.name, count: count() })
      .from(genres)
      .innerJoin(movieGenres, eq(movieGenres.genreId, genres.id))
      .innerJoin(movies, eq(movies.id, movieGenres.movieId))
      .where(scopeCondition(scope, movies.libraryId))
      .groupBy(genres.id)
      .orderBy(asc(genres.name))
      .all();
  });

  // ------------------------------------------------------------------ movies
  app.get('/api/movies', { preHandler: requireUser }, async (request) => {
    const q = listQuery.parse(request.query);
    const userId = request.user!.id;
    const where = movieListWhere(q, userId, scopeOf(request));
    const dir = q.order ?? (q.sort === 'title' ? 'asc' : 'desc');
    const o = dir === 'asc' ? asc : desc;
    // Missing values (no year, never watched, …) always sort last.
    const last = (col: SQLWrapper) => sql`${col} IS NULL`;
    const lastWatched = sql`(SELECT max(updated_at) FROM watch_progress WHERE user_id = ${userId} AND movie_id = ${movies.id})`;
    const runtime = movieRuntime;
    const orderBy = {
      title: [o(movies.sortTitle)],
      added: [o(movies.addedAt), asc(movies.sortTitle)],
      year: [last(movies.year), o(movies.year), asc(movies.sortTitle)],
      rating: [last(movies.rating), o(movies.rating), asc(movies.sortTitle)],
      release: [o(movies.releaseDate), o(movies.year), asc(movies.sortTitle)],
      watched: [last(lastWatched), o(lastWatched), asc(movies.sortTitle)],
      runtime: [last(runtime), o(runtime), asc(movies.sortTitle)],
    }[q.sort];
    const total = db.select({ n: count() }).from(movies).where(where).get()!.n;
    const rows = db
      .select()
      .from(movies)
      .where(where)
      .orderBy(...orderBy)
      .limit(q.limit)
      .offset((q.page - 1) * q.limit)
      .all();
    return { items: catalog.movieCards(userId, rows), total, page: q.page, pageSize: q.limit };
  });

  app.get<{ Params: { id: string } }>('/api/movies/:id', { preHandler: requireUser }, async (request) => {
    const id = parseId(request.params.id);
    const userId = request.user!.id;
    const m = assertMovie(db, scopeOf(request), id);
    const g = db
      .select({ id: genres.id, name: genres.name })
      .from(movieGenres)
      .innerJoin(genres, eq(genres.id, movieGenres.genreId))
      .where(eq(movieGenres.movieId, id))
      .all();
    const people_ = db
      .select({ id: people.id, name: people.name, profilePath: people.profilePath, kind: credits.kind, role: credits.role })
      .from(credits)
      .innerJoin(people, eq(people.id, credits.personId))
      .where(eq(credits.movieId, id))
      .orderBy(asc(credits.kind), asc(credits.sortOrder))
      .all();
    const files = db.select().from(mediaFiles).where(eq(mediaFiles.movieId, id)).orderBy(desc(mediaFiles.height), desc(mediaFiles.size)).all();
    const subs = subsFor(files.map((f) => f.id));
    const progress = catalog.movieProgress(userId, [id]).get(id) ?? null;
    const favorite = catalog.favoriteIds(userId).movies.has(id);
    const lib = db.select({ name: libraries.name }).from(libraries).where(eq(libraries.id, m.libraryId)).get();
    return {
      id: m.id,
      type: 'movie',
      title: m.title,
      originalTitle: m.originalTitle,
      year: m.year,
      overview: m.overview,
      tagline: m.tagline,
      runtime: m.runtime ?? (files[0]?.durationSec ? Math.round(files[0].durationSec / 60) : null),
      releaseDate: m.releaseDate,
      rating: m.rating,
      voteCount: m.voteCount,
      director: m.director,
      posterPath: m.posterPath,
      backdropPath: m.backdropPath,
      tmdbId: m.tmdbId,
      imdbId: m.imdbId,
      libraryName: lib?.name ?? null,
      match: { status: m.matchStatus, confidence: m.matchConfidence, parsedTitle: m.parsedTitle, parsedYear: m.parsedYear },
      genres: g,
      cast: people_.filter((p) => p.kind === 'cast').map(({ kind: _k, ...p }) => p),
      crew: people_.filter((p) => p.kind === 'crew').map(({ kind: _k, ...p }) => p),
      files: files.map((f) => fileInfo(f, subs.filter((s) => s.mediaFileId === f.id))),
      progress,
      favorite,
      watchlist: inWatchlist(userId, { movieId: id }),
      collections: collectionsOf(request, { movieId: id }),
      /** Earlier files this movie had (upgrades), newest first. */
      replacements: replacements.history({ movieId: id }),
    };
  });

  /** More Like This: deterministic recommendations from shared metadata. */
  app.get<{ Params: { id: string } }>('/api/movies/:id/similar', { preHandler: requireUser }, async (request) => {
    const id = parseId(request.params.id);
    const scope = scopeOf(request);
    assertMovie(db, scope, id);
    const ranked = similarItems(db, scope, 'movie', id);
    if (!ranked.length) return [];
    const order = new Map(ranked.map((r, i) => [r.id, i]));
    const rows = db.select().from(movies).where(inArray(movies.id, ranked.map((r) => r.id))).all().sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    return catalog.movieCards(request.user!.id, rows);
  });

  app.get<{ Params: { id: string } }>('/api/shows/:id/similar', { preHandler: requireUser }, async (request) => {
    const id = parseId(request.params.id);
    const scope = scopeOf(request);
    assertShow(db, scope, id);
    const ranked = similarItems(db, scope, 'show', id);
    if (!ranked.length) return [];
    const order = new Map(ranked.map((r, i) => [r.id, i]));
    const rows = db.select().from(shows).where(inArray(shows.id, ranked.map((r) => r.id))).all().sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    return catalog.showCards(request.user!.id, rows);
  });

  // ------------------------------------------------------------------ shows
  app.get('/api/shows', { preHandler: requireUser }, async (request) => {
    const q = listQuery.parse(request.query);
    const userId = request.user!.id;
    const where = showListWhere(q, userId, scopeOf(request));
    const dir = q.order ?? (q.sort === 'title' ? 'asc' : 'desc');
    const o = dir === 'asc' ? asc : desc;
    const last = (col: SQLWrapper) => sql`${col} IS NULL`;
    const lastWatched = sql`(SELECT max(wp.updated_at) FROM watch_progress wp JOIN episodes e ON e.id = wp.episode_id WHERE wp.user_id = ${userId} AND e.show_id = ${shows.id})`;
    const runtime = sql`(SELECT avg(runtime) FROM episodes e WHERE e.show_id = ${shows.id})`;
    const orderBy = {
      title: [o(shows.sortTitle)],
      added: [o(shows.lastEpisodeAddedAt), asc(shows.sortTitle)],
      year: [last(shows.year), o(shows.year), asc(shows.sortTitle)],
      rating: [last(shows.rating), o(shows.rating), asc(shows.sortTitle)],
      release: [o(shows.firstAirDate), asc(shows.sortTitle)],
      watched: [last(lastWatched), o(lastWatched), asc(shows.sortTitle)],
      runtime: [last(runtime), o(runtime), asc(shows.sortTitle)],
    }[q.sort];
    const total = db.select({ n: count() }).from(shows).where(where).get()!.n;
    const rows = db
      .select()
      .from(shows)
      .where(where)
      .orderBy(...orderBy)
      .limit(q.limit)
      .offset((q.page - 1) * q.limit)
      .all();
    return { items: catalog.showCards(userId, rows), total, page: q.page, pageSize: q.limit };
  });

  app.get<{ Params: { id: string } }>('/api/shows/:id', { preHandler: requireUser }, async (request) => {
    const id = parseId(request.params.id);
    const userId = request.user!.id;
    const s = assertShow(db, scopeOf(request), id);
    const g = db
      .select({ id: genres.id, name: genres.name })
      .from(showGenres)
      .innerJoin(genres, eq(genres.id, showGenres.genreId))
      .where(eq(showGenres.showId, id))
      .all();
    const people_ = db
      .select({ id: people.id, name: people.name, profilePath: people.profilePath, kind: credits.kind, role: credits.role })
      .from(credits)
      .innerJoin(people, eq(people.id, credits.personId))
      .where(eq(credits.showId, id))
      .orderBy(asc(credits.kind), asc(credits.sortOrder))
      .all();
    const seasonRows = db.select().from(seasons).where(eq(seasons.showId, id)).orderBy(asc(seasons.seasonNumber)).all();
    const eps = db
      .select({ id: episodes.id, seasonId: episodes.seasonId, seasonNumber: episodes.seasonNumber, episodeNumber: episodes.episodeNumber, title: episodes.title })
      .from(episodes)
      .where(eq(episodes.showId, id))
      .orderBy(asc(episodes.seasonNumber), asc(episodes.episodeNumber))
      .all();
    const progress = catalog.episodeProgress(userId, eps.map((e) => e.id));
    // Up next: first in-progress episode, otherwise the first unwatched one after the last watched.
    const regular = eps.filter((e) => e.seasonNumber > 0);
    const ordered = regular.length ? regular : eps;
    let upNext = ordered.find((e) => {
      const p = progress.get(e.id);
      return p && !p.completed && p.positionSec >= 30;
    });
    if (!upNext) {
      let lastWatchedIdx = -1;
      ordered.forEach((e, i) => {
        if (progress.get(e.id)?.completed) lastWatchedIdx = i;
      });
      upNext = ordered[lastWatchedIdx + 1] ?? ordered[0];
    }
    const favorite = catalog.favoriteIds(userId).shows.has(id);
    return {
      id: s.id,
      type: 'show',
      title: s.title,
      originalTitle: s.originalTitle,
      year: s.year,
      overview: s.overview,
      firstAirDate: s.firstAirDate,
      status: s.status,
      network: s.network,
      rating: s.rating,
      posterPath: s.posterPath,
      backdropPath: s.backdropPath,
      tmdbId: s.tmdbId,
      imdbId: s.imdbId,
      match: { status: s.matchStatus, confidence: s.matchConfidence, parsedTitle: s.parsedTitle, parsedYear: s.parsedYear },
      genres: g,
      cast: people_.filter((p) => p.kind === 'cast').map(({ kind: _k, ...p }) => p),
      crew: people_.filter((p) => p.kind === 'crew').map(({ kind: _k, ...p }) => p),
      seasons: seasonRows.map((se) => {
        const inSeason = eps.filter((e) => e.seasonId === se.id);
        return {
          id: se.id,
          seasonNumber: se.seasonNumber,
          name: se.name ?? (se.seasonNumber === 0 ? 'Specials' : `Season ${se.seasonNumber}`),
          overview: se.overview,
          airDate: se.airDate,
          posterPath: se.posterPath,
          episodeCount: inSeason.length,
          watchedCount: inSeason.filter((e) => progress.get(e.id)?.completed).length,
        };
      }),
      episodeCount: eps.length,
      watchedCount: eps.filter((e) => progress.get(e.id)?.completed).length,
      upNext: upNext
        ? { id: upNext.id, seasonNumber: upNext.seasonNumber, episodeNumber: upNext.episodeNumber, title: upNext.title, progress: progress.get(upNext.id) ?? null }
        : null,
      favorite,
      watchlist: inWatchlist(userId, { showId: id }),
      collections: collectionsOf(request, { showId: id }),
    };
  });

  app.get<{ Params: { id: string; season: string } }>('/api/shows/:id/seasons/:season', { preHandler: requireUser }, async (request) => {
    const id = parseId(request.params.id);
    const n = Number(request.params.season);
    if (!Number.isInteger(n) || n < 0) throw notFound('Season');
    const userId = request.user!.id;
    assertShow(db, scopeOf(request), id);
    const season = db
      .select()
      .from(seasons)
      .where(and(eq(seasons.showId, id), eq(seasons.seasonNumber, n)))
      .get();
    if (!season) throw notFound('Season');
    const eps = db.select().from(episodes).where(eq(episodes.seasonId, season.id)).orderBy(asc(episodes.episodeNumber)).all();
    const progress = catalog.episodeProgress(userId, eps.map((e) => e.id));
    const files = eps.length
      ? db
          .select({ episodeId: mediaFiles.episodeId, durationSec: mediaFiles.durationSec, height: mediaFiles.height })
          .from(mediaFiles)
          .where(inArray(mediaFiles.episodeId, eps.map((e) => e.id)))
          .all()
      : [];
    return {
      id: season.id,
      seasonNumber: season.seasonNumber,
      name: season.name,
      overview: season.overview,
      posterPath: season.posterPath,
      episodes: eps.map((e) => {
        const f = files.find((x) => x.episodeId === e.id);
        return {
          id: e.id,
          seasonNumber: e.seasonNumber,
          episodeNumber: e.episodeNumber,
          title: e.title,
          overview: e.overview,
          airDate: e.airDate,
          runtime: e.runtime ?? (f?.durationSec ? Math.round(f.durationSec / 60) : null),
          rating: e.rating,
          stillPath: e.stillPath,
          durationSec: f?.durationSec ?? null,
          height: f?.height ?? null,
          progress: progress.get(e.id) ?? null,
        };
      }),
    };
  });

  app.get<{ Params: { id: string } }>('/api/episodes/:id', { preHandler: requireUser }, async (request) => {
    const id = parseId(request.params.id);
    const userId = request.user!.id;
    const row = assertEpisode(db, scopeOf(request), id);
    const files = db.select().from(mediaFiles).where(eq(mediaFiles.episodeId, id)).orderBy(desc(mediaFiles.height)).all();
    const subs = subsFor(files.map((f) => f.id));
    const next = catalog.nextEpisode(id);
    const prev = catalog.previousEpisode(id);
    return {
      id: row.e.id,
      type: 'episode',
      showId: row.s.id,
      showTitle: row.s.title,
      showPosterPath: row.s.posterPath,
      showBackdropPath: row.s.backdropPath,
      seasonNumber: row.e.seasonNumber,
      episodeNumber: row.e.episodeNumber,
      title: row.e.title,
      overview: row.e.overview,
      airDate: row.e.airDate,
      runtime: row.e.runtime,
      rating: row.e.rating,
      stillPath: row.e.stillPath,
      files: files.map((f) => fileInfo(f, subs.filter((s) => s.mediaFileId === f.id))),
      progress: catalog.episodeProgress(userId, [id]).get(id) ?? null,
      next: next ? { id: next.id, seasonNumber: next.seasonNumber, episodeNumber: next.episodeNumber, title: next.title, stillPath: next.stillPath } : null,
      previous: prev ? { id: prev.id, seasonNumber: prev.seasonNumber, episodeNumber: prev.episodeNumber, title: prev.title } : null,
      replacements: replacements.history({ episodeId: id }),
    };
  });

  // ------------------------------------------------------------------ search
  // Full-text search (SQLite FTS5, see migration 0008): prefix matching per word, ranked by bm25
  // with the title weighted above alternative titles. One index lookup instead of LIKE scans.
  const ftsMatch = db.$client.prepare<[string], { rowid: number; rank: number }>(
    'SELECT rowid, bm25(search_index, 10.0, 1.0) AS rank FROM search_index WHERE search_index MATCH ? ORDER BY rank LIMIT 400',
  );

  app.get<{ Querystring: { q?: string } }>('/api/search', { preHandler: requireUser }, async (request) => {
    const q = (request.query.q ?? '').trim().slice(0, 100);
    const userId = request.user!.id;
    const fts = ftsQuery(q);
    if (!q || !fts) return { query: q, movies: [], shows: [], episodes: [] };
    const scope = scopeOf(request);

    const rank = new Map<string, number>();
    const ids: Record<'movie' | 'show' | 'episode', number[]> = { movie: [], show: [], episode: [] };
    const matches = ftsMatch.all(fts);
    // Nothing starts with these words: fall back to a substring match on titles ("stellar" →
    // Interstellar). Only for 3+ characters, and only then, so typing stays cheap.
    if (!matches.length && q.length >= 3) {
      const pattern = `%${escapeLike(q)}%`;
      const likeTitle = (col: SQLWrapper) => sql`${col} LIKE ${pattern} ESCAPE '\\'`;
      for (const r of db.select({ id: movies.id }).from(movies).where(or(likeTitle(movies.title), likeTitle(movies.originalTitle))).limit(60).all()) matches.push({ rowid: r.id * 4 + SEARCH_KIND.movie, rank: 0 });
      for (const r of db.select({ id: shows.id }).from(shows).where(or(likeTitle(shows.title), likeTitle(shows.originalTitle))).limit(60).all()) matches.push({ rowid: r.id * 4 + SEARCH_KIND.show, rank: 0 });
      for (const r of db.select({ id: episodes.id }).from(episodes).where(likeTitle(episodes.title)).limit(60).all()) matches.push({ rowid: r.id * 4 + SEARCH_KIND.episode, rank: 0 });
    }
    for (const m of matches) {
      const kind = m.rowid % 4 === SEARCH_KIND.movie ? 'movie' : m.rowid % 4 === SEARCH_KIND.show ? 'show' : 'episode';
      const id = Math.floor(m.rowid / 4);
      ids[kind].push(id);
      rank.set(`${kind}:${id}`, m.rank);
    }
    // Titles that start with the query come first, then bm25 relevance.
    const plain = (t: string) => t.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const lower = plain(q);
    const byRank = (kind: string) => (a: { id: number; title: string | null }, b: { id: number; title: string | null }) => {
      const pa = plain(a.title ?? '').startsWith(lower) ? 0 : 1;
      const pb = plain(b.title ?? '').startsWith(lower) ? 0 : 1;
      return pa - pb || rank.get(`${kind}:${a.id}`)! - rank.get(`${kind}:${b.id}`)!;
    };

    const movieRows = ids.movie.length
      ? db.select().from(movies).where(and(inArray(movies.id, ids.movie), scopeCondition(scope, movies.libraryId))).all().sort(byRank('movie')).slice(0, 30)
      : [];
    const showRows = ids.show.length
      ? db.select().from(shows).where(and(inArray(shows.id, ids.show), scopeCondition(scope, shows.libraryId))).all().sort(byRank('show')).slice(0, 30)
      : [];
    const epRows = ids.episode.length
      ? db
          .select({ e: episodes, showTitle: shows.title, showBackdrop: shows.backdropPath })
          .from(episodes)
          .innerJoin(shows, eq(shows.id, episodes.showId))
          .where(and(inArray(episodes.id, ids.episode), scopeCondition(scope, shows.libraryId)))
          .all()
          .sort((a, b) => byRank('episode')({ id: a.e.id, title: a.e.title }, { id: b.e.id, title: b.e.title }))
          .slice(0, 30)
      : [];
    const epProgress = catalog.episodeProgress(userId, epRows.map((r) => r.e.id));
    return {
      query: q,
      movies: catalog.movieCards(userId, movieRows),
      shows: catalog.showCards(userId, showRows),
      episodes: epRows.map((r) => ({
        id: r.e.id,
        showId: r.e.showId,
        showTitle: r.showTitle,
        seasonNumber: r.e.seasonNumber,
        episodeNumber: r.e.episodeNumber,
        title: r.e.title,
        stillPath: r.e.stillPath ?? r.showBackdrop,
        progress: epProgress.get(r.e.id) ?? null,
      })),
    };
  });
}
