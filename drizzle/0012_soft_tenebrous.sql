CREATE TABLE `tmdb_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scraped_title` text NOT NULL,
	`year` integer,
	`tmdb_id` integer NOT NULL,
	`note` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`confidence` real,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tmdb_overrides_title_year_idx` ON `tmdb_overrides` (`scraped_title`,`year`);