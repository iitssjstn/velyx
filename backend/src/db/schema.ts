import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  blob,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/sqlite-core';

const now = sql`(unixepoch() * 1000)`;

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  displayName: text('display_name'),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'user'] }).notNull().default('user'),
  disabled: integer('disabled', { mode: 'boolean' }).notNull().default(false),
  avatarFile: text('avatar_file'),
  /** When false, the user only sees the libraries listed in user_libraries. Admins always see everything. */
  allLibraries: integer('all_libraries', { mode: 'boolean' }).notNull().default(true),
  /** Playback language preferences (ISO 639-1 codes; '' = no preference). */
  prefAudioLanguage: text('pref_audio_language').notNull().default(''),
  prefSubtitleLanguage: text('pref_subtitle_language').notNull().default(''),
  prefSubtitleFallback: text('pref_subtitle_fallback').notNull().default(''),
  /** remember = reuse the last choice; always; foreign = only when the audio is in another language; forced; off. */
  prefSubtitleMode: text('pref_subtitle_mode', { enum: ['remember', 'always', 'foreign', 'forced', 'off'] }).notNull().default('remember'),
  /** Skipping detected intros / credits: never offer, offer a button (ask), or skip automatically. */
  prefSkipIntro: text('pref_skip_intro', { enum: ['never', 'ask', 'always'] }).notNull().default('ask'),
  prefSkipCredits: text('pref_skip_credits', { enum: ['never', 'ask', 'always'] }).notNull().default('ask'),
  /** Interface language (en, nl, …); independent of the audio/subtitle languages above. */
  language: text('language').notNull().default('en'),
  createdAt: integer('created_at').notNull().default(now),
  updatedAt: integer('updated_at').notNull().default(now),
  lastLoginAt: integer('last_login_at'),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(), // sha256 of the session token
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull().default(now),
    expiresAt: integer('expires_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull().default(now),
    userAgent: text('user_agent'),
    /** Client address when the session was created / last refreshed (as seen through trusted proxies). */
    ip: text('ip'),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const libraries = sqliteTable('libraries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type', { enum: ['movies', 'shows'] }).notNull(),
  path: text('path').notNull().unique(),
  createdAt: integer('created_at').notNull().default(now),
  lastScanAt: integer('last_scan_at'),
  lastScanStatus: text('last_scan_status'),
  lastScanMessage: text('last_scan_message'),
  lastScanDurationMs: integer('last_scan_duration_ms'),
  lastSuccessAt: integer('last_success_at'),
  lastFailureAt: integer('last_failure_at'),
});

export const userLibraries = sqliteTable(
  'user_libraries',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    libraryId: integer('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.libraryId] }), index('user_libraries_library_idx').on(t.libraryId)],
);

export const movies = sqliteTable(
  'movies',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    libraryId: integer('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    groupKey: text('group_key').notNull(),
    tmdbId: integer('tmdb_id'),
    imdbId: text('imdb_id'),
    title: text('title').notNull(),
    sortTitle: text('sort_title').notNull(),
    originalTitle: text('original_title'),
    year: integer('year'),
    overview: text('overview'),
    tagline: text('tagline'),
    runtime: integer('runtime'),
    releaseDate: text('release_date'),
    rating: real('rating'),
    voteCount: integer('vote_count'),
    director: text('director'),
    posterPath: text('poster_path'),
    backdropPath: text('backdrop_path'),
    parsedTitle: text('parsed_title').notNull(),
    parsedYear: integer('parsed_year'),
    matchStatus: text('match_status', { enum: ['pending', 'matched', 'unmatched', 'manual'] })
      .notNull()
      .default('pending'),
    matchConfidence: real('match_confidence'),
    metadataUpdatedAt: integer('metadata_updated_at'),
    addedAt: integer('added_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('movies_group_idx').on(t.libraryId, t.groupKey),
    index('movies_sort_idx').on(t.sortTitle),
    index('movies_added_idx').on(t.addedAt),
    index('movies_tmdb_idx').on(t.tmdbId),
    index('movies_year_idx').on(t.year),
    index('movies_rating_idx').on(t.rating),
  ],
);

export const shows = sqliteTable(
  'shows',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    libraryId: integer('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    groupKey: text('group_key').notNull(),
    tmdbId: integer('tmdb_id'),
    imdbId: text('imdb_id'),
    tvdbId: integer('tvdb_id'),
    title: text('title').notNull(),
    sortTitle: text('sort_title').notNull(),
    originalTitle: text('original_title'),
    year: integer('year'),
    overview: text('overview'),
    firstAirDate: text('first_air_date'),
    status: text('status'),
    network: text('network'),
    rating: real('rating'),
    voteCount: integer('vote_count'),
    posterPath: text('poster_path'),
    backdropPath: text('backdrop_path'),
    parsedTitle: text('parsed_title').notNull(),
    parsedYear: integer('parsed_year'),
    matchStatus: text('match_status', { enum: ['pending', 'matched', 'unmatched', 'manual'] })
      .notNull()
      .default('pending'),
    matchConfidence: real('match_confidence'),
    metadataUpdatedAt: integer('metadata_updated_at'),
    addedAt: integer('added_at').notNull().default(now),
    lastEpisodeAddedAt: integer('last_episode_added_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('shows_group_idx').on(t.libraryId, t.groupKey),
    index('shows_sort_idx').on(t.sortTitle),
    index('shows_added_idx').on(t.lastEpisodeAddedAt),
    index('shows_year_idx').on(t.year),
    index('shows_rating_idx').on(t.rating),
  ],
);

export const seasons = sqliteTable(
  'seasons',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    showId: integer('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    seasonNumber: integer('season_number').notNull(),
    name: text('name'),
    overview: text('overview'),
    airDate: text('air_date'),
    posterPath: text('poster_path'),
  },
  (t) => [uniqueIndex('seasons_show_num_idx').on(t.showId, t.seasonNumber)],
);

export const episodes = sqliteTable(
  'episodes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    showId: integer('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    seasonId: integer('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    seasonNumber: integer('season_number').notNull(),
    episodeNumber: integer('episode_number').notNull(),
    title: text('title'),
    overview: text('overview'),
    airDate: text('air_date'),
    runtime: integer('runtime'),
    rating: real('rating'),
    stillPath: text('still_path'),
    addedAt: integer('added_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('episodes_show_se_idx').on(t.showId, t.seasonNumber, t.episodeNumber),
    index('episodes_season_idx').on(t.seasonId),
    index('episodes_added_idx').on(t.addedAt),
  ],
);

export interface AudioTrackInfo {
  index: number;
  codec: string | null;
  language: string | null;
  channels: number | null;
  channelLayout: string | null;
  title: string | null;
  isDefault: boolean;
}

export interface SubtitleTrackInfo {
  index: number;
  codec: string | null;
  language: string | null;
  title: string | null;
  isDefault: boolean;
  isForced: boolean;
  textBased: boolean;
}

export const mediaFiles = sqliteTable(
  'media_files',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    libraryId: integer('library_id')
      .notNull()
      .references(() => libraries.id, { onDelete: 'cascade' }),
    movieId: integer('movie_id').references(() => movies.id, { onDelete: 'cascade' }),
    episodeId: integer('episode_id').references(() => episodes.id, { onDelete: 'cascade' }),
    path: text('path').notNull().unique(),
    size: integer('size').notNull(),
    mtimeMs: integer('mtime_ms').notNull(),
    container: text('container'),
    durationSec: real('duration_sec'),
    bitrate: integer('bitrate'),
    videoCodec: text('video_codec'),
    videoProfile: text('video_profile'),
    /** null = not analysed yet (files probed before 0.4.0). */
    videoBitDepth: integer('video_bit_depth'),
    videoRange: text('video_range', { enum: ['SDR', 'HDR10', 'HLG', 'DV'] }),
    width: integer('width'),
    height: integer('height'),
    fps: real('fps'),
    audioCodec: text('audio_codec'),
    audioChannels: integer('audio_channels'),
    audioTracks: text('audio_tracks', { mode: 'json' }).$type<AudioTrackInfo[]>(),
    subtitleTracks: text('subtitle_tracks', { mode: 'json' }).$type<SubtitleTrackInfo[]>(),
    probeError: text('probe_error'),
    addedAt: integer('added_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [
    index('media_files_library_idx').on(t.libraryId),
    index('media_files_movie_idx').on(t.movieId),
    index('media_files_episode_idx').on(t.episodeId),
  ],
);

export const subtitles = sqliteTable(
  'subtitles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    mediaFileId: integer('media_file_id')
      .notNull()
      .references(() => mediaFiles.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    format: text('format', { enum: ['srt', 'vtt'] }).notNull(),
    language: text('language'),
    label: text('label').notNull(),
    forced: integer('forced', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    index('subtitles_media_idx').on(t.mediaFileId),
    uniqueIndex('subtitles_path_idx').on(t.mediaFileId, t.path),
  ],
);

/**
 * Subtitles downloaded from OpenSubtitles for one media file. The files live in Velyx's data folder
 * (never next to the media); anyone who can see the file can use them once one person fetched them.
 */
export const onlineSubtitles = sqliteTable(
  'online_subtitles',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    mediaFileId: integer('media_file_id')
      .notNull()
      .references(() => mediaFiles.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: ['opensubtitles'] }).notNull().default('opensubtitles'),
    providerFileId: integer('provider_file_id').notNull(),
    /** Lower-case language code as the provider names it ("en", "nl", "pt-br"). */
    language: text('language').notNull(),
    release: text('release'),
    hearingImpaired: integer('hearing_impaired', { mode: 'boolean' }).notNull().default(false),
    forced: integer('forced', { mode: 'boolean' }).notNull().default(false),
    /** File name inside the online subtitles folder. */
    fileName: text('file_name').notNull(),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('online_subtitles_media_idx').on(t.mediaFileId), uniqueIndex('online_subtitles_file_idx').on(t.mediaFileId, t.provider, t.providerFileId)],
);

export const genres = sqliteTable('genres', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
});

export const movieGenres = sqliteTable(
  'movie_genres',
  {
    movieId: integer('movie_id')
      .notNull()
      .references(() => movies.id, { onDelete: 'cascade' }),
    genreId: integer('genre_id')
      .notNull()
      .references(() => genres.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.movieId, t.genreId] }), index('movie_genres_genre_idx').on(t.genreId)],
);

export const showGenres = sqliteTable(
  'show_genres',
  {
    showId: integer('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    genreId: integer('genre_id')
      .notNull()
      .references(() => genres.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.showId, t.genreId] }), index('show_genres_genre_idx').on(t.genreId)],
);

export const people = sqliteTable('people', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tmdbId: integer('tmdb_id').notNull().unique(),
  name: text('name').notNull(),
  profilePath: text('profile_path'),
});

export const credits = sqliteTable(
  'credits',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    movieId: integer('movie_id').references(() => movies.id, { onDelete: 'cascade' }),
    showId: integer('show_id').references(() => shows.id, { onDelete: 'cascade' }),
    personId: integer('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['cast', 'crew'] }).notNull(),
    role: text('role'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('credits_movie_idx').on(t.movieId), index('credits_show_idx').on(t.showId), index('credits_person_idx').on(t.personId)],
);

export const watchProgress = sqliteTable(
  'watch_progress',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    movieId: integer('movie_id').references(() => movies.id, { onDelete: 'cascade' }),
    episodeId: integer('episode_id').references(() => episodes.id, { onDelete: 'cascade' }),
    positionSec: real('position_sec').notNull().default(0),
    durationSec: real('duration_sec').notNull().default(0),
    completed: integer('completed', { mode: 'boolean' }).notNull().default(false),
    playCount: integer('play_count').notNull().default(0),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('progress_user_movie_idx').on(t.userId, t.movieId),
    uniqueIndex('progress_user_episode_idx').on(t.userId, t.episodeId),
    index('progress_user_updated_idx').on(t.userId, t.updatedAt),
  ],
);

export const favorites = sqliteTable(
  'favorites',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    movieId: integer('movie_id').references(() => movies.id, { onDelete: 'cascade' }),
    showId: integer('show_id').references(() => shows.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('favorites_user_movie_idx').on(t.userId, t.movieId),
    uniqueIndex('favorites_user_show_idx').on(t.userId, t.showId),
  ],
);

export const watchlist = sqliteTable(
  'watchlist',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    movieId: integer('movie_id').references(() => movies.id, { onDelete: 'cascade' }),
    showId: integer('show_id').references(() => shows.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('watchlist_user_movie_idx').on(t.userId, t.movieId),
    uniqueIndex('watchlist_user_show_idx').on(t.userId, t.showId),
  ],
);

export const collections = sqliteTable(
  'collections',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /**
     * 'auto' collections come from TMDB (e.g. "The Matrix Collection"); 'manual' ones are hand-picked
     * by an admin; 'smart' ones are saved filters (`rules`) evaluated for each viewer.
     */
    kind: text('kind', { enum: ['auto', 'manual', 'smart'] }).notNull(),
    /** Smart collections: JSON {"kind": "movies" | "shows", "query": {...list filters}}. */
    rules: text('rules'),
    tmdbId: integer('tmdb_id').unique(),
    name: text('name').notNull(),
    sortTitle: text('sort_title').notNull(),
    overview: text('overview'),
    posterPath: text('poster_path'),
    backdropPath: text('backdrop_path'),
    createdAt: integer('created_at').notNull().default(now),
    updatedAt: integer('updated_at').notNull().default(now),
  },
  (t) => [index('collections_sort_idx').on(t.sortTitle)],
);

export const collectionItems = sqliteTable(
  'collection_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    collectionId: integer('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    movieId: integer('movie_id').references(() => movies.id, { onDelete: 'cascade' }),
    showId: integer('show_id').references(() => shows.id, { onDelete: 'cascade' }),
    addedAt: integer('added_at').notNull().default(now),
  },
  (t) => [
    uniqueIndex('collection_items_movie_idx').on(t.collectionId, t.movieId),
    uniqueIndex('collection_items_show_idx').on(t.collectionId, t.showId),
    index('collection_items_movie_lookup_idx').on(t.movieId),
    index('collection_items_show_lookup_idx').on(t.showId),
  ],
);

/** Security-relevant and administrative actions. Never contains passwords, keys or session tokens. */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: integer('at').notNull().default(now),
    /** Who did it; null for anonymous actions such as a failed sign-in, or when the user was deleted. */
    actorId: integer('actor_id').references(() => users.id, { onDelete: 'set null' }),
    /** Username at the time (kept when the user is later deleted). */
    actorName: text('actor_name'),
    action: text('action').notNull(),
    /** Human-readable subject, e.g. a library or user name. */
    target: text('target'),
    detail: text('detail'),
    ip: text('ip'),
  },
  (t) => [index('audit_at_idx').on(t.at), index('audit_action_idx').on(t.action, t.at)],
);

/**
 * Items a user removed from Continue Watching. An item reappears as soon as there is newer
 * activity (progress saved after `at`), so dismissing never loses watch history.
 */
export const continueDismissals = sqliteTable(
  'continue_dismissals',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'movie' or 'show' (for episodes the whole show is dismissed). */
    kind: text('kind', { enum: ['movie', 'show'] }).notNull(),
    itemId: integer('item_id').notNull(),
    at: integer('at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind, t.itemId] })],
);

/** A file as it was when it was replaced or disappeared: enough to say "1080p · H.264 · WEB · 4.2 GB". */
export interface FileSnapshot {
  name: string;
  size: number;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  videoRange: string | null;
  audioCodec: string | null;
  audioChannels: number | null;
  /** Release source from the file name, e.g. "Blu-ray", "WEB", "HDTV". */
  source: string | null;
}

/** What users had for an item whose files disappeared, restored when the item comes back. */
export interface RetiredUserData {
  progress: Array<{ userId: number; positionSec: number; durationSec: number; completed: boolean; playCount: number; updatedAt: number }>;
  favorites: Array<{ userId: number; createdAt: number }>;
  watchlist: Array<{ userId: number; createdAt: number }>;
  collections: Array<{ collectionId: number; addedAt: number }>;
  dismissals: Array<{ userId: number; at: number }>;
}

/**
 * Movies, shows and episodes whose last file disappeared (removed, renamed beyond recognition, or
 * replaced by a release that arrived later). Their user data is kept here for a while so it comes
 * back when the same title reappears — for example when Radarr or Sonarr swaps in a better release.
 */
export const retiredItems = sqliteTable(
  'retired_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind', { enum: ['movie', 'show', 'episode'] }).notNull(),
    /** Where it was; null once that library was removed (its titles can still come back elsewhere). */
    libraryId: integer('library_id').references(() => libraries.id, { onDelete: 'set null' }),
    /** Movie or show group key (for episodes: the show's). */
    groupKey: text('group_key').notNull(),
    /** Movie or show TMDB id (for episodes: the show's). */
    tmdbId: integer('tmdb_id'),
    seasonNumber: integer('season_number'),
    episodeNumber: integer('episode_number'),
    title: text('title').notNull(),
    lastFile: text('last_file', { mode: 'json' }).$type<FileSnapshot>(),
    userData: text('user_data', { mode: 'json' }).$type<RetiredUserData>().notNull(),
    retiredAt: integer('retired_at').notNull().default(now),
  },
  (t) => [
    index('retired_group_idx').on(t.libraryId, t.kind, t.groupKey),
    index('retired_tmdb_idx').on(t.libraryId, t.kind, t.tmdbId),
    index('retired_at_idx').on(t.retiredAt),
  ],
);

/** A movie's or episode's file was replaced by another one (usually an upgrade). */
export const mediaReplacements = sqliteTable(
  'media_replacements',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    movieId: integer('movie_id').references(() => movies.id, { onDelete: 'cascade' }),
    episodeId: integer('episode_id').references(() => episodes.id, { onDelete: 'cascade' }),
    previous: text('previous', { mode: 'json' }).$type<FileSnapshot>().notNull(),
    current: text('current', { mode: 'json' }).$type<FileSnapshot>().notNull(),
    at: integer('at').notNull().default(now),
  },
  (t) => [index('replacements_movie_idx').on(t.movieId), index('replacements_episode_idx').on(t.episodeId), index('replacements_at_idx').on(t.at)],
);

/**
 * Detected (or manually set) intro, credits and post-credits parts of an episode. Times are in
 * seconds from the start of the file. Automatic results carry a confidence and the detector
 * version, so a better detector can redo them; manual ones are never overwritten.
 */
export const episodeSegments = sqliteTable('episode_segments', {
  episodeId: integer('episode_id')
    .primaryKey()
    .references(() => episodes.id, { onDelete: 'cascade' }),
  /** The file that was analysed; a different file (or size) means analyse again. */
  mediaFileId: integer('media_file_id').references(() => mediaFiles.id, { onDelete: 'set null' }),
  fileSize: integer('file_size'),
  introStart: real('intro_start'),
  introEnd: real('intro_end'),
  introConfidence: text('intro_confidence', { enum: ['high', 'medium', 'low'] }),
  creditsStart: real('credits_start'),
  creditsEnd: real('credits_end'),
  creditsConfidence: text('credits_confidence', { enum: ['high', 'medium', 'low'] }),
  /** Where each part was found: chapter markers, the picture, recurring audio or by hand. */
  introSource: text('intro_source', { enum: ['chapters', 'video', 'audio', 'manual'] }),
  creditsSource: text('credits_source', { enum: ['chapters', 'video', 'audio', 'manual'] }),
  postCreditsStart: real('post_credits_start'),
  postCreditsEnd: real('post_credits_end'),
  status: text('status', { enum: ['analyzed', 'error'] }).notNull(),
  error: text('error'),
  method: text('method', { enum: ['audio-fingerprint', 'automatic', 'manual'] }).notNull(),
  version: integer('version').notNull(),
  manual: integer('manual', { mode: 'boolean' }).notNull().default(false),
  detectedAt: integer('detected_at').notNull().default(now),
});

/**
 * Fingerprints of a season's confirmed intro or credits, so a newly added episode only has to be
 * compared with these instead of re-reading the whole season. A season can have several versions.
 */
export const segmentReferences = sqliteTable(
  'segment_references',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    showId: integer('show_id')
      .notNull()
      .references(() => shows.id, { onDelete: 'cascade' }),
    seasonNumber: integer('season_number').notNull(),
    kind: text('kind', { enum: ['intro', 'credits'] }).notNull(),
    words: blob('words', { mode: 'buffer' }).notNull(),
    version: integer('version').notNull(),
    createdAt: integer('created_at').notNull().default(now),
  },
  (t) => [index('segment_refs_season_idx').on(t.showId, t.seasonNumber, t.kind)],
);

/**
 * One row per viewing (a stream from start to stop): the activity log and statistics. Titles and
 * file details are copied in, so history stays readable after media or users are removed.
 */
export const playbackSessions = sqliteTable(
  'playback_sessions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    username: text('username').notNull(),
    kind: text('kind', { enum: ['movie', 'episode'] }).notNull(),
    movieId: integer('movie_id').references(() => movies.id, { onDelete: 'set null' }),
    episodeId: integer('episode_id').references(() => episodes.id, { onDelete: 'set null' }),
    showId: integer('show_id').references(() => shows.id, { onDelete: 'set null' }),
    mediaFileId: integer('media_file_id').references(() => mediaFiles.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    mode: text('mode', { enum: ['direct', 'remux'] }).notNull(),
    /** What the remux did with the audio, e.g. "AAC 5.1"; null = passed through. */
    audioConversion: text('audio_conversion'),
    container: text('container'),
    videoCodec: text('video_codec'),
    audioCodec: text('audio_codec'),
    width: integer('width'),
    height: integer('height'),
    bitrate: integer('bitrate'),
    device: text('device'),
    startedAt: integer('started_at').notNull(),
    /** Last sign of life; the session ended here when `endedAt` is set. */
    lastSeenAt: integer('last_seen_at').notNull(),
    endedAt: integer('ended_at'),
    /** Seconds actually played (pauses and seeking do not count). */
    watchedSec: integer('watched_sec').notNull().default(0),
    startPositionSec: integer('start_position_sec'),
    positionSec: integer('position_sec'),
    durationSec: integer('duration_sec'),
  },
  (t) => [index('playback_sessions_started_idx').on(t.startedAt), index('playback_sessions_user_idx').on(t.userId, t.startedAt)],
);

/**
 * Library clean-up: files an administrator chose to keep. A kept file is not suggested again until
 * it changes (another size means another file).
 */
export const cleanupDecisions = sqliteTable('cleanup_decisions', {
  mediaFileId: integer('media_file_id')
    .primaryKey()
    .references(() => mediaFiles.id, { onDelete: 'cascade' }),
  size: integer('size').notNull(),
  decidedBy: text('decided_by').notNull(),
  decidedAt: integer('decided_at').notNull().default(now),
});
