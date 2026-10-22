CREATE TABLE `heal_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ran_at` integer NOT NULL,
	`stuck` integer DEFAULT 0 NOT NULL,
	`applied` integer DEFAULT 0 NOT NULL,
	`queued` integer DEFAULT 0 NOT NULL,
	`no_candidate` integer DEFAULT 0 NOT NULL,
	`declined` integer DEFAULT 0 NOT NULL,
	`errored` integer DEFAULT 0 NOT NULL,
	`issues_opened` integer DEFAULT 0 NOT NULL,
	`alerts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `heal_runs_ran_at_idx` ON `heal_runs` (`ran_at`);