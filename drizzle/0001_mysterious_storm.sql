CREATE TABLE `scrape_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cinema_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text DEFAULT 'in-progress' NOT NULL,
	`duration_ms` integer,
	`screenings_scraped` integer,
	`screenings_inserted` integer,
	`films_upserted` integer,
	`films_enriched` integer,
	`enrich_skipped` integer,
	`error` text,
	`warnings` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`cinema_id`) REFERENCES `cinemas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scrape_runs_cinema_started_idx` ON `scrape_runs` (`cinema_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `scrape_runs_started_idx` ON `scrape_runs` (`started_at`);