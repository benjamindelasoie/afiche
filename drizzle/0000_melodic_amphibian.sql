CREATE TABLE `cinemas` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`neighborhood` text,
	`type` text NOT NULL,
	`address` text,
	`ticketing_base_url` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `films` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`title_original` text,
	`scraped_title` text NOT NULL,
	`director` text,
	`year` integer,
	`country` text,
	`runtime_min` integer,
	`synopsis_es` text,
	`tmdb_id` integer,
	`imdb_id` text,
	`poster_url` text,
	`match_confidence` real,
	`match_source` text DEFAULT 'none' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `films_scraped_title_year_idx` ON `films` (`scraped_title`,`year`);--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`last_run_at` integer,
	`last_success_at` integer,
	`last_error` text,
	`screening_count` integer DEFAULT 0,
	FOREIGN KEY (`id`) REFERENCES `cinemas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `screenings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`film_id` integer NOT NULL,
	`cinema_id` text NOT NULL,
	`starts_at_utc` integer NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`source_url` text,
	`scraped_at` integer NOT NULL,
	FOREIGN KEY (`film_id`) REFERENCES `films`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cinema_id`) REFERENCES `cinemas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `screenings_starts_idx` ON `screenings` (`starts_at_utc`);--> statement-breakpoint
CREATE INDEX `screenings_cinema_idx` ON `screenings` (`cinema_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `screenings_unique_idx` ON `screenings` (`film_id`,`cinema_id`,`starts_at_utc`);