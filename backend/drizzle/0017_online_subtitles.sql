CREATE TABLE `online_subtitles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_file_id` integer NOT NULL,
	`provider` text DEFAULT 'opensubtitles' NOT NULL,
	`provider_file_id` integer NOT NULL,
	`language` text NOT NULL,
	`release` text,
	`hearing_impaired` integer DEFAULT false NOT NULL,
	`forced` integer DEFAULT false NOT NULL,
	`file_name` text NOT NULL,
	`created_by` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`media_file_id`) REFERENCES `media_files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `online_subtitles_media_idx` ON `online_subtitles` (`media_file_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `online_subtitles_file_idx` ON `online_subtitles` (`media_file_id`,`provider`,`provider_file_id`);