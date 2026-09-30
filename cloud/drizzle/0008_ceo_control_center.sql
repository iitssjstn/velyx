CREATE TABLE `ceo_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text NOT NULL,
	`detail` text
);
--> statement-breakpoint
CREATE INDEX `ceo_events_at` ON `ceo_events` (`at`);--> statement-breakpoint
CREATE TABLE `relay_samples` (
	`node_id` integer NOT NULL,
	`at` integer NOT NULL,
	`up` integer NOT NULL,
	`mbps` real,
	`peak_mbps` real,
	`clients` integer,
	`servers` integer,
	PRIMARY KEY(`node_id`, `at`),
	FOREIGN KEY (`node_id`) REFERENCES `relay_nodes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `relay_samples_at` ON `relay_samples` (`at`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `name` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `note` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `suspended_at` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `suspended_by` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `relay_node_id` integer;--> statement-breakpoint
ALTER TABLE `relay_nodes` ADD `last_check_at` integer;--> statement-breakpoint
ALTER TABLE `relay_nodes` ADD `last_seen_at` integer;