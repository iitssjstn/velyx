CREATE TABLE `invites` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`ref` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_server_ref` ON `invites` (`server_id`,`ref`);