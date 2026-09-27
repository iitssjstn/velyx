CREATE TABLE `member_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`user_ref` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`server_id` text NOT NULL,
	`user_ref` text NOT NULL,
	`account_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`server_id`, `user_ref`),
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memberships_account` ON `memberships` (`account_id`);--> statement-breakpoint
CREATE TABLE `tickets` (
	`ticket_hash` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`account_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `link_codes` ADD `user_ref` text;