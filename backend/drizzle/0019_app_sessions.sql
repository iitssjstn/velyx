ALTER TABLE `sessions` ADD `client` text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `device_name` text;