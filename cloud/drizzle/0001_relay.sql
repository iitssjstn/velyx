ALTER TABLE `servers` ADD `relay_slug` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `relay_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `servers_relay_slug_unique` ON `servers` (`relay_slug`);