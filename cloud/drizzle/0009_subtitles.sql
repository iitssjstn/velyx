CREATE TABLE `subtitle_files` (
	`file_id` integer PRIMARY KEY NOT NULL,
	`data` blob NOT NULL,
	`fetched_at` integer NOT NULL,
	`served` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subtitle_searches` (
	`key` text PRIMARY KEY NOT NULL,
	`results` text NOT NULL,
	`fetched_at` integer NOT NULL
);
