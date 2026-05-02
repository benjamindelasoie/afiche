/**
 * Public ingest result type. Returned by `ingest()` and consumed by
 * `run.ts` + `run-log.ts` to record per-cinema scrape outcomes.
 */
export interface IngestSummary {
  cinemaId: string;
  success: boolean;
  screeningsScraped: number;
  screeningsInserted: number;
  filmsUpserted: number;
  filmsEnriched: number;
  /**
   * Count of rows collapsed into an existing (scrapedTitle, year) row
   * during enrichment. Happens when a year-less provider creates a
   * NULL-year row for a film that another provider already captured
   * with a known year.
   */
  filmsMerged: number;
  enrichSkipped: number;
  warnings: string[];
}
