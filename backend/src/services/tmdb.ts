import { createLogger } from '../logger.js';

const log = createLogger('tmdb');
const API_BASE = 'https://api.themoviedb.org/3';

export class TmdbError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'TmdbError';
  }
}

export interface TmdbSearchResult {
  id: number;
  title: string;
  originalTitle: string | null;
  year: number | null;
  overview: string | null;
  posterPath: string | null;
  popularity: number;
}

export interface TmdbGenre {
  id: number;
  name: string;
}
export interface TmdbCast {
  id: number;
  name: string;
  character: string | null;
  profile_path: string | null;
  order?: number;
}
export interface TmdbCrew {
  id: number;
  name: string;
  job: string;
  profile_path: string | null;
}

export interface TmdbMovieDetails {
  id: number;
  title: string;
  original_title?: string;
  overview?: string;
  tagline?: string;
  runtime?: number | null;
  release_date?: string;
  vote_average?: number;
  vote_count?: number;
  poster_path?: string | null;
  backdrop_path?: string | null;
  imdb_id?: string | null;
  genres?: TmdbGenre[];
  credits?: { cast?: TmdbCast[]; crew?: TmdbCrew[] };
  external_ids?: { imdb_id?: string | null };
}

export interface TmdbTvDetails {
  id: number;
  name: string;
  original_name?: string;
  overview?: string;
  first_air_date?: string;
  status?: string;
  vote_average?: number;
  vote_count?: number;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genres?: TmdbGenre[];
  networks?: { name: string }[];
  episode_run_time?: number[];
  credits?: { cast?: TmdbCast[]; crew?: TmdbCrew[] };
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | null };
  seasons?: { season_number: number; name?: string; overview?: string; air_date?: string; poster_path?: string | null }[];
}

export interface TmdbSeasonDetails {
  season_number: number;
  name?: string;
  overview?: string;
  air_date?: string;
  poster_path?: string | null;
  episodes?: {
    episode_number: number;
    season_number: number;
    name?: string;
    overview?: string;
    air_date?: string;
    runtime?: number | null;
    vote_average?: number;
    still_path?: string | null;
  }[];
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TmdbClientOptions {
  getApiKey: () => string;
  getLanguage: () => string;
  getIncludeAdult?: () => boolean;
  fetchImpl?: FetchLike;
  minIntervalMs?: number;
}

function yearOf(date: string | undefined | null): number | null {
  if (!date) return null;
  const y = Number.parseInt(date.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

export class TmdbClient {
  private readonly fetchImpl: FetchLike;
  private chain: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(private readonly opts: TmdbClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((i, init) => fetch(i, init));
  }

  get configured(): boolean {
    return this.opts.getApiKey().length > 0;
  }

  /** Requests are serialized and spaced out so we stay well below TMDB's rate limits. */
  private schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      const wait = (this.opts.minIntervalMs ?? 40) - (Date.now() - this.lastRequestAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastRequestAt = Date.now();
      return fn();
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async request<T>(pathname: string, params: Record<string, string | number | undefined> = {}, apiKeyOverride?: string): Promise<T> {
    const key = apiKeyOverride ?? this.opts.getApiKey();
    if (!key) throw new TmdbError('TMDB API key is not configured', null);
    const url = new URL(API_BASE + pathname);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { Accept: 'application/json' };
    // v4 "API Read Access Tokens" are JWTs; v3 keys are 32-char hex strings.
    if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
    else url.searchParams.set('api_key', key);

    for (let attempt = 0; attempt < 4; attempt++) {
      let res: Response;
      try {
        res = await this.schedule(() => this.fetchImpl(url.toString(), { headers, signal: AbortSignal.timeout(15000) }));
      } catch (err) {
        if (attempt === 3) throw new TmdbError(`TMDB unreachable: ${(err as Error).message}`, null);
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after')) || attempt + 1;
        if (attempt === 3) throw new TmdbError(`TMDB returned ${res.status}`, res.status);
        log.debug(`TMDB ${res.status}, retrying in ${retryAfter}s`);
        await new Promise((r) => setTimeout(r, Math.min(retryAfter, 10) * 1000));
        continue;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { status_message?: string };
        throw new TmdbError(body.status_message ?? `TMDB returned ${res.status}`, res.status);
      }
      return (await res.json()) as T;
    }
    throw new TmdbError('TMDB request failed', null);
  }

  async validateKey(key: string): Promise<boolean> {
    try {
      await this.request('/configuration', {}, key);
      return true;
    } catch (err) {
      if (err instanceof TmdbError && (err.status === 401 || err.status === 403)) return false;
      throw err;
    }
  }

  async searchMovies(query: string, year?: number | null): Promise<TmdbSearchResult[]> {
    const data = await this.request<{ results: Array<Record<string, unknown>> }>('/search/movie', {
      query,
      year: year ?? undefined,
      include_adult: this.opts.getIncludeAdult?.() ? 'true' : 'false',
      language: this.opts.getLanguage(),
    });
    return (data.results ?? []).map((r) => ({
      id: r.id as number,
      title: (r.title as string) ?? '',
      originalTitle: (r.original_title as string) ?? null,
      year: yearOf(r.release_date as string),
      overview: (r.overview as string) || null,
      posterPath: (r.poster_path as string) ?? null,
      popularity: (r.popularity as number) ?? 0,
    }));
  }

  async searchShows(query: string, year?: number | null): Promise<TmdbSearchResult[]> {
    const data = await this.request<{ results: Array<Record<string, unknown>> }>('/search/tv', {
      query,
      first_air_date_year: year ?? undefined,
      include_adult: this.opts.getIncludeAdult?.() ? 'true' : 'false',
      language: this.opts.getLanguage(),
    });
    return (data.results ?? []).map((r) => ({
      id: r.id as number,
      title: (r.name as string) ?? '',
      originalTitle: (r.original_name as string) ?? null,
      year: yearOf(r.first_air_date as string),
      overview: (r.overview as string) || null,
      posterPath: (r.poster_path as string) ?? null,
      popularity: (r.popularity as number) ?? 0,
    }));
  }

  movie(id: number): Promise<TmdbMovieDetails> {
    return this.request(`/movie/${id}`, { append_to_response: 'credits,external_ids', language: this.opts.getLanguage() });
  }

  show(id: number): Promise<TmdbTvDetails> {
    return this.request(`/tv/${id}`, { append_to_response: 'credits,external_ids', language: this.opts.getLanguage() });
  }

  season(showId: number, seasonNumber: number): Promise<TmdbSeasonDetails> {
    return this.request(`/tv/${showId}/season/${seasonNumber}`, { language: this.opts.getLanguage() });
  }
}

export { yearOf };
