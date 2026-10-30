CREATE TABLE `detection_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tmdb_show` integer NOT NULL,
	`season` integer NOT NULL,
	`episode` integer NOT NULL,
	`kind` text NOT NULL,
	`duration` real NOT NULL,
	`start` real NOT NULL,
	`end` real NOT NULL,
	`updated_at` integer NOT NULL,
	`updated_by` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `detection_overrides_season` ON `detection_overrides` (`tmdb_show`,`season`);--> statement-breakpoint
CREATE TABLE `detection_titles` (
	`tmdb_show` integer PRIMARY KEY NOT NULL,
	`title` text,
	`fetched_at` integer NOT NULL
);
