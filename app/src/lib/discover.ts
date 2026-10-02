import type { MessageKey } from './i18n';

export type RequestState = 'requested' | 'approved' | 'processing' | 'partiallyAvailable' | 'available' | 'declined' | 'failed';

/** A movie or show from Seerr, and whether (and where) it is on this server already. */
export interface SeerrResult {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  year: number | null;
  overview: string;
  posterPath: string | null;
  state: RequestState | null;
  inLibrary: boolean;
  local: { type: 'movie' | 'show'; id: number } | null;
}

export interface SeerrDetails extends SeerrResult {
  genres: string[];
  runtime: number | null;
  /** Each season, with where it stands when it was requested before (older servers: no state). */
  seasons: Array<{ seasonNumber: number; episodeCount: number; state?: RequestState | null }>;
  backdropPath?: string | null;
  tagline?: string | null;
  rating?: number | null;
  cast?: Array<{ id: number; name: string; character: string | null; profilePath: string | null }>;
}

export interface DiscoverPage {
  page: number;
  totalPages: number;
  results: SeerrResult[];
}

export interface DiscoverRow {
  row: 'trending' | 'movies' | 'tv' | 'upcomingMovies' | 'upcomingTv';
  /** A TMDB genre id. */
  genre?: number;
  title: MessageKey;
  genreName?: MessageKey;
}

/** The catalog rows under the library on the home screen (the same as on the website). */
export const DISCOVER_ROWS: DiscoverRow[] = [
  { row: 'trending', title: 'discover.trending' },
  { row: 'movies', title: 'discover.popularMovies' },
  { row: 'tv', title: 'discover.popularShows' },
  { row: 'movies', genre: 28, title: 'discover.movieGenre', genreName: 'discover.genre.action' },
  { row: 'movies', genre: 35, title: 'discover.movieGenre', genreName: 'discover.genre.comedy' },
  { row: 'tv', genre: 80, title: 'discover.showGenre', genreName: 'discover.genre.crime' },
  { row: 'movies', genre: 18, title: 'discover.movieGenre', genreName: 'discover.genre.drama' },
  { row: 'movies', genre: 878, title: 'discover.movieGenre', genreName: 'discover.genre.scifi' },
  { row: 'tv', genre: 18, title: 'discover.showGenre', genreName: 'discover.genre.drama' },
  { row: 'movies', genre: 16, title: 'discover.movieGenre', genreName: 'discover.genre.animation' },
  { row: 'movies', genre: 10751, title: 'discover.movieGenre', genreName: 'discover.genre.family' },
  { row: 'tv', genre: 35, title: 'discover.showGenre', genreName: 'discover.genre.comedy' },
  { row: 'movies', genre: 53, title: 'discover.movieGenre', genreName: 'discover.genre.thriller' },
  { row: 'movies', genre: 27, title: 'discover.movieGenre', genreName: 'discover.genre.horror' },
  { row: 'tv', genre: 10765, title: 'discover.showGenre', genreName: 'discover.genre.fantasy' },
  { row: 'upcomingMovies', title: 'discover.upcomingMovies' },
  { row: 'upcomingTv', title: 'discover.upcomingShows' },
];

export function discoverPath(row: DiscoverRow, page: number): string {
  return `/api/seerr/discover?row=${row.row}${row.genre ? `&genre=${row.genre}` : ''}&page=${page}`;
}

/** All pages of a row as one list: a title that comes back on a later page is shown once. */
export function mergePages(pages: DiscoverPage[]): SeerrResult[] {
  const seen = new Set<string>();
  return pages
    .flatMap((p) => p.results)
    .filter((r) => {
      const k = `${r.mediaType}-${r.tmdbId}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/**
 * Where tapping a title goes: a movie that is here plays, a show that is here goes on with its
 * next episode (its page when there is none), anything else opens its request page.
 */
export function discoverTarget(item: Pick<SeerrResult, 'mediaType' | 'tmdbId' | 'local'>, upNextEpisodeId?: number | null): string {
  if (!item.local) return `/request/${item.mediaType}/${item.tmdbId}`;
  if (item.local.type === 'movie') return `/play/movie/${item.local.id}`;
  return upNextEpisodeId ? `/play/episode/${upNextEpisodeId}` : `/show/${item.local.id}`;
}

/** Whether a title can be requested: not here, and not requested already (or turned down / failed). */
export function canRequest(item: Pick<SeerrResult, 'inLibrary' | 'state'>): boolean {
  return !item.inLibrary && (!item.state || item.state === 'declined' || item.state === 'failed');
}

/** The seasons of a show that can still be requested (never asked for, or turned down / failed). */
export function openSeasons(d: Pick<SeerrDetails, 'seasons'>): number[] {
  return d.seasons.filter((s) => !s.state || s.state === 'declined' || s.state === 'failed').map((s) => s.seasonNumber);
}

/** Whether a title can be requested: a movie as a whole; a show while some season is still open. */
export function canRequestTitle(d: Pick<SeerrDetails, 'mediaType' | 'inLibrary' | 'state' | 'seasons'>): boolean {
  if (d.mediaType === 'movie' || d.seasons.length === 0) return canRequest(d);
  return !d.inLibrary && openSeasons(d).length > 0;
}

/** The seasons ticked after one tap: null means all of them. */
export function toggleSeason(chosen: number[] | null, all: number[], season: number, on: boolean): number[] | null {
  const now = chosen ?? all;
  const next = on ? [...new Set([...now, season])] : now.filter((n) => n !== season);
  return next.length === all.length ? null : next;
}

/** Search results from Seerr that are not in the library (those are already among the library's own results). */
export function catalogOnly(results: SeerrResult[] | undefined): SeerrResult[] {
  return (results ?? []).filter((r) => !r.inLibrary);
}
