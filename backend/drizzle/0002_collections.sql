CREATE TABLE `collection_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`collection_id` integer NOT NULL,
	`movie_id` integer,
	`show_id` integer,
	`added_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_items_movie_idx` ON `collection_items` (`collection_id`,`movie_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `collection_items_show_idx` ON `collection_items` (`collection_id`,`show_id`);--> statement-breakpoint
CREATE INDEX `collection_items_movie_lookup_idx` ON `collection_items` (`movie_id`);--> statement-breakpoint
CREATE INDEX `collection_items_show_lookup_idx` ON `collection_items` (`show_id`);--> statement-breakpoint
CREATE TABLE `collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`tmdb_id` integer,
	`name` text NOT NULL,
	`sort_title` text NOT NULL,
	`overview` text,
	`poster_path` text,
	`backdrop_path` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_tmdb_id_unique` ON `collections` (`tmdb_id`);--> statement-breakpoint
CREATE INDEX `collections_sort_idx` ON `collections` (`sort_title`);