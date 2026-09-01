/**
 * Scraper → DB ingest pipeline.
 *
 * Orchestrates a 5-step sequence; each step lives in its own module under
 * `./ingest/`:
 *
 *   1. recordProviderRun       — stamp lastRunAt + lastError
 *   2. upsertFilms             — one films row per (scrapedTitle, year)
 *   3. replaceFutureScreenings — atomic delete-future + insert
 *   4. enrichPendingFilms      — TMDB lookup, merge on year-collision
 *   5. markProviderSuccess     — stamp lastSuccessAt + screeningCount
 *
 * Semantics:
 *   - Idempotent: re-running with the same data produces the same rows.
 *     Unique index on (scraped_title, year) for films and on
 *     (film_id, cinema_id, starts_at_utc) for screenings handle dedup.
 *   - Safe: only touches screenings BELONGING TO THE PROVIDER being
 *     ingested, and only those in the future (so we don't wipe historical
 *     rows once we have any).
 *   - Step ordering matters: screenings must land BEFORE enrichment so
 *     the merge-on-collision can re-point them safely. See screenings.ts
 *     for the full reasoning.
 */

import type { ProviderRunResult } from '@/providers/types';
import { recordProviderRun, markProviderSuccess } from './ingest/provider-health';
import { upsertFilms } from './ingest/films';
import { replaceFutureScreenings } from './ingest/screenings';
import { enrichPendingFilms } from './ingest/enrichment';
import type { IngestSummary } from './ingest/types';

export async function ingest(result: ProviderRunResult): Promise<IngestSummary> {
  const now = new Date();
  const summary: IngestSummary = {
    cinemaId: result.cinemaId,
    success: result.success,
    screeningsScraped: result.screenings.length,
    screeningsInserted: 0,
    filmsUpserted: 0,
    filmsEnriched: 0,
    filmsMerged: 0,
    enrichSkipped: 0,
    warnings: result.warnings.slice(),
  };

  // 1. Always record that the provider ran, even on failure.
  await recordProviderRun(result.cinemaId, now, result.success, result.error);
  if (!result.success) return summary;

  // 2. Upsert films, build map: scrapedTitle+year → film_id.
  const filmIdByKey = await upsertFilms(result.screenings);
  summary.filmsUpserted = filmIdByKey.size;

  // 3. Replace future screenings. The pre-write breaker refuses an empty fetch
  //    (a likely scraper break) so a live schedule isn't wiped; surface it as a warning.
  const replace = await replaceFutureScreenings(
    result.cinemaId,
    now,
    result.screenings,
    filmIdByKey,
  );
  summary.screeningsInserted = replace.inserted;
  if (replace.circuitBroke) {
    summary.warnings.push(
      `circuit breaker: "${result.cinemaId}" returned 0 screenings but ` +
        `${replace.preservedFuture} future rows exist — kept the last good ` +
        `schedule (scraper likely broke against a site change)`,
    );
  }

  // 4. TMDB enrichment (non-fatal; merges duplicates safely now that
  //    screenings are live and re-pointable).
  const enrichStats = await enrichPendingFilms(summary.warnings);
  summary.filmsEnriched = enrichStats.enriched;
  summary.filmsMerged = enrichStats.merged;
  summary.enrichSkipped = enrichStats.skipped;

  // 5. Stamp success-side counters on the providers row.
  await markProviderSuccess(result.cinemaId, now, summary.screeningsInserted);

  return summary;
}

// Re-exports — preserve the public surface that other modules import from
// `@/scrapers/ingest`:
//   src/db/enrich.ts                                  → enrichPendingFilms
//   src/scrapers/run.ts                               → ingest, type IngestSummary
//   src/scrapers/run-log.ts                           → type IngestSummary
//   src/scrapers/ingest.test.ts                       → ingest, enrichPendingFilms, isSlugUniqueViolation, mergeFilmInto
//   src/app/admin/unmatched/[id]/actions.ts (PR-2)    → mergeFilmInto, writeEnrichmentToFilm
export { enrichPendingFilms, writeEnrichmentToFilm } from './ingest/enrichment';
export { mergeFilmInto } from './ingest/films';
export { isSlugUniqueViolation } from './ingest/errors';
export type { IngestSummary } from './ingest/types';
