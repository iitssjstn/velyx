CREATE TABLE `shared_detection_cache` (
	`tmdb_show` integer NOT NULL,
	`season` integer NOT NULL,
	`profile` text NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`tmdb_show`, `season`)
);
--> statement-breakpoint
ALTER TABLE `episode_segments` ADD `share_state` text;