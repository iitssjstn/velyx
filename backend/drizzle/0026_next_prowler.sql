CREATE TABLE `optimized_media` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_file_id` integer NOT NULL,
	`profile` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`output_path` text NOT NULL,
	`source_size` integer NOT NULL,
	`source_mtime_ms` integer NOT NULL,
	`output_size` integer,
	`probe_json` text,
	`error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`media_file_id`) REFERENCES `media_files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `optimized_media_source_profile_idx` ON `optimized_media` (`media_file_id`,`profile`);--> statement-breakpoint
CREATE INDEX `optimized_media_status_idx` ON `optimized_media` (`status`);