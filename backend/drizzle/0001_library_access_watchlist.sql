CREATE TABLE `user_libraries` (
	`user_id` integer NOT NULL,
	`library_id` integer NOT NULL,
	PRIMARY KEY(`user_id`, `library_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`library_id`) REFERENCES `libraries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_libraries_library_idx` ON `user_libraries` (`library_id`);--> statement-breakpoint
CREATE TABLE `watchlist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`movie_id` integer,
	`show_id` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watchlist_user_movie_idx` ON `watchlist` (`user_id`,`movie_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `watchlist_user_show_idx` ON `watchlist` (`user_id`,`show_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `all_libraries` integer DEFAULT true NOT NULL;