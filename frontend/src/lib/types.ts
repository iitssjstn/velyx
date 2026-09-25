export type Role = 'admin' | 'user';

export interface User {
  id: number;
  username: string;
  displayName: string | null;
  role: Role;
  avatarUrl: string | null;
}

export interface ServerInfo {
  name: string;
  product: string;
  tagline: string;
  version: string;
  setupRequired: boolean;
}

export interface Progress {
  positionSec: number;
  durationSec: number;
  completed: boolean;
  updatedAt?: number;
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
  overview: string | null;
  addedAt: number;
  progress: Progress | null;
  favorite: boolean;
}

export interface ShowCard {
  type: 'show';
  id: number;
  title: string;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  rating: number | null;
  overview: string | null;
  addedAt: number;
  episodeCount: number;
  watchedCount: number;
  favorite: boolean;
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
  progress: { positionSec: number; durationSec: number } | null;
  updatedAt: number;
}

export interface HomeData {
  hero: ContinueItem | null;
  continueWatching: ContinueItem[];
  recentlyAdded: Card[];
  recentlyWatched: Card[];
  movies: MovieCard[];
  shows: ShowCard[];
  favorites: Card[];
  counts: { movies: number; shows: number; libraries: number };
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Genre {
  id: number;
  name: string;
  count: number;
}

export interface Person {
  id: number;
  name: string;
  profilePath: string | null;
  role: string | null;
}

export interface AudioTrack {
  index: number;
  codec: string | null;
  language: string | null;
  languageName: string | null;
  channels: number | null;
  channelLayout: string | null;
  title: string | null;
  isDefault: boolean;
}

export interface EmbeddedSubtitle {
  index: number;
  codec: string | null;
  language: string | null;
  languageName: string | null;
  title: string | null;
  isDefault: boolean;
  isForced: boolean;
  textBased: boolean;
}

export interface MediaFileInfo {
  id: number;
  fileName: string;
  size: number;
  container: string | null;
  durationSec: number | null;
  bitrate: number | null;
  videoCodec: string | null;
  videoProfile: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  audioCodec: string | null;
  audioChannels: number | null;
  audioTracks: AudioTrack[];
  embeddedSubtitles: EmbeddedSubtitle[];
  externalSubtitles: { id: number; language: string | null; label: string; format: string; forced: boolean }[];
  probeError: string | null;
}

export interface MatchInfo {
  status: 'pending' | 'matched' | 'unmatched' | 'manual';
  confidence: number | null;
  parsedTitle: string;
  parsedYear: number | null;
}

export interface MovieDetail {
  id: number;
  type: 'movie';
  title: string;
  originalTitle: string | null;
  year: number | null;
  overview: string | null;
  tagline: string | null;
  runtime: number | null;
  releaseDate: string | null;
  rating: number | null;
  voteCount: number | null;
  director: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  tmdbId: number | null;
  imdbId: string | null;
  libraryName: string | null;
  match: MatchInfo;
  genres: { id: number; name: string }[];
  cast: Person[];
  crew: Person[];
  files: MediaFileInfo[];
  progress: Progress | null;
  favorite: boolean;
}

export interface SeasonSummary {
  id: number;
  seasonNumber: number;
  name: string;
  overview: string | null;
  airDate: string | null;
  posterPath: string | null;
  episodeCount: number;
  watchedCount: number;
}

export interface ShowDetail {
  id: number;
  type: 'show';
  title: string;
  originalTitle: string | null;
  year: number | null;
  overview: string | null;
  firstAirDate: string | null;
  status: string | null;
  network: string | null;
  rating: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  tmdbId: number | null;
  imdbId: string | null;
  match: MatchInfo;
  genres: { id: number; name: string }[];
  cast: Person[];
  crew: Person[];
  seasons: SeasonSummary[];
  episodeCount: number;
  watchedCount: number;
  upNext: { id: number; seasonNumber: number; episodeNumber: number; title: string | null; progress: Progress | null } | null;
  favorite: boolean;
}

export interface EpisodeSummary {
  id: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string | null;
  overview: string | null;
  airDate: string | null;
  runtime: number | null;
  rating: number | null;
  stillPath: string | null;
  durationSec: number | null;
  height: number | null;
  progress: Progress | null;
}

export interface SeasonDetail {
  id: number;
  seasonNumber: number;
  name: string | null;
  overview: string | null;
  posterPath: string | null;
  episodes: EpisodeSummary[];
}

export interface EpisodeDetail {
  id: number;
  type: 'episode';
  showId: number;
  showTitle: string;
  showPosterPath: string | null;
  showBackdropPath: string | null;
  seasonNumber: number;
  episodeNumber: number;
  title: string | null;
  overview: string | null;
  airDate: string | null;
  runtime: number | null;
  rating: number | null;
  stillPath: string | null;
  files: MediaFileInfo[];
  progress: Progress | null;
  next: { id: number; seasonNumber: number; episodeNumber: number; title: string | null; stillPath: string | null } | null;
  previous: { id: number; seasonNumber: number; episodeNumber: number; title: string | null } | null;
}

export interface SubtitleOption {
  key: string;
  kind: 'external' | 'embedded';
  label: string;
  language: string | null;
  forced: boolean;
  isDefault: boolean;
  url: string;
}

export interface PlaybackDecision {
  engine: 'direct' | 'remux' | string;
  streamUrl: string;
  compatible: boolean | 'unknown';
  reasons: string[];
  /** 'range' = browser seeks itself; 'restart' = live stream, request again with &start= to seek. */
  seek: 'range' | 'restart';
  audioIndex: number | null;
  note: string | null;
  durationSec: number | null;
}

export interface PlaybackInfo {
  decision: PlaybackDecision;
  file: MediaFileInfo;
  subtitles: SubtitleOption[];
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

// ---- admin

export interface ScanProgress {
  phase: 'discovering' | 'analyzing' | 'cleaning' | 'metadata' | 'done';
  processed: number;
  total: number;
}

export interface ScanState {
  running: { libraryId: number; progress: ScanProgress; startedAt: number } | null;
  queued: { libraryId: number; refreshMetadata: boolean }[];
}

export interface Library {
  id: number;
  name: string;
  type: 'movies' | 'shows';
  path: string;
  createdAt: number;
  lastScanAt: number | null;
  lastScanStatus: 'ok' | 'error' | 'running' | null;
  lastScanMessage: string | null;
  itemCount: number;
  fileCount: number;
  available: boolean;
  scanning: ScanProgress | null;
  queued: boolean;
}

export interface AdminUser extends User {
  disabled: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface Dashboard {
  version: string;
  serverName: string;
  uptimeSec: number;
  node: string;
  platform: string;
  memory: { rss: number; systemTotal: number; systemFree: number };
  loadAverage: number[];
  cpus: number;
  ffprobe: string | null;
  activeStreams: number;
  tmdb: { configured: boolean; source: 'environment' | 'settings' | 'none' };
  counts: { movies: number; shows: number; seasons: number; episodes: number; files: number; users: number; needsReview: number };
  storage: {
    mediaBytes: number;
    databaseBytes: number;
    cacheBytes: number;
    dataDisk: { total: number; free: number } | null;
    libraries: { id: number; name: string; path: string; disk: { total: number; free: number } | null }[];
  };
  lastScanAt: number | null;
  scan: ScanState;
  duplicates: { id: number; title: string; year: number | null; files: number }[];
}

export interface ServerSettings {
  serverName: string;
  serverUrl: string;
  tmdbLanguage: string;
  includeAdult: boolean;
  tmdb: { configured: boolean; source: 'environment' | 'settings' | 'none'; hint: string | null };
  version: string;
  mediaRoots: string[];
  scanIntervalMinutes: number;
}

export interface ReviewItem {
  id: number;
  type: 'movie' | 'show';
  title: string;
  parsedTitle: string;
  parsedYear: number | null;
  status: string;
  confidence: number | null;
  samplePath: string | null;
}

export interface MatchCandidate {
  id: number;
  title: string;
  originalTitle: string | null;
  year: number | null;
  overview: string | null;
  posterPath: string | null;
  popularity: number;
  confidence: number;
}

export interface LogEntry {
  time: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  module: string;
  message: string;
  stack?: string;
}
