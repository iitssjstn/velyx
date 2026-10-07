ALTER TABLE `servers` ADD `direct_port_open` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `servers` ADD `direct_port_checked_at` integer;