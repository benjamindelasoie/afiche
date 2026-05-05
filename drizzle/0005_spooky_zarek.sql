-- Mutable-key upsert fix: separate the upsert key from the mutable `year`
-- column. Adds `scraped_year` (the year as the scraper first saw it,
-- IMMUTABLE after first insert) and moves the films unique index from
-- (scraped_title, year) to (scraped_title, scraped_year).
--
-- Why this matters: enrichment writes `year` (when TMDB resolves a year-
-- less row to e.g. 2025), which previously broke the upsert key. A
-- re-scrape that emitted year=null would fail to find the existing row
-- (year=2025 ≠ NULL) and insert an unenriched duplicate, stranding the
-- screenings. Manually-patched films were the canonical failure: see the
-- 2026-05-05 incident — rows 1736/1451 (PADRE, MADRE, HERMANA, HERMANO)
-- and 1740/1455 (EL DESPRECIO 1963).
--
-- Backfill strategy: copy `year` → `scraped_year` for every row by
-- default, then NULL out manually-patched rows (match_source='manual')
-- where we know the scraper originally emitted year=null (that's why
-- auto-match failed and the operator patched). Auto-matched rows that
-- were originally year=null will have a slightly wrong `scraped_year`
-- (the TMDB-resolved year instead of NULL). They'll create one duplicate
-- on the next scrape, the existing mergeIfYearCollides logic in
-- enrichment.ts collapses it, and the row stabilizes — bounded one-time
-- noise, not persistent thrashing.

ALTER TABLE `films` ADD `scraped_year` integer;--> statement-breakpoint
UPDATE `films` SET `scraped_year` = `year`;--> statement-breakpoint
UPDATE `films` SET `scraped_year` = NULL WHERE `match_source` = 'manual';--> statement-breakpoint
DROP INDEX `films_scraped_title_year_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `films_scraped_title_scraped_year_idx` ON `films` (`scraped_title`,`scraped_year`);
