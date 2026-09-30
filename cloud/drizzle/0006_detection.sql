CREATE TABLE `detection_prints` (
	`server_id` text NOT NULL,
	`tmdb_show` integer NOT NULL,
	`season` integer NOT NULL,
	`kind` text NOT NULL,
	`slot` integer NOT NULL,
	`words` blob NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`server_id`, `tmdb_show`, `season`, `kind`, `slot`),
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `detection_prints_season` ON `detection_prints` (`tmdb_show`,`season`);--> statement-breakpoint
CREATE TABLE `detection_reports` (
	`server_id` text NOT NULL,
	`tmdb_show` integer NOT NULL,
	`season` integer NOT NULL,
	`episode` integer NOT NULL,
	`kind` text NOT NULL,
	`duration` real NOT NULL,
	`start` real NOT NULL,
	`end` real NOT NULL,
	`source` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`server_id`, `tmdb_show`, `season`, `episode`, `kind`),
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `detection_reports_season` ON `detection_reports` (`tmdb_show`,`season`);