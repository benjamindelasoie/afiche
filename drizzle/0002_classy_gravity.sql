ALTER TABLE `films` ADD `slug` text;--> statement-breakpoint
CREATE UNIQUE INDEX `films_slug_idx` ON `films` (`slug`);--> statement-breakpoint
ALTER TABLE `screenings` ADD `program_name` text;