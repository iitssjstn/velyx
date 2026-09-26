CREATE TABLE `continue_dismissals` (
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`item_id` integer NOT NULL,
	`at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `kind`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
