CREATE TABLE `detection_complaints` (
	`server_id` text NOT NULL,
	`tmdb_show` integer NOT NULL,
	`season` integer NOT NULL,
	`episode` integer NOT NULL,
	`duration` real NOT NULL,
	`kind` text NOT NULL,
	`problem` text NOT NULL,
	`count` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `detection_complaints_season` ON `detection_complaints` (`tmdb_show`,`season`);--> statement-breakpoint
CREATE INDEX `detection_complaints_server` ON `detection_complaints` (`server_id`,`tmdb_show`,`season`);