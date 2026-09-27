ALTER TABLE `accounts` ADD `plan` text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE `accounts` ADD `plan_until` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `plan_note` text;--> statement-breakpoint
ALTER TABLE `accounts` ADD `plan_changed_at` integer;