import { sql } from 'drizzle-orm';
import {
  sqliteTable,
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
  (t) => [index('credits_movie_idx').on(t.movieId), index('credits_show_idx').on(t.showId)],
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
    /** 'auto' collections come from TMDB (e.g. "The Matrix Collection"); 'manual' ones are made by an admin. */
    kind: text('kind', { enum: ['auto', 'manual'] }).notNull(),
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
