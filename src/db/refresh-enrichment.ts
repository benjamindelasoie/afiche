/**
 * Re-fetch TMDB metadata for every film that has a `tmdb_id`. Use after
 * schema additions that come from the existing TMDB `getMovie` payload
 * (cast, genres) so already-locked rows pick up the new fields without
 * a wipe + re-scrape.
 *
 * Two entry points:
 *   - `refreshAllEnrichment()` — exported helper used by the CLI shell
 *     below AND by the /admin/runs server action. Same body in both.
 *   - CLI `main()` — wraps the helper with dotenv + logging + exit codes.
 *
 * Why this is safe:
 *   - It's a re-fetch, not a re-search. Each film's binding to a specific
 *     TMDB id is preserved, so an 'auto' match can't drift to a different
 *     candidate, and a 'manual' patch can't lose its operator-chosen id.
 *   - `match_source` and `match_confidence` are NOT overwritten. If a row
 *     was 'auto' with confidence 0.92, it stays 'auto' with 0.92.
 *   - Slugs are stable (not part of the update set).
 *   - Provider-fields-win on `synopsis_es`: a scraped venue synopsis
 *     never gets clobbered by TMDB's. Same rule as enrichPendingFilms.
 *   - 100ms sleep between calls, same throttle as the normal enrichment
 *     pass — TMDB tolerates 10 req/sec easily.
 *
 * Skipped: rows with `tmdb_id IS NULL`. They never matched TMDB, so
 * there's nothing to refresh.
 *
 * Run locally:
 *   npm run db:refresh-enrichment
 *
 * Run against Turso (prod):
 *   npm run db:refresh-enrichment:prod
 */

import 'dotenv/config';
import { eq, isNotNull } from 'drizzle-orm';
import { db, films } from '@/db';
import { enrichByTmdbId } from '@/tmdb/enrich';
import { hasTmdbToken } from '@/tmdb/client';

export interface RefreshResult {
  refreshed: number;
  errors: number;
  errorDetails: string[];
  scanned: number;
}

/**
 * Iterates every film with a non-null `tmdb_id`, re-fetches TMDB details
 * via `enrichByTmdbId`, and updates the row. Returns aggregate counts
 * plus per-error detail strings (capped at 20 for log readability).
 *
 * Caller is responsible for guarding on `hasTmdbToken()` if a no-op
 * shouldn't silently look like success — this helper returns zero-counts
 * when the token is missing rather than throwing.
 */
export async function refreshAllEnrichment(
  onProgress?: (done: number, total: number) => void,
): Promise<RefreshResult> {
  if (!hasTmdbToken()) {
    return {
      refreshed: 0,
      errors: 0,
      errorDetails: ['TMDB_API_TOKEN not set'],
      scanned: 0,
    };
  }

  const rows = await db
    .select({
      id: films.id,
      tmdbId: films.tmdbId,
      scrapedTitle: films.scrapedTitle,
      year: films.year,
      synopsisEs: films.synopsisEs,
    })
    .from(films)
    .where(isNotNull(films.tmdbId))
    .orderBy(films.id);

  let refreshed = 0;
  let errors = 0;
  const errorDetails: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const f = rows[i];
    if (f.tmdbId === null) continue;
    const result = await enrichByTmdbId(f.tmdbId);
    if (result.delta) {
      const synopsisToWrite =
        f.synopsisEs && f.synopsisEs.trim().length > 0
          ? f.synopsisEs
          : result.delta.synopsisEs;

      await db
        .update(films)
        .set({
          imdbId: result.delta.imdbId,
          title: result.delta.title,
          titleOriginal: result.delta.titleOriginal,
          director: result.delta.director,
          country: result.delta.country,
          year: result.delta.year ?? f.year,
          runtimeMin: result.delta.runtimeMin,
          posterUrl: result.delta.posterUrl,
          backdropUrl: result.delta.backdropUrl,
          popularity: result.delta.popularity,
          voteAverage: result.delta.voteAverage,
          voteCount: result.delta.voteCount,
          tagline: result.delta.tagline,
          synopsisEs: synopsisToWrite,
          cast: result.delta.cast,
          genres: result.delta.genres,
        })
        .where(eq(films.id, f.id));
      refreshed++;
    } else {
      errors++;
      if (errorDetails.length < 20) {
        errorDetails.push(
          `id=${f.id} "${f.scrapedTitle}" (tmdb_id=${f.tmdbId}): ${result.reason}${
            result.error ? ` — ${result.error}` : ''
          }`,
        );
      }
    }
    onProgress?.(i + 1, rows.length);
    await sleep(100);
  }

  return { refreshed, errors, errorDetails, scanned: rows.length };
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function main() {
  console.log(
    `🎞  Refreshing TMDB metadata · ${new Date().toISOString()}\n` +
      `   target: ${process.env.DATABASE_URL ?? '(unset)'}\n`,
  );

  const result = await refreshAllEnrichment((done, total) => {
    if (done % 25 === 0) console.log(`  ${done}/${total}`);
  });

  console.log(
    `\n✅ Done. refreshed: ${result.refreshed}, errors: ${result.errors} (scanned ${result.scanned})`,
  );
  for (const e of result.errorDetails) console.error(`  ❌ ${e}`);
}

if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  /refresh-enrichment\.[tj]s$/.test(process.argv[1])
) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('💥 refresh-enrichment crashed:', err);
      process.exit(1);
    });
}
