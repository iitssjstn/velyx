import { HttpError } from '../http-error.js';
import { createLogger } from '../logger.js';
import type { SettingsService } from './settings.js';
import type { FetchLike } from './tmdb.js';

const log = createLogger('seerr');
const TIMEOUT_MS = 8000;
/** How long a catalog row is kept before Seerr is asked again. */
const DISCOVER_FRESH_MS = 30 * 60_000;
/** Rows scroll on, but not without end. */
const MAX_PAGES = 20;

/** Where a request stands, as Vidalune shows it. */
export type RequestState = 'requested' | 'approved' | 'processing' | 'available' | 'partiallyAvailable' | 'declined' | 'failed';

export interface SeerrResult {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  year: number | null;
  overview: string;
  posterPath: string | null;
  /** What Seerr knows of it: already requested, being downloaded, available (null: nothing yet). */
  state: RequestState | null;
}

export interface SeerrPage {
  page: number;
  totalPages: number;
  results: SeerrResult[];
}

/** The rows of the catalog: trending, popular movies/shows (optionally one genre), coming soon. */
export interface DiscoverRow {
  kind: 'trending' | 'movies' | 'tv' | 'upcomingMovies' | 'upcomingTv';
  /** A TMDB genre id (movies and tv only). */
  genre?: number;
}

export interface SeerrDetails extends SeerrResult {
  genres: string[];
  runtime: number | null;
  /** Each season, with where it stands when (part of) the show was requested before. */
  seasons: Array<{ seasonNumber: number; episodeCount: number; name: string | null; state: RequestState | null }>;
  backdropPath: string | null;
  tagline: string | null;
  /** TMDB's rating (0–10), null when there are too few votes. */
  rating: number | null;
  releaseDate: string | null;
  cast: Array<{ id: number; name: string; character: string | null; profilePath: string | null }>;
}

interface RawMedia {
  id?: number;
  status?: number;
  requests?: Array<{ id?: number; status?: number }>;
  seasons?: Array<{ seasonNumber?: number; status?: number }>;
}

/**
 * Seerr's numbers: a request is 1 pending approval, 2 approved, 3 declined (newer: 4 failed,
 * 5 completed); its media is 2 pending, 3 processing, 4 partially available, 5 available.
 */
export function requestState(requestStatus: number | undefined, mediaStatus: number | undefined): RequestState | null {
  if (mediaStatus === 5) return 'available';
  if (mediaStatus === 4) return 'partiallyAvailable';
  if (requestStatus === 3) return 'declined';
  if (requestStatus === 4) return 'failed';
  if (mediaStatus === 3) return 'processing';
  if (requestStatus === 2 || requestStatus === 5) return 'approved';
  if (requestStatus === 1 || mediaStatus === 2) return 'requested';
  return null;
}

const yearOf = (d: unknown) => (typeof d === 'string' && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null);

function mediaState(media: RawMedia | undefined): RequestState | null {
  if (!media) return null;
  const last = media.requests?.[media.requests.length - 1];
  return requestState(last?.status, media.status);
}

/**
 * The optional connection to Seerr (Admin → Server): people search for movies and shows that are
 * not in the library and request them. The API key stays on this server; the browser and the app
 * only talk to Vidalune. Without it configured, nothing here is used and nothing is contacted.
 */
export class SeerrService {
  constructor(
    private readonly deps: { settings: SettingsService; fetchImpl?: FetchLike },
  ) {}

  configured(): boolean {
    const s = this.deps.settings.get().seerr;
    return !!(s.url && s.apiKey);
  }

  private async call<T>(method: string, path: string, body?: unknown, override?: { url: string; apiKey: string }): Promise<T> {
    const s = override ?? this.deps.settings.get().seerr;
    if (!s.url || !s.apiKey) throw new HttpError(409, 'Seerr is not set up on this server.');
    let res: Response;
    try {
      res = await (this.deps.fetchImpl ?? fetch)(`${s.url}/api/v1${path}`, {
        method,
        headers: { 'X-Api-Key': s.apiKey, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const timeout = (err as Error).name === 'TimeoutError';
      log.warn(`Seerr not reachable: ${(err as Error).message}`);
      throw new HttpError(502, timeout ? 'Seerr did not answer in time. Try again later.' : 'Could not reach Seerr. Check its address.');
    }
    if (res.status === 401 || res.status === 403) throw new HttpError(502, 'Seerr refused the API key. Check it under Admin → Server.');
    if (res.status === 404) throw new HttpError(404, 'Seerr does not know this title.');
    if (res.status === 409) throw new HttpError(409, 'This has already been requested.');
    if (!res.ok) {
      log.warn(`Seerr answered ${res.status} to ${method} ${path}`);
      throw new HttpError(502, 'Seerr could not handle the request. Try again later.');
    }
    // DELETE answers 204 without a body.
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /** Checks an address and key (before saving them): Seerr's version. */
  async test(url: string, apiKey: string): Promise<{ version: string | null }> {
    const status = await this.call<{ version?: string }>('GET', '/status', undefined, { url, apiKey });
    // /status answers without a key too: ask something that needs it.
    await this.call('GET', '/request?take=1', undefined, { url, apiKey });
    return { version: status.version ?? null };
  }

  async search(query: string, page: number, language: string): Promise<SeerrPage> {
    return this.list(`/search?query=${encodeURIComponent(query)}&page=${page}&language=${encodeURIComponent(language)}`, page);
  }

  /**
   * One row of the catalog (trending, popular, upcoming, a genre), one page at a time. Rows are
   * the same for everyone, so they are kept for a while: opening the home screen does not ask
   * Seerr again every time.
   */
  async discover(row: DiscoverRow, page: number, language: string): Promise<SeerrPage> {
    const key = `${this.deps.settings.get().seerr.url}|${row.kind}|${row.genre ?? ''}|${page}|${language}`;
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && hit.until > now) return hit.page;
    const q = `page=${page}&language=${encodeURIComponent(language)}`;
    const path = {
      trending: `/discover/trending?${q}`,
      movies: row.genre ? `/discover/movies/genre/${row.genre}?${q}` : `/discover/movies?${q}`,
      tv: row.genre ? `/discover/tv/genre/${row.genre}?${q}` : `/discover/tv?${q}`,
      upcomingMovies: `/discover/movies/upcoming?${q}`,
      upcomingTv: `/discover/tv/upcoming?${q}`,
    }[row.kind];
    const fallback = row.kind === 'movies' || row.kind === 'upcomingMovies' ? 'movie' : row.kind === 'tv' || row.kind === 'upcomingTv' ? 'tv' : undefined;
    const result = await this.list(path, page, fallback);
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(key, { until: now + DISCOVER_FRESH_MS, page: result });
    return result;
  }

  private readonly cache = new Map<string, { until: number; page: SeerrPage }>();

  /** A page of titles (people and anything else are left out). */
  private async list(path: string, page: number, mediaType?: 'movie' | 'tv'): Promise<SeerrPage> {
    const r = await this.call<{ page?: number; totalPages?: number; results?: Array<Record<string, unknown>> }>('GET', path);
    const results: SeerrResult[] = [];
    for (const x of r.results ?? []) {
      const type = x.mediaType ?? mediaType;
      if (type !== 'movie' && type !== 'tv') continue;
      results.push({
        mediaType: type,
        tmdbId: Number(x.id),
        title: String(x.title ?? x.name ?? ''),
        year: yearOf(x.releaseDate ?? x.firstAirDate),
        overview: String(x.overview ?? ''),
        posterPath: typeof x.posterPath === 'string' ? x.posterPath : null,
        state: mediaState(x.mediaInfo as RawMedia | undefined),
      });
    }
    return { page: r.page ?? page, totalPages: Math.min(r.totalPages ?? 1, MAX_PAGES), results };
  }

  async details(mediaType: 'movie' | 'tv', tmdbId: number, language: string): Promise<SeerrDetails> {
    const x = await this.call<Record<string, unknown>>('GET', `/${mediaType}/${tmdbId}?language=${encodeURIComponent(language)}`);
    const seasons = Array.isArray(x.seasons) ? (x.seasons as Array<{ seasonNumber?: number; episodeCount?: number; name?: string }>) : [];
    const media = x.mediaInfo as RawMedia | undefined;
    const seasonState = (n: number): RequestState | null => {
      const st = media?.seasons?.find((m) => m.seasonNumber === n)?.status;
      // Seasons carry the media numbers: 2 pending, 3 processing, 4 partly, 5 available.
      return st === 5 ? 'available' : st === 4 ? 'partiallyAvailable' : st === 3 ? 'processing' : st === 2 ? 'requested' : null;
    };
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
    const credits = (x.credits as { cast?: Array<Record<string, unknown>> } | undefined)?.cast ?? [];
    const votes = typeof x.voteCount === 'number' ? x.voteCount : 0;
    return {
      mediaType,
      tmdbId,
      title: String(x.title ?? x.name ?? ''),
      year: yearOf(x.releaseDate ?? x.firstAirDate),
      overview: String(x.overview ?? ''),
      posterPath: typeof x.posterPath === 'string' ? x.posterPath : null,
      state: mediaState(x.mediaInfo as RawMedia | undefined),
      genres: Array.isArray(x.genres) ? (x.genres as Array<{ name?: string }>).map((g) => String(g.name ?? '')).filter(Boolean) : [],
      runtime: typeof x.runtime === 'number' ? x.runtime : null,
      seasons: seasons.filter((s) => (s.seasonNumber ?? 0) > 0).map((s) => ({ seasonNumber: Number(s.seasonNumber), episodeCount: Number(s.episodeCount ?? 0), name: str(s.name), state: seasonState(Number(s.seasonNumber)) })),
      backdropPath: str(x.backdropPath),
      tagline: str(x.tagline),
      rating: typeof x.voteAverage === 'number' && x.voteAverage > 0 && votes >= 10 ? Math.round(x.voteAverage * 10) / 10 : null,
      releaseDate: str(x.releaseDate) ?? str(x.firstAirDate),
      cast: credits.slice(0, 20).map((c) => ({ id: Number(c.id), name: String(c.name ?? ''), character: str(c.character), profilePath: str(c.profilePath) })).filter((c) => c.name),
    };
  }

  /** Titles like this one (TMDB's recommendations, through Seerr). */
  async recommendations(mediaType: 'movie' | 'tv', tmdbId: number, language: string): Promise<SeerrPage> {
    return this.list(`/${mediaType}/${tmdbId}/recommendations?page=1&language=${encodeURIComponent(language)}`, 1, mediaType);
  }

  /** Seerr's own record of a title: its id there, where it stands, and its requests (null: none). */
  private async media(mediaType: 'movie' | 'tv', tmdbId: number): Promise<RawMedia | null> {
    const x = await this.call<{ mediaInfo?: RawMedia }>('GET', `/${mediaType}/${tmdbId}`);
    return x.mediaInfo ?? null;
  }

  /**
   * Makes a title requestable again after its requests were cancelled: Seerr keeps it marked as
   * requested or being added until its record is removed. Only when no request is left and nothing
   * of it is available (what is in the library is never touched). True when it was reset.
   */
  async resetIfUnrequested(mediaType: 'movie' | 'tv', tmdbId: number): Promise<boolean> {
    const media = await this.media(mediaType, tmdbId);
    if (!media?.id || media.status === 4 || media.status === 5 || (media.requests?.length ?? 0) > 0) return false;
    await this.removeMedia(media.id);
    return true;
  }

  /**
   * Cancels every request for a title and makes it requestable again (administrators). Refused
   * when (part of) it is already available: that is removed in the library, not here.
   */
  async reset(mediaType: 'movie' | 'tv', tmdbId: number): Promise<{ requests: number }> {
    const media = await this.media(mediaType, tmdbId);
    if (!media?.id) return { requests: 0 };
    if (media.status === 4 || media.status === 5) throw new HttpError(409, 'This is (partly) available already; it stays.');
    let n = 0;
    for (const r of media.requests ?? []) if (r.id && (await this.cancel(r.id))) n++;
    await this.removeMedia(media.id);
    return { requests: n };
  }

  private async removeMedia(mediaId: number): Promise<void> {
    try {
      await this.call('DELETE', `/media/${mediaId}`);
    } catch (err) {
      if (!(err instanceof HttpError && err.statusCode === 404)) throw err;
    }
    this.forget();
  }

  /** Something was requested or cancelled: the catalog rows show it at once, not in half an hour. */
  forget(): void {
    this.cache.clear();
  }

  /** Requests a movie, or (all or some) seasons of a show. Returns Seerr's request id and its state. */
  async request(mediaType: 'movie' | 'tv', tmdbId: number, seasons: number[] | null): Promise<{ id: number; state: RequestState }> {
    const body = mediaType === 'movie' ? { mediaType, mediaId: tmdbId } : { mediaType, mediaId: tmdbId, seasons: seasons ?? 'all' };
    const r = await this.call<{ id: number; status?: number; media?: RawMedia }>('POST', '/request', body);
    this.forget();
    return { id: r.id, state: requestState(r.status, r.media?.status) ?? 'requested' };
  }

  /** Removes a request in Seerr (true: removed, false: Seerr no longer had it). Media already added stays. */
  async cancel(id: number): Promise<boolean> {
    try {
      await this.call('DELETE', `/request/${id}`);
      this.forget();
      return true;
    } catch (err) {
      if (err instanceof HttpError && err.statusCode === 404) return false;
      throw err;
    }
  }

  /** Where a request stands now (null: Seerr no longer has it). */
  async requestStatus(id: number): Promise<RequestState | null> {
    try {
      const r = await this.call<{ status?: number; media?: RawMedia }>('GET', `/request/${id}`);
      return requestState(r.status, r.media?.status);
    } catch (err) {
      if (err instanceof HttpError && err.statusCode === 404) return null;
      throw err;
    }
  }
}
