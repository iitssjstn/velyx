CREATE TABLE `admin_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event` text NOT NULL,
	`params` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`read_at` integer
);
--> statement-breakpoint
CREATE INDEX `admin_notifications_created_idx` ON `admin_notifications` (`created_at`);--> statement-breakpoint
CREATE TABLE `cleanup_planned` (
	`media_file_id` integer PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`size` integer NOT NULL,
	`planned_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`due_at` integer NOT NULL,
	FOREIGN KEY (`media_file_id`) REFERENCES `media_files`(`id`) ON UPDATE no action ON DELETE cascade
);
