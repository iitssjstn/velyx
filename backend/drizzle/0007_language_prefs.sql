ALTER TABLE `users` ADD `pref_audio_language` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `pref_subtitle_language` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `pref_subtitle_fallback` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `pref_subtitle_mode` text DEFAULT 'remember' NOT NULL;