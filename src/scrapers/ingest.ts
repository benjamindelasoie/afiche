/**
 * Ingest layer — takes a ProviderRunResult and upserts into the DB.
 *
 * Semantics:
 *   - Idempotent: re-running with the same data produces the same rows.
 *     Unique index on (scraped_title, year) for films and on
 *     (film_id, cinema_id, starts_at_utc) for screenings handle dedup.
 *   - Safe: never touches screenings for other cinemas. Only deletes+reinserts
 *     screenings BELONGING TO THE PROVIDER being ingested, and only those
 *     in the future (so we don't wipe historical rows once we have any).
 *   - Updates the providers table with run health: last_run_at,
 *     last_success_at, last_error, screening_count.
 */

import { and, eq, gt } from 'drizzle-orm';
import { db, films, screenings, providers } from '@/db';
import type { ProviderRunResult, ScrapedScreening } from '@/providers/types';

export async function ingest(result: ProviderRunResult): Promise<IngestSummary> {
  const now = new Date();
  const summary: IngestSummary = {
    cinemaId: result.cinemaId,
    success: result.success,
    screeningsScraped: result.screenings.length,
    screeningsInserted: 0,
    filmsUpserted: 0,
    warnings: result.warnings.slice(),
  };

  // Always record that the provider ran, even if it failed.
  await upsertProviderRow(result.cinemaId, now, result.success, result.error);

  if (!result.success) {
    return summary;
  }

  // 1. Upsert films, building a map: scrapedTitle+year → film_id
  const filmIdByKey = await upsertFilms(result.screenings);
  summary.filmsUpserted = filmIdByKey.size;

  // 2. Clear existing future screenings for this cinema
  //    (keeps historical rows; only replaces what we're about to re-scrape).
  await db
    .delete(screenings)
    .where(
      and(eq(screenings.cinemaId, result.cinemaId), gt(screenings.startsAtUtc, now)),
    );

  // 3. Insert the new screenings
  if (result.screenings.length > 0) {
    const toInsert = result.screenings
      .map((s) => {
        const key = filmKey(s.filmTitle, s.year);
        const filmId = filmIdByKey.get(key);
        if (!filmId) return null; // shouldn't happen, but be defensive
        return {
          filmId,
          cinemaId: s.cinemaId,
          startsAtUtc: s.startsAtUtc,
          tags: s.tags,
          sourceUrl: s.sourceUrl,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (toInsert.length > 0) {
      // Use onConflictDoNothing so the unique index on
      // (film_id, cinema_id, starts_at_utc) silently deduplicates.
      await db.insert(screenings).values(toInsert).onConflictDoNothing();
      summary.screeningsInserted = toInsert.length;
    }
  }

  // 4. Update provider success row
  await db
    .update(providers)
    .set({
      lastSuccessAt: now,
      screeningCount: summary.screeningsInserted,
      lastError: null,
    })
    .where(eq(providers.id, result.cinemaId));

  return summary;
}

export interface IngestSummary {
  cinemaId: string;
  success: boolean;
  screeningsScraped: number;
  screeningsInserted: number;
  filmsUpserted: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Films upsert — one row per unique (scrapedTitle, year) combination
// ---------------------------------------------------------------------------
async function upsertFilms(
  scraped: ScrapedScreening[],
): Promise<Map<string, number>> {
  const byKey = new Map<string, ScrapedScreening>();
  for (const s of scraped) {
    const key = filmKey(s.filmTitle, s.year);
    if (!byKey.has(key)) byKey.set(key, s);
  }

  const idByKey = new Map<string, number>();

  // SQLite supports upsert via ON CONFLICT; drizzle exposes .onConflictDoUpdate
  for (const [key, s] of byKey) {
    const [row] = await db
      .insert(films)
      .values({
        title: s.filmTitle,
        scrapedTitle: s.filmTitle,
        titleOriginal: s.filmTitleOriginal,
        director: s.director,
        year: s.year,
        country: s.country,
        runtimeMin: s.runtimeMin,
        synopsisEs: s.synopsisEs,
        matchSource: 'none',
      })
      .onConflictDoUpdate({
        target: [films.scrapedTitle, films.year],
        set: {
          // Refresh metadata in case the source updated anything.
          titleOriginal: s.filmTitleOriginal,
          director: s.director,
          country: s.country,
          runtimeMin: s.runtimeMin,
          synopsisEs: s.synopsisEs,
        },
      })
      .returning({ id: films.id });

    if (row) idByKey.set(key, row.id);
  }

  return idByKey;
}

function filmKey(title: string, year: number | undefined): string {
  return `${title}::${year ?? 'no-year'}`;
}

// ---------------------------------------------------------------------------
// providers row upsert (health tracking)
// ---------------------------------------------------------------------------
async function upsertProviderRow(
  cinemaId: string,
  runAt: Date,
  success: boolean,
  error: string | undefined,
): Promise<void> {
  await db
    .insert(providers)
    .values({
      id: cinemaId,
      lastRunAt: runAt,
      lastError: success ? null : (error ?? 'unknown error'),
    })
    .onConflictDoUpdate({
      target: providers.id,
      set: {
        lastRunAt: runAt,
        lastError: success ? null : (error ?? 'unknown error'),
      },
    });
}
