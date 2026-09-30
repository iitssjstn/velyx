import { HttpError } from '../http-error.js';
import { createLogger } from '../logger.js';
import type { SettingsService } from './settings.js';
import type { FetchLike } from './tmdb.js';

const log = createLogger('seerr');
const TIMEOUT_MS = 8000;

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

export interface SeerrDetails extends SeerrResult {
  genres: string[];
  runtime: number | null;
  seasons: Array<{ seasonNumber: number; episodeCount: number }>;
}

interface RawMedia {
  status?: number;
  requests?: Array<{ status?: number }>;
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
    return (await res.json()) as T;
  }

  /** Checks an address and key (before saving them): Seerr's version. */
  async test(url: string, apiKey: string): Promise<{ version: string | null }> {
    const status = await this.call<{ version?: string }>('GET', '/status', undefined, { url, apiKey });
    // /status answers without a key too: ask something that needs it.
    await this.call('GET', '/request?take=1', undefined, { url, apiKey });
    return { version: status.version ?? null };
  }

  async search(query: string, page: number, language: string): Promise<{ page: number; totalPages: number; results: SeerrResult[] }> {
    const r = await this.call<{ page: number; totalPages: number; results: Array<Record<string, unknown>> }>('GET', `/search?query=${encodeURIComponent(query)}&page=${page}&language=${encodeURIComponent(language)}`);
    const results: SeerrResult[] = [];
    for (const x of r.results ?? []) {
      if (x.mediaType !== 'movie' && x.mediaType !== 'tv') continue;
      results.push({
        mediaType: x.mediaType,
        tmdbId: Number(x.id),
        title: String(x.title ?? x.name ?? ''),
        year: yearOf(x.releaseDate ?? x.firstAirDate),
        overview: String(x.overview ?? ''),
        posterPath: typeof x.posterPath === 'string' ? x.posterPath : null,
        state: mediaState(x.mediaInfo as RawMedia | undefined),
      });
    }
    return { page: r.page ?? page, totalPages: r.totalPages ?? 1, results };
  }

  async details(mediaType: 'movie' | 'tv', tmdbId: number, language: string): Promise<SeerrDetails> {
    const x = await this.call<Record<string, unknown>>('GET', `/${mediaType}/${tmdbId}?language=${encodeURIComponent(language)}`);
    const seasons = Array.isArray(x.seasons) ? (x.seasons as Array<{ seasonNumber?: number; episodeCount?: number }>) : [];
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
      seasons: seasons.filter((s) => (s.seasonNumber ?? 0) > 0).map((s) => ({ seasonNumber: Number(s.seasonNumber), episodeCount: Number(s.episodeCount ?? 0) })),
    };
  }

  /** Requests a movie, or (all or some) seasons of a show. Returns Seerr's request id and its state. */
  async request(mediaType: 'movie' | 'tv', tmdbId: number, seasons: number[] | null): Promise<{ id: number; state: RequestState }> {
    const body = mediaType === 'movie' ? { mediaType, mediaId: tmdbId } : { mediaType, mediaId: tmdbId, seasons: seasons ?? 'all' };
    const r = await this.call<{ id: number; status?: number; media?: RawMedia }>('POST', '/request', body);
    return { id: r.id, state: requestState(r.status, r.media?.status) ?? 'requested' };
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
