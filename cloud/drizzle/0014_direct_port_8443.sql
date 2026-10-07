PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`secret_hash` text NOT NULL,
	`account_id` integer,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`url` text,
	`public_ip` text,
	`direct_dns_ready` integer DEFAULT false NOT NULL,
	`direct_dns_checked_at` integer,
	`direct_port` integer DEFAULT 32400 NOT NULL,
	`direct_tls_ready` integer DEFAULT false NOT NULL,
	`direct_port_open` integer DEFAULT false NOT NULL,
	`direct_port_checked_at` integer,
	`relay_slug` text,
	`relay_enabled` integer DEFAULT false NOT NULL,
	`relay_limit_mbps` integer,
	`relay_node_id` integer,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`relay_node_id`) REFERENCES `relay_nodes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_servers`("id", "secret_hash", "account_id", "name", "version", "url", "public_ip", "direct_dns_ready", "direct_dns_checked_at", "direct_port", "direct_tls_ready", "direct_port_open", "direct_port_checked_at", "relay_slug", "relay_enabled", "relay_limit_mbps", "relay_node_id", "created_at", "last_seen_at") SELECT "id", "secret_hash", "account_id", "name", "version", "url", "public_ip", "direct_dns_ready", "direct_dns_checked_at", "direct_port", "direct_tls_ready", "direct_port_open", "direct_port_checked_at", "relay_slug", "relay_enabled", "relay_limit_mbps", "relay_node_id", "created_at", "last_seen_at" FROM `servers`;--> statement-breakpoint
DROP TABLE `servers`;--> statement-breakpoint
ALTER TABLE `__new_servers` RENAME TO `servers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `servers_relay_slug_unique` ON `servers` (`relay_slug`);--> statement-breakpoint
CREATE INDEX `servers_account` ON `servers` (`account_id`);