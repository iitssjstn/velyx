ALTER TABLE `servers` ADD `direct_port` integer DEFAULT 32400 NOT NULL;--> statement-breakpoint
ALTER TABLE `servers` ADD `direct_tls_ready` integer DEFAULT false NOT NULL;