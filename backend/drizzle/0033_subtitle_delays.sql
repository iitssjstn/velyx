CREATE TABLE `subtitle_delays` (
	`media_file_id` integer NOT NULL,
	`subtitle_key` text NOT NULL,
	`delay_sec` real NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`media_file_id`, `subtitle_key`),
	FOREIGN KEY (`media_file_id`) REFERENCES `media_files`(`id`) ON UPDATE no action ON DELETE cascade
);
