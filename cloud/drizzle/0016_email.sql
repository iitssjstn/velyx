CREATE TABLE `email_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`purpose` text NOT NULL,
	`new_email` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `email_tokens_account` ON `email_tokens` (`account_id`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `email_verified_at` integer;--> statement-breakpoint
-- Accounts from before e-mail confirmation existed (with a password of their own) count as confirmed.
UPDATE `accounts` SET `email_verified_at` = `created_at` WHERE `password_hash` != '';
