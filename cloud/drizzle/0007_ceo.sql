CREATE TABLE `access_grants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` integer NOT NULL,
	`type` text NOT NULL,
	`plan` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`note` text,
	`granted_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	`revoked_by` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`price_cents` integer,
	`currency` text,
	`billing_ref` text,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `access_grants_account` ON `access_grants` (`account_id`);--> statement-breakpoint
CREATE INDEX `access_grants_ends` ON `access_grants` (`ends_at`);--> statement-breakpoint
CREATE TABLE `account_activity` (
	`account_id` integer NOT NULL,
	`day` text NOT NULL,
	PRIMARY KEY(`account_id`, `day`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_activity_day` ON `account_activity` (`day`);--> statement-breakpoint
CREATE TABLE `relay_nodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`region` text,
	`url` text,
	`capacity_mbps` integer NOT NULL,
	`note` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `relay_traffic` ADD `errors` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `servers` ADD `relay_node_id` integer REFERENCES relay_nodes(id);