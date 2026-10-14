CREATE TABLE `tmdb_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`status` integer NOT NULL,
	`body` text NOT NULL,
	`fetched_at` integer NOT NULL
);
