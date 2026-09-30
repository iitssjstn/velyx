CREATE TABLE `relay_traffic` (
	`server_id` text NOT NULL,
	`day` text NOT NULL,
	`bytes_out` integer DEFAULT 0 NOT NULL,
	`bytes_in` integer DEFAULT 0 NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`server_id`, `day`),
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `relay_traffic_day` ON `relay_traffic` (`day`);--> statement-breakpoint
ALTER TABLE `servers` ADD `relay_limit_mbps` integer;