/**
 * Re-fetch TMDB metadata for every film that has a `tmdb_id`. Use after
 * schema additions that come from the existing TMDB `getMovie` payload
 * (cast, genres) so already-locked rows pick up the new fields without
 * a wipe + re-scrape.
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

async function main() {
  if (!hasTmdbToken()) {
    console.error('TMDB_API_TOKEN not set in env');
    process.exit(1);
  }

  console.log(
    `🎞  Refreshing TMDB metadata · ${new Date().toISOString()}\n` +
      `   target: ${process.env.DATABASE_URL ?? '(unset)'}\n`,
  );

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

  console.log(`Refreshing ${rows.length} films...\n`);

  let refreshed = 0;
  let errors = 0;

  for (const f of rows) {
    if (f.tmdbId === null) continue;
    const result = await enrichByTmdbId(f.tmdbId);
    if (result.delta) {
      // Provider-fields-win: only overwrite synopsis_es from TMDB when the
      // row currently has none. Lumiton/MALBA/Lugones detail-page synopses
      // are editorially better than TMDB's peninsular fallback.
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
          synopsisEs: synopsisToWrite,
          cast: result.delta.cast,
          genres: result.delta.genres,
          // match_source + match_confidence intentionally NOT updated —
          // we're refreshing fields, not re-classifying the match.
        })
        .where(eq(films.id, f.id));
      refreshed++;
      if (refreshed % 25 === 0) {
        console.log(`  ${refreshed}/${rows.length}`);
      }
    } else {
      errors++;
      console.error(
        `  ❌ id=${f.id} "${f.scrapedTitle}" (tmdb_id=${f.tmdbId}): ${result.reason}${
          result.error ? ` — ${result.error}` : ''
        }`,
      );
    }
    // Same throttle as enrichPendingFilms — be kind to TMDB.
    await sleep(100);
  }

  console.log(`\n✅ Done. refreshed: ${refreshed}, errors: ${errors}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('💥 refresh-enrichment crashed:', err);
    process.exit(1);
  });
