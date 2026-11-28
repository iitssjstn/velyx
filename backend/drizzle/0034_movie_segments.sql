CREATE TABLE `movie_segments` (
	`movie_id` integer PRIMARY KEY NOT NULL,
	`media_file_id` integer,
	`file_size` integer,
	`credits_start` real,
	`credits_end` real,
	`credits_confidence` text,
	`credits_source` text,
	`post_credits_start` real,
	`post_credits_end` real,
	`status` text NOT NULL,
	`error` text,
	`version` integer NOT NULL,
	`detected_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_file_id`) REFERENCES `media_files`(`id`) ON UPDATE no action ON DELETE set null
);
