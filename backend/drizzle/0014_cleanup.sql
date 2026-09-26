CREATE TABLE `cleanup_decisions` (
	`media_file_id` integer PRIMARY KEY NOT NULL,
	`size` integer NOT NULL,
	`decided_by` text NOT NULL,
	`decided_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`media_file_id`) REFERENCES `media_files`(`id`) ON UPDATE no action ON DELETE cascade
);
