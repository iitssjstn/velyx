import { and, eq, inArray, ne } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { credits, episodes, genres, mediaFiles, movieGenres, movies, people, seasons, showGenres, shows } from '../db/schema.js';
import { createLogger } from '../logger.js';
import { pickBest, rankCandidates, type ScoredCandidate } from './matcher.js';
import { sortTitle } from './parser.js';
import type { ImageCache } from './images.js';
import { TmdbClient, TmdbError, yearOf, type TmdbCast, type TmdbCrew, type TmdbGenre } from './tmdb.js';

const log = createLogger('metadata');
const MAX_CAST = 20;

export type MatchResult = 'matched' | 'unmatched' | 'skipped' | 'failed';

export class MetadataService {
  constructor(
    private readonly db: DB,
    private readonly tmdb: TmdbClient,
    private readonly images: ImageCache,
  ) {}

  get enabled(): boolean {
    return this.tmdb.configured;
  }

  // ---------------------------------------------------------------- search

  async searchMovieCandidates(title: string, year: number | null): Promise<ScoredCandidate[]> {
    let results = await this.tmdb.searchMovies(title, year);
    if (results.length === 0 && year) results = await this.tmdb.searchMovies(title, null);
    return rankCandidates({ title, year }, results);
  }

  async searchShowCandidates(title: string, year: number | null): Promise<ScoredCandidate[]> {
    let results = await this.tmdb.searchShows(title, year);
    if (results.length === 0 && year) results = await this.tmdb.searchShows(title, null);
    return rankCandidates({ title, year }, results);
  }

  // ---------------------------------------------------------------- movies

  /** Automatically matches a movie. With `force` an existing match is re-fetched (metadata refresh). */
  async matchMovie(movieId: number, force = false): Promise<MatchResult> {
    if (!this.enabled) return 'skipped';
    const movie = this.db.select().from(movies).where(eq(movies.id, movieId)).get();
    if (!movie) return 'skipped';
    try {
      if (movie.tmdbId && (force || movie.matchStatus === 'pending' || movie.matchStatus === 'manual' || movie.matchStatus === 'matched')) {
        await this.applyMovie(movieId, movie.tmdbId, movie.matchStatus === 'manual' ? 'manual' : 'matched', movie.matchConfidence ?? 1);
        return 'matched';
      }
      const ranked = await this.searchMovieCandidates(movie.parsedTitle, movie.parsedYear);
      const best = pickBest(ranked);
      if (!best) {
        this.db
          .update(movies)
          .set({ matchStatus: 'unmatched', matchConfidence: ranked[0]?.confidence ?? 0, metadataUpdatedAt: Date.now() })
          .where(eq(movies.id, movieId))
          .run();
        log.info(`No confident match for movie "${movie.parsedTitle}" (${movie.parsedYear ?? 'no year'}) — needs review`);
        return 'unmatched';
      }
      await this.applyMovie(movieId, best.id, 'matched', best.confidence);
      return 'matched';
    } catch (err) {
      log.warn(`Metadata lookup failed for movie "${movie.parsedTitle}"`, err);
      if (err instanceof TmdbError && err.status === 404 && movie.tmdbId) {
        this.db.update(movies).set({ tmdbId: null, matchStatus: 'pending' }).where(eq(movies.id, movieId)).run();
      }
      return 'failed';
    }
  }

  /** Fetches TMDB details for a movie and stores them. Returns the id of the movie row that holds the data. */
  async applyMovie(movieId: number, tmdbId: number, status: 'matched' | 'manual', confidence: number): Promise<number> {
    const d = await this.tmdb.movie(tmdbId);
    const current = this.db.select().from(movies).where(eq(movies.id, movieId)).get();
    if (!current) return movieId;

    // Another item in the same library already represents this TMDB movie → merge (duplicate files become versions).
    const twin = this.db
      .select({ id: movies.id })
      .from(movies)
      .where(and(eq(movies.libraryId, current.libraryId), eq(movies.tmdbId, tmdbId), ne(movies.id, movieId)))
      .get();
    let targetId = movieId;
    if (twin) {
      this.db.update(mediaFiles).set({ movieId: twin.id }).where(eq(mediaFiles.movieId, movieId)).run();
      this.db.delete(movies).where(eq(movies.id, movieId)).run();
      targetId = twin.id;
      log.info(`Merged duplicate of "${d.title}" into existing item`);
    }

    const director = d.credits?.crew?.find((c) => c.job === 'Director')?.name ?? null;
    this.db.transaction((tx) => {
      tx.update(movies)
        .set({
          tmdbId,
          imdbId: d.imdb_id ?? d.external_ids?.imdb_id ?? null,
          title: d.title || current.parsedTitle,
          sortTitle: sortTitle(d.title || current.parsedTitle),
          originalTitle: d.original_title ?? null,
          year: yearOf(d.release_date) ?? current.parsedYear,
          overview: d.overview || null,
          tagline: d.tagline || null,
          runtime: d.runtime ?? null,
          releaseDate: d.release_date || null,
          rating: d.vote_average ?? null,
          voteCount: d.vote_count ?? null,
          director,
          posterPath: d.poster_path ?? null,
          backdropPath: d.backdrop_path ?? null,
          matchStatus: status,
          matchConfidence: confidence,
          metadataUpdatedAt: Date.now(),
        })
        .where(eq(movies.id, targetId))
        .run();
      this.replaceGenres(tx as unknown as DB, 'movie', targetId, d.genres ?? []);
      this.replaceCredits(tx as unknown as DB, 'movie', targetId, d.credits?.cast ?? [], d.credits?.crew ?? []);
    });
    await this.images.prefetch([
      ['w342', d.poster_path],
      ['w1280', d.backdrop_path],
    ]);
    log.info(`Metadata updated for movie "${d.title}"`);
    return targetId;
  }

  // ---------------------------------------------------------------- shows

  async matchShow(showId: number, force = false): Promise<MatchResult> {
    if (!this.enabled) return 'skipped';
    const show = this.db.select().from(shows).where(eq(shows.id, showId)).get();
    if (!show) return 'skipped';
    try {
      if (show.tmdbId && (force || show.matchStatus !== 'unmatched')) {
        await this.applyShow(showId, show.tmdbId, show.matchStatus === 'manual' ? 'manual' : 'matched', show.matchConfidence ?? 1);
        return 'matched';
      }
      const ranked = await this.searchShowCandidates(show.parsedTitle, show.parsedYear);
      const best = pickBest(ranked);
      if (!best) {
        this.db
          .update(shows)
          .set({ matchStatus: 'unmatched', matchConfidence: ranked[0]?.confidence ?? 0, metadataUpdatedAt: Date.now() })
          .where(eq(shows.id, showId))
          .run();
        log.info(`No confident match for show "${show.parsedTitle}" — needs review`);
        return 'unmatched';
      }
      await this.applyShow(showId, best.id, 'matched', best.confidence);
      return 'matched';
    } catch (err) {
      log.warn(`Metadata lookup failed for show "${show.parsedTitle}"`, err);
      return 'failed';
    }
  }

  async applyShow(showId: number, tmdbId: number, status: 'matched' | 'manual', confidence: number): Promise<void> {
    const d = await this.tmdb.show(tmdbId);
    const current = this.db.select().from(shows).where(eq(shows.id, showId)).get();
    if (!current) return;
    this.db.transaction((tx) => {
      tx.update(shows)
        .set({
          tmdbId,
          imdbId: d.external_ids?.imdb_id ?? null,
          tvdbId: d.external_ids?.tvdb_id ?? null,
          title: d.name || current.parsedTitle,
          sortTitle: sortTitle(d.name || current.parsedTitle),
          originalTitle: d.original_name ?? null,
          year: yearOf(d.first_air_date) ?? current.parsedYear,
          overview: d.overview || null,
          firstAirDate: d.first_air_date || null,
          status: d.status ?? null,
          network: d.networks?.[0]?.name ?? null,
          rating: d.vote_average ?? null,
          voteCount: d.vote_count ?? null,
          posterPath: d.poster_path ?? null,
          backdropPath: d.backdrop_path ?? null,
          matchStatus: status,
          matchConfidence: confidence,
          metadataUpdatedAt: Date.now(),
        })
        .where(eq(shows.id, showId))
        .run();
      this.replaceGenres(tx as unknown as DB, 'show', showId, d.genres ?? []);
      this.replaceCredits(tx as unknown as DB, 'show', showId, d.credits?.cast ?? [], d.credits?.crew ?? []);
    });
    await this.images.prefetch([
      ['w342', d.poster_path],
      ['w1280', d.backdrop_path],
    ]);
    const localSeasons = this.db.select({ n: seasons.seasonNumber }).from(seasons).where(eq(seasons.showId, showId)).all();
    await this.updateSeasons(showId, tmdbId, localSeasons.map((s) => s.n), d.episode_run_time?.[0] ?? null);
    log.info(`Metadata updated for show "${d.name}"`);
  }

  /** Refreshes season + episode metadata for seasons that exist locally. */
  async updateSeasons(showId: number, tmdbId: number, seasonNumbers: number[], fallbackRuntime: number | null = null): Promise<void> {
    for (const n of seasonNumbers) {
      let s;
      try {
        s = await this.tmdb.season(tmdbId, n);
      } catch (err) {
        if (err instanceof TmdbError && err.status === 404) continue;
        log.warn(`Could not load season ${n} metadata`, err);
        continue;
      }
      const seasonRow = this.db
        .select()
        .from(seasons)
        .where(and(eq(seasons.showId, showId), eq(seasons.seasonNumber, n)))
        .get();
      if (!seasonRow) continue;
      this.db
        .update(seasons)
        .set({ name: s.name ?? null, overview: s.overview || null, airDate: s.air_date ?? null, posterPath: s.poster_path ?? null })
        .where(eq(seasons.id, seasonRow.id))
        .run();
      const localEps = this.db.select().from(episodes).where(eq(episodes.seasonId, seasonRow.id)).all();
      const stills: Array<[string, string | null]> = [];
      for (const ep of localEps) {
        const meta = s.episodes?.find((e) => e.episode_number === ep.episodeNumber);
        if (!meta) continue;
        this.db
          .update(episodes)
          .set({
            title: meta.name || ep.title,
            overview: meta.overview || null,
            airDate: meta.air_date ?? null,
            runtime: meta.runtime ?? fallbackRuntime,
            rating: meta.vote_average ?? null,
            stillPath: meta.still_path ?? null,
          })
          .where(eq(episodes.id, ep.id))
          .run();
        stills.push(['w300', meta.still_path ?? null]);
      }
      await this.images.prefetch([['w342', s.poster_path ?? null], ...stills]);
    }
  }

  /** Called by the scanner when new episodes appear for an already matched show. */
  async refreshShowSeasons(showId: number, seasonNumbers: number[]): Promise<void> {
    if (!this.enabled || seasonNumbers.length === 0) return;
    const show = this.db.select().from(shows).where(eq(shows.id, showId)).get();
    if (!show?.tmdbId || (show.matchStatus !== 'matched' && show.matchStatus !== 'manual')) return;
    await this.updateSeasons(showId, show.tmdbId, seasonNumbers);
  }

  // ---------------------------------------------------------------- helpers

  private replaceGenres(db: DB, kind: 'movie' | 'show', id: number, list: TmdbGenre[]): void {
    if (kind === 'movie') db.delete(movieGenres).where(eq(movieGenres.movieId, id)).run();
    else db.delete(showGenres).where(eq(showGenres.showId, id)).run();
    for (const g of list) {
      const row =
        db.select().from(genres).where(eq(genres.name, g.name)).get() ??
        db.insert(genres).values({ name: g.name }).returning().get();
      if (kind === 'movie') db.insert(movieGenres).values({ movieId: id, genreId: row.id }).onConflictDoNothing().run();
      else db.insert(showGenres).values({ showId: id, genreId: row.id }).onConflictDoNothing().run();
    }
  }

  private replaceCredits(db: DB, kind: 'movie' | 'show', id: number, cast: TmdbCast[], crew: TmdbCrew[]): void {
    if (kind === 'movie') db.delete(credits).where(eq(credits.movieId, id)).run();
    else db.delete(credits).where(eq(credits.showId, id)).run();
    const upsertPerson = (p: { id: number; name: string; profile_path: string | null }) =>
      db
        .insert(people)
        .values({ tmdbId: p.id, name: p.name, profilePath: p.profile_path ?? null })
        .onConflictDoUpdate({ target: people.tmdbId, set: { name: p.name, profilePath: p.profile_path ?? null } })
        .returning()
        .get();
    const topCast = [...cast].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).slice(0, MAX_CAST);
    topCast.forEach((c, i) => {
      const person = upsertPerson(c);
      db.insert(credits)
        .values({ movieId: kind === 'movie' ? id : null, showId: kind === 'show' ? id : null, personId: person.id, kind: 'cast', role: c.character ?? null, sortOrder: i })
        .run();
    });
    const keyCrew = crew.filter((c) => ['Director', 'Screenplay', 'Writer', 'Creator', 'Executive Producer'].includes(c.job)).slice(0, 8);
    keyCrew.forEach((c, i) => {
      const person = upsertPerson(c);
      db.insert(credits)
        .values({ movieId: kind === 'movie' ? id : null, showId: kind === 'show' ? id : null, personId: person.id, kind: 'crew', role: c.job, sortOrder: i })
        .run();
    });
  }

  /** Clears metadata from items and marks them for a fresh match (used by "Fix match → unmatch"). */
  resetMovies(ids: number[]): void {
    if (ids.length) this.db.update(movies).set({ tmdbId: null, matchStatus: 'pending' }).where(inArray(movies.id, ids)).run();
  }
}
