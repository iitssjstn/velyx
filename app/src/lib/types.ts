/** The parts of the Velyx API the app uses (same shapes as the website's). */

export interface User {
  id: number;
  username: string;
  displayName: string | null;
  role: 'admin' | 'user';
  language: 'en' | 'nl';
  avatarUrl: string | null;
}

export interface Progress {
  positionSec: number;
  durationSec: number;
  completed: boolean;
}

export interface MovieCard {
  type: 'movie';
  id: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  rating: number | null;
  runtime: number | null;
  progress: Progress | null;
}

export interface ShowCard {
  type: 'show';
  id: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  rating: number | null;
  seasonCount: number;
  episodeCount: number;
  watchedCount: number;
}

export type Card = MovieCard | ShowCard;

export interface ContinueItem {
  type: 'movie' | 'episode';
  id: number;
  title: string;
  subtitle: string | null;
  imagePath: string | null;
  posterPath: string | null;
  showId: number | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  upNext: boolean;
  progress: { positionSec: number; durationSec: number } | null;
  /** 0–100. */
  percent: number;
}

export interface HomeData {
  continueWatching: ContinueItem[];
  recentlyAdded: Card[];
  watchlist: Card[];
  favorites: Card[];
  movies: MovieCard[];
  shows: ShowCard[];
  counts: { movies: number; shows: number; libraries: number };
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Person {
  name: string;
  role: string | null;
}

export interface MovieDetail {
  id: number;
  type: 'movie';
  title: string;
  year: number | null;
  overview: string | null;
  tagline: string | null;
  runtime: number | null;
  rating: number | null;
  director: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  genres: { id: number; name: string }[];
  cast: Person[];
  files: { id: number; durationSec: number | null; width: number | null; height: number | null }[];
  progress: Progress | null;
  favorite: boolean;
  watchlist: boolean;
}

export interface SeasonSummary {
  id: number;
  seasonNumber: number;
  name: string;
  episodeCount: number;
  watchedCount: number;
}

export interface ShowDetail {
  id: number;
  type: 'show';
  title: string;
  year: number | null;
  overview: string | null;
  network: string | null;
  rating: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  genres: { id: number; name: string }[];
  seasons: SeasonSummary[];
  episodeCount: number;
  watchedCount: number;
  favorite: boolean;
  watchlist: boolean;
  upNext: { id: number; seasonNumber: number; episodeNumber: number; title: string | null; progress: Progress | null } | null;
}

export interface EpisodeSummary {
  id: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string | null;
  overview: string | null;
  runtime: number | null;
  stillPath: string | null;
  durationSec: number | null;
  progress: Progress | null;
}

export interface SeasonDetail {
  id: number;
  seasonNumber: number;
  name: string | null;
  episodes: EpisodeSummary[];
}

export interface SearchResults {
  query: string;
  movies: MovieCard[];
  shows: ShowCard[];
  episodes: {
    id: number;
    showId: number;
    showTitle: string;
    seasonNumber: number;
    episodeNumber: number;
    title: string | null;
    stillPath: string | null;
    progress: Progress | null;
  }[];
}
