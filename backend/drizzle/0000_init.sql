CREATE TABLE `credits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`movie_id` integer,
	`show_id` integer,
	`person_id` integer NOT NULL,
	`kind` text NOT NULL,
	`role` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `credits_movie_idx` ON `credits` (`movie_id`);--> statement-breakpoint
CREATE INDEX `credits_show_idx` ON `credits` (`show_id`);--> statement-breakpoint
CREATE TABLE `episodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`show_id` integer NOT NULL,
	`season_id` integer NOT NULL,
	`season_number` integer NOT NULL,
	`episode_number` integer NOT NULL,
	`title` text,
	`overview` text,
	`air_date` text,
	`runtime` integer,
	`rating` real,
	`still_path` text,
	`added_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `episodes_show_se_idx` ON `episodes` (`show_id`,`season_number`,`episode_number`);--> statement-breakpoint
CREATE INDEX `episodes_season_idx` ON `episodes` (`season_id`);--> statement-breakpoint
CREATE INDEX `episodes_added_idx` ON `episodes` (`added_at`);--> statement-breakpoint
CREATE TABLE `favorites` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`movie_id` integer,
	`show_id` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `favorites_user_movie_idx` ON `favorites` (`user_id`,`movie_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `favorites_user_show_idx` ON `favorites` (`user_id`,`show_id`);--> statement-breakpoint
CREATE TABLE `genres` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `genres_name_unique` ON `genres` (`name`);--> statement-breakpoint
CREATE TABLE `libraries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`path` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_scan_at` integer,
	`last_scan_status` text,
	`last_scan_message` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `libraries_path_unique` ON `libraries` (`path`);--> statement-breakpoint
CREATE TABLE `media_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`library_id` integer NOT NULL,
	`movie_id` integer,
	`episode_id` integer,
	`path` text NOT NULL,
	`size` integer NOT NULL,
	`mtime_ms` integer NOT NULL,
	`container` text,
	`duration_sec` real,
	`bitrate` integer,
	`video_codec` text,
	`video_profile` text,
	`width` integer,
	`height` integer,
	`fps` real,
	`audio_codec` text,
	`audio_channels` integer,
	`audio_tracks` text,
	`subtitle_tracks` text,
	`probe_error` text,
	`added_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_files_path_unique` ON `media_files` (`path`);--> statement-breakpoint
CREATE INDEX `media_files_library_idx` ON `media_files` (`library_id`);--> statement-breakpoint
CREATE INDEX `media_files_movie_idx` ON `media_files` (`movie_id`);--> statement-breakpoint
CREATE INDEX `media_files_episode_idx` ON `media_files` (`episode_id`);--> statement-breakpoint
CREATE TABLE `movie_genres` (
	`movie_id` integer NOT NULL,
	`genre_id` integer NOT NULL,
	PRIMARY KEY(`movie_id`, `genre_id`),
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`genre_id`) REFERENCES `genres`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `movie_genres_genre_idx` ON `movie_genres` (`genre_id`);--> statement-breakpoint
CREATE TABLE `movies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`library_id` integer NOT NULL,
	`group_key` text NOT NULL,
	`tmdb_id` integer,
	`imdb_id` text,
	`title` text NOT NULL,
	`sort_title` text NOT NULL,
	`original_title` text,
	`year` integer,
	`overview` text,
	`tagline` text,
	`runtime` integer,
	`release_date` text,
	`rating` real,
	`vote_count` integer,
	`director` text,
	`poster_path` text,
	`backdrop_path` text,
	`parsed_title` text NOT NULL,
	`parsed_year` integer,
	`match_status` text DEFAULT 'pending' NOT NULL,
	`match_confidence` real,
	`metadata_updated_at` integer,
	`added_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `movies_group_idx` ON `movies` (`library_id`,`group_key`);--> statement-breakpoint
CREATE INDEX `movies_sort_idx` ON `movies` (`sort_title`);--> statement-breakpoint
CREATE INDEX `movies_added_idx` ON `movies` (`added_at`);--> statement-breakpoint
CREATE INDEX `movies_tmdb_idx` ON `movies` (`tmdb_id`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tmdb_id` integer NOT NULL,
	`name` text NOT NULL,
	`profile_path` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `people_tmdb_id_unique` ON `people` (`tmdb_id`);--> statement-breakpoint
CREATE TABLE `seasons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`show_id` integer NOT NULL,
	`season_number` integer NOT NULL,
	`name` text,
	`overview` text,
	`air_date` text,
	`poster_path` text,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seasons_show_num_idx` ON `seasons` (`show_id`,`season_number`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `show_genres` (
	`show_id` integer NOT NULL,
	`genre_id` integer NOT NULL,
	PRIMARY KEY(`show_id`, `genre_id`),
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`genre_id`) REFERENCES `genres`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `show_genres_genre_idx` ON `show_genres` (`genre_id`);--> statement-breakpoint
CREATE TABLE `shows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`library_id` integer NOT NULL,
	`group_key` text NOT NULL,
	`tmdb_id` integer,
	`imdb_id` text,
	`tvdb_id` integer,
	`title` text NOT NULL,
	`sort_title` text NOT NULL,
	`original_title` text,
	`year` integer,
	`overview` text,
	`first_air_date` text,
	`status` text,
	`network` text,
	`rating` real,
	`vote_count` integer,
	`poster_path` text,
	`backdrop_path` text,
	`parsed_title` text NOT NULL,
	`parsed_year` integer,
	`match_status` text DEFAULT 'pending' NOT NULL,
	`match_confidence` real,
	`metadata_updated_at` integer,
	`added_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_episode_added_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shows_group_idx` ON `shows` (`library_id`,`group_key`);--> statement-breakpoint
CREATE INDEX `shows_sort_idx` ON `shows` (`sort_title`);--> statement-breakpoint
CREATE INDEX `shows_added_idx` ON `shows` (`last_episode_added_at`);--> statement-breakpoint
CREATE TABLE `subtitles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_file_id` integer NOT NULL,
	`path` text NOT NULL,
	`format` text NOT NULL,
	`language` text,
	`label` text NOT NULL,
	`forced` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`media_file_id`) REFERENCES `media_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subtitles_media_idx` ON `subtitles` (`media_file_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `subtitles_path_idx` ON `subtitles` (`media_file_id`,`path`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`display_name` text,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`avatar_file` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_login_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE TABLE `watch_progress` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`movie_id` integer,
	`episode_id` integer,
	`position_sec` real DEFAULT 0 NOT NULL,
	`duration_sec` real DEFAULT 0 NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`play_count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `progress_user_movie_idx` ON `watch_progress` (`user_id`,`movie_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `progress_user_episode_idx` ON `watch_progress` (`user_id`,`episode_id`);--> statement-breakpoint
CREATE INDEX `progress_user_updated_idx` ON `watch_progress` (`user_id`,`updated_at`);