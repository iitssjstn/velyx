CREATE TABLE `episode_segments` (
	`episode_id` integer PRIMARY KEY NOT NULL,
	`media_file_id` integer,
	`file_size` integer,
	`intro_start` real,
	`intro_end` real,
	`intro_confidence` text,
	`credits_start` real,
	`credits_end` real,
	`credits_confidence` text,
	`post_credits_start` real,
	`post_credits_end` real,
	`status` text NOT NULL,
	`error` text,
	`method` text NOT NULL,
	`version` integer NOT NULL,
	`manual` integer DEFAULT false NOT NULL,
	`detected_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_file_id`) REFERENCES `media_files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `segment_references` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`show_id` integer NOT NULL,
	`season_number` integer NOT NULL,
	`kind` text NOT NULL,
	`words` blob NOT NULL,
	`version` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `segment_refs_season_idx` ON `segment_references` (`show_id`,`season_number`,`kind`);--> statement-breakpoint
ALTER TABLE `users` ADD `pref_skip_intro` text DEFAULT 'ask' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `pref_skip_credits` text DEFAULT 'ask' NOT NULL;