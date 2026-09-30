CREATE TABLE `segment_fingerprints` (
	`episode_id` integer PRIMARY KEY NOT NULL,
	`media_file_id` integer NOT NULL,
	`file_size` integer NOT NULL,
	`version` integer NOT NULL,
	`head` blob NOT NULL,
	`tail` blob NOT NULL,
	`tail_start` real NOT NULL,
	`full` blob,
	`extras` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `episode_segments` ADD `recap_start` real;--> statement-breakpoint
ALTER TABLE `episode_segments` ADD `recap_end` real;--> statement-breakpoint
ALTER TABLE `episode_segments` ADD `recap_confidence` text;--> statement-breakpoint
ALTER TABLE `episode_segments` ADD `recap_source` text;--> statement-breakpoint
ALTER TABLE `users` ADD `pref_skip_recap` text DEFAULT 'ask' NOT NULL;