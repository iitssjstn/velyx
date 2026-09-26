PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_retired_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`library_id` integer,
	`group_key` text NOT NULL,
	`tmdb_id` integer,
	`season_number` integer,
	`episode_number` integer,
	`title` text NOT NULL,
	`last_file` text,
	`user_data` text NOT NULL,
	`retired_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_retired_items`("id", "kind", "library_id", "group_key", "tmdb_id", "season_number", "episode_number", "title", "last_file", "user_data", "retired_at") SELECT "id", "kind", "library_id", "group_key", "tmdb_id", "season_number", "episode_number", "title", "last_file", "user_data", "retired_at" FROM `retired_items`;--> statement-breakpoint
DROP TABLE `retired_items`;--> statement-breakpoint
ALTER TABLE `__new_retired_items` RENAME TO `retired_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `retired_group_idx` ON `retired_items` (`library_id`,`kind`,`group_key`);--> statement-breakpoint
CREATE INDEX `retired_tmdb_idx` ON `retired_items` (`library_id`,`kind`,`tmdb_id`);--> statement-breakpoint
CREATE INDEX `retired_at_idx` ON `retired_items` (`retired_at`);