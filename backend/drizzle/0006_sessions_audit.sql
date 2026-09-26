CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`actor_id` integer,
	`actor_name` text,
	`action` text NOT NULL,
	`target` text,
	`detail` text,
	`ip` text,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_at_idx` ON `audit_log` (`at`);--> statement-breakpoint
CREATE INDEX `audit_action_idx` ON `audit_log` (`action`,`at`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `ip` text;