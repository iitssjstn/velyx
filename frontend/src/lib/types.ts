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
  /** Up to two genres. */
  genres: string[];
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
  genres: string[];
  addedAt: number;
  seasonCount: number;
  episodeCount: number;
  watchedCount: number;
  favorite: boolean;
}

export type Card = MovieCard | ShowCard;

export interface CollectionRef {
  id: number;
  name: string;
  kind: 'auto' | 'manual';
}

export interface CollectionSummary extends CollectionRef {
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  itemCount: number;
}

export interface SmartCollection {
  key: string;
  id: number | null;
  name: string;
  kind: 'movies' | 'shows';
  query: Record<string, string>;
  custom: boolean;
  count: number;
  posterPath: string | null;
  backdropPath: string | null;
}

export interface CollectionDetail extends CollectionSummary {
  items: Card[];
}

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
  watchlist: Card[];
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
  videoBitDepth: number | null;
  videoRange: string | null;
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
  watchlist: boolean;
  collections: CollectionRef[];
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
  watchlist: boolean;
  collections: CollectionRef[];
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
  mode: PlaybackMode;
}

export type PlaybackMode = 'direct' | 'remux' | 'unsupported';

/** Why and how a file plays (or does not) on this device; see backend playback/compatibility.ts. */
export interface PlaybackAnalysis {
  mode: PlaybackMode;
  browser: string | null;
  video: { codec: string | null; label: string; width: number | null; height: number | null; bitDepth: number | null; range: string | null; action: 'direct' | 'copy' | 'unsupported' };
  audio: { codec: string | null; label: string; channels: number | null; action: 'direct' | 'copy' | 'convert' | 'none'; target: string | null };
  container: { name: string | null; action: 'direct' | 'remux' };
  problems: string[];
  warnings: string[];
  transcodeRequired: boolean;
  serverTranscoding: false;
  serverLoad: 'none' | 'low';
  /** "Chrome on Windows"; null when unknown. */
  device: string | null;
  /** reported = the device listed its formats; profile/assumed = Velyx estimated them. */
  confidence: 'reported' | 'profile' | 'assumed';
  components: Record<'video' | 'audio' | 'container', { status: ComponentStatus; note: string }>;
  summary: string[];
}

export type ComponentStatus = 'ok' | 'warn' | 'fail' | 'unknown';

export interface DeviceFormat {
  key: string;
  kind: 'video' | 'audio' | 'container' | 'display';
  label: string;
  support: 'yes' | 'no' | 'converted' | 'depends';
  note: string | null;
}

export interface DeviceReport {
  device: string;
  family: string;
  confidence: 'reported' | 'profile' | 'assumed';
  formats: DeviceFormat[];
}

export interface SessionInfo {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  userAgent: string | null;
  device: string;
  ip: string | null;
  current: boolean;
}

export interface AuditEntry {
  id: number;
  at: number;
  actorId: number | null;
  actorName: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
}

export interface BackupFile {
  name: string;
  kind: 'auto' | 'manual' | 'archive' | 'pre-migration' | 'pre-restore';
  size: number;
  createdAt: number;
}

export interface BackupOverview {
  backups: BackupFile[];
  schedule: { schedule: 'daily' | 'weekly' | 'off'; hour: number; keepDaily: number; keepWeekly: number; keepMonthly: number };
  nextDue: number | null;
  pendingRestore: { source: string; requestedBy: string; requestedAt: number } | null;
  folder: string;
}

export interface BackupVerification {
  ok: boolean;
  errors: string[];
  info: { size: number; migrations: number | null; users: number | null; movies: number | null; shows: number | null } | null;
}

export interface PlaybackInfo {
  decision: PlaybackDecision;
  analysis: PlaybackAnalysis;
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
  currentFile?: string | null;
}

export interface ScanState {
  status: 'scanning' | 'queued' | 'paused' | 'failed' | 'idle';
  running: { libraryId: number; progress: ScanProgress; startedAt: number } | null;
  queued: { libraryId: number; refreshMetadata: boolean; full: boolean }[];
  paused: { reason: 'manual' | 'low-disk'; since: number } | null;
  lastSuccess: { libraryId: number; at: number; durationMs: number | null } | null;
  lastFailure: { libraryId: number; at: number; message: string | null } | null;
  schedule: { intervalMinutes: number; nextAt: number | null; waitingForPlayback: boolean };
}

export type DiskLevel = 'ok' | 'low' | 'critical';

export interface DiskInfo {
  total: number;
  free: number;
  used: number;
  level: DiskLevel;
}

export interface ActiveStream {
  id: string;
  userId: number;
  username: string;
  mediaFileId: number;
  movieId: number | null;
  episodeId: number | null;
  title: string;
  subtitle: string | null;
  mode: 'direct' | 'remux';
  width: number | null;
  height: number | null;
  bitrate: number | null;
  device: string | null;
  startedAt: number;
  lastSeenAt: number;
  positionSec: number | null;
  durationSec: number | null;
}

export interface CacheInfo {
  bytes: number;
  files: number;
  unusedBytes: number;
  unusedFiles: number;
}

export interface StorageReport {
  disk: DiskInfo | null;
  velyx: { database: number; artwork: number; subtitles: number; avatars: number; backups: number; total: number };
  cache: { artwork: CacheInfo; subtitles: CacheInfo };
  thresholds: { lowBytes: number; criticalBytes: number };
  computedAt: number;
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
  /** Folder watching: new files are picked up automatically. */
  watching: boolean;
  watchError: string | null;
}

export interface AdminUser extends User {
  disabled: boolean;
  createdAt: number;
  lastLoginAt: number | null;
  /** Libraries this user may see; null = all libraries, including ones added later. */
  libraryIds: number[] | null;
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
  cpu: { system: number | null; velyx: number | null };
  streams: ActiveStream[];
  disk: DiskInfo | null;
  backups: { latest: BackupFile | null; nextDue: number | null };
  probeQueue: { active: number; waiting: number };
  update: { current: string; latest: string | null; available: boolean; url: string | null; checkedAt: number | null };
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
  watchFolders: boolean;
  updateCheck: boolean;
  tmdb: { configured: boolean; source: 'environment' | 'settings' | 'none'; hint: string | null };
  version: string;
  mediaRoots: string[];
  /** Effective minutes between automatic scans (0 = off). */
  scanIntervalMinutes: number;
  /** settings = chosen here; environment = SCAN_INTERVAL_MINUTES. */
  scanIntervalSource: 'settings' | 'environment';
  /** SCAN_INTERVAL_MINUTES, used when no interval is chosen here. */
  scanIntervalDefault: number;
  scanOnStartup: boolean;
  deferScansWhilePlaying: boolean;
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
