CREATE INDEX `credits_person_idx` ON `credits` (`person_id`);--> statement-breakpoint
CREATE INDEX `movies_year_idx` ON `movies` (`year`);--> statement-breakpoint
CREATE INDEX `movies_rating_idx` ON `movies` (`rating`);--> statement-breakpoint
CREATE INDEX `shows_year_idx` ON `shows` (`year`);--> statement-breakpoint
CREATE INDEX `shows_rating_idx` ON `shows` (`rating`);