ALTER TABLE `servers` ADD `public_ip` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `direct_dns_ready` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `servers` ADD `direct_dns_checked_at` integer;