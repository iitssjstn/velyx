CREATE TABLE `media_replacements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`movie_id` integer,
	`episode_id` integer,
	`previous` text NOT NULL,
	`current` text NOT NULL,
	`at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `replacements_movie_idx` ON `media_replacements` (`movie_id`);--> statement-breakpoint
CREATE INDEX `replacements_episode_idx` ON `media_replacements` (`episode_id`);--> statement-breakpoint
CREATE INDEX `replacements_at_idx` ON `media_replacements` (`at`);--> statement-breakpoint
CREATE TABLE `retired_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`library_id` integer NOT NULL,
	`group_key` text NOT NULL,
	`tmdb_id` integer,
	`season_number` integer,
	`episode_number` integer,
	`title` text NOT NULL,
	`last_file` text,
	`user_data` text NOT NULL,
	`retired_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `retired_group_idx` ON `retired_items` (`library_id`,`kind`,`group_key`);--> statement-breakpoint
CREATE INDEX `retired_tmdb_idx` ON `retired_items` (`library_id`,`kind`,`tmdb_id`);--> statement-breakpoint
CREATE INDEX `retired_at_idx` ON `retired_items` (`retired_at`);