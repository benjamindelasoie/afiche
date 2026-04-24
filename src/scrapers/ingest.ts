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

import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { db, films, screenings, providers } from '@/db';
import type { ProviderRunResult, ScrapedScreening } from '@/providers/types';
import { enrichFilm, type EnrichResult } from '@/tmdb/enrich';
import { hasTmdbToken } from '@/tmdb/client';

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

  // 3. Insert the new screenings — done BEFORE enrichment on purpose.
  //    enrichPendingFilms may merge duplicate film rows (collapsing a
  //    year-less or wrong-year row into an existing enriched one), and
  //    the merge deletes the losing row. If enrichment ran first, the
  //    film_ids in filmIdByKey could point at rows that the merge just
  //    deleted — FOREIGN KEY violation on screening INSERT. With the
  //    order reversed, screenings land first, and the merge's own
  //    `UPDATE screenings SET film_id = existingId WHERE film_id = f.id`
  //    re-points them to the surviving row safely.
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

  // 3b. TMDB enrichment — now safe to merge duplicates because the merge
  //     re-points live screenings (just inserted) before dropping the
  //     losing film row. Non-fatal: if TMDB is down or the token is
  //     missing, we skip and continue.
  const enrichStats = await enrichPendingFilms(summary.warnings);
  summary.filmsEnriched = enrichStats.enriched;
  summary.filmsMerged = enrichStats.merged;
  summary.enrichSkipped = enrichStats.skipped;

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

// ---------------------------------------------------------------------------
// Films upsert — one row per unique (scrapedTitle, year) combination
// ---------------------------------------------------------------------------
async function upsertFilms(scraped: ScrapedScreening[]): Promise<Map<string, number>> {
  const byKey = new Map<string, ScrapedScreening>();
  for (const s of scraped) {
    const key = filmKey(s.filmTitle, s.year);
    if (!byKey.has(key)) byKey.set(key, s);
  }

  const idByKey = new Map<string, number>();

  // SQLite supports upsert via ON CONFLICT; drizzle exposes .onConflictDoUpdate.
  // Some providers (MALBA S2 single-event pages) only know the film title —
  // every metadata field is undefined. Drizzle's mapUpdateSet strips undefined
  // keys at SQL-build time and throws "No values to set" on an empty set clause,
  // which would blow up the whole ingest. So we branch: update only when there
  // is something worth refreshing.
  for (const [key, s] of byKey) {
    const insertValues = {
      title: s.filmTitle,
      scrapedTitle: s.filmTitle,
      titleOriginal: s.filmTitleOriginal,
      director: s.director,
      year: s.year,
      country: s.country,
      runtimeMin: s.runtimeMin,
      synopsisEs: s.synopsisEs,
      matchSource: 'none' as const,
    };

    const updateSet: Record<string, unknown> = {};
    if (s.filmTitleOriginal !== undefined) updateSet.titleOriginal = s.filmTitleOriginal;
    if (s.director !== undefined) updateSet.director = s.director;
    if (s.country !== undefined) updateSet.country = s.country;
    if (s.runtimeMin !== undefined) updateSet.runtimeMin = s.runtimeMin;
    if (s.synopsisEs !== undefined) updateSet.synopsisEs = s.synopsisEs;

    let filmId: number | undefined;

    if (Object.keys(updateSet).length > 0) {
      const [row] = await db
        .insert(films)
        .values(insertValues)
        .onConflictDoUpdate({
          target: [films.scrapedTitle, films.year],
          set: updateSet,
        })
        .returning({ id: films.id });
      filmId = row?.id;
    } else {
      // Nothing to refresh. Insert if new, otherwise leave existing row alone
      // and look its id up. onConflictDoNothing + .returning() omits the row
      // when the insert was a no-op, so we fall back to a SELECT in that case.
      const [inserted] = await db
        .insert(films)
        .values(insertValues)
        .onConflictDoNothing()
        .returning({ id: films.id });
      if (inserted) {
        filmId = inserted.id;
      } else {
        const yearCond =
          s.year === undefined ? isNull(films.year) : eq(films.year, s.year);
        const [existing] = await db
          .select({ id: films.id })
          .from(films)
          .where(and(eq(films.scrapedTitle, s.filmTitle), yearCond))
          .limit(1);
        filmId = existing?.id;
      }
    }

    if (filmId !== undefined) idByKey.set(key, filmId);
  }

  return idByKey;
}

function filmKey(title: string, year: number | undefined): string {
  return `${title}::${year ?? 'no-year'}`;
}

// ---------------------------------------------------------------------------
// TMDB enrichment pass
// ---------------------------------------------------------------------------
/**
 * For every film row whose match_source is still 'none' (never enriched),
 * attempt a TMDB lookup. Results update the row with poster URL, director,
 * runtime, etc. Non-fatal errors are recorded as warnings.
 *
 * Miss semantics:
 *   - A deterministic miss (no-candidates / low-confidence) sets
 *     match_source='none-attempted' so we don't re-query TMDB for this
 *     row on every subsequent scraper run.
 *   - A transient miss (error / no-token) leaves match_source='none'
 *     so the next run retries once the token is configured or TMDB recovers.
 *
 * Merge-on-collision: the films unique index is on (scrapedTitle, year).
 * SQLite treats NULL as distinct, so a year-less provider (e.g. Lumiton)
 * can create a row with year=NULL that coexists with an older row that
 * has (same title, year=1962). When TMDB then resolves our row's year to
 * 1962, naïvely UPDATE-ing would trip the unique constraint. Instead we
 * detect the would-be collision, re-point our screenings to the existing
 * enriched row, and delete ours. The existing row wins (it's already
 * enriched with trusted data from a prior run).
 *
 * Rate-limiting: TMDB free tier is ~40 req/sec. For safety we sleep 100ms
 * between lookups — gives us ~10 req/sec which is plenty.
 *
 * Exported for tests. Not part of the public module contract.
 */
export async function enrichPendingFilms(
  warnings: string[],
): Promise<{ enriched: number; merged: number; skipped: number }> {
  if (!hasTmdbToken()) {
    return { enriched: 0, merged: 0, skipped: 0 };
  }

  const pending = await db
    .select({
      id: films.id,
      scrapedTitle: films.scrapedTitle,
      titleOriginal: films.titleOriginal,
      director: films.director,
      year: films.year,
    })
    .from(films)
    .where(eq(films.matchSource, 'none'));

  let enriched = 0;
  let merged = 0;
  let skipped = 0;

  for (const f of pending) {
    // Pass every signal the scraper gave us. Providers like Lugones and the
    // Lumiton-family pull titleOriginal + director from detail pages; TMDB
    // search on the Spanish localized title alone misses ~20% of films
    // that a search on the original title + director match finds instantly.
    const result: EnrichResult = await enrichFilm(f.scrapedTitle, f.year ?? undefined, {
      titleOriginal: f.titleOriginal ?? undefined,
      director: f.director ?? undefined,
    });
    if (result.delta) {
      // Merge check: TMDB just resolved a year that might collide with
      // another row having the same (scraped_title, year). Two cases:
      //   a) f.year was null, TMDB provides one (classic duplicate from
      //      the scraper emitting the same title pre- vs post-year-match)
      //   b) f.year was WRONG (scraper's best guess), TMDB corrects it —
      //      e.g., scraper said 2024, TMDB returns 2025 and a row with
      //      (same title, 2025) already exists from a prior enrichment.
      // Both trigger the unique constraint `(scraped_title, year)` at
      // UPDATE time. Catch either by checking: would the resolved year
      // differ from what we have AND would it collide with an existing
      // row? If yes, re-point screenings to the existing row and drop
      // ours, same as before.
      const resolvedYear = result.delta.year ?? f.year;
      const yearWouldChange =
        resolvedYear !== f.year && resolvedYear !== null && resolvedYear !== undefined;
      if (yearWouldChange) {
        const existing = await db
          .select({ id: films.id })
          .from(films)
          .where(
            and(
              eq(films.scrapedTitle, f.scrapedTitle),
              eq(films.year, resolvedYear),
              ne(films.id, f.id),
            ),
          )
          .limit(1);
        if (existing[0]) {
          // Re-point our screenings to the already-enriched row. Use
          // UPDATE OR IGNORE: some of our screenings may duplicate
          // screenings already pointing at the existing film (same
          // cinema + same starts_at, just inserted by this or a prior
          // run). For those, the unique index (film_id, cinema_id,
          // starts_at_utc) would fire on UPDATE; OR IGNORE makes the
          // conflicting UPDATEs silently skip. The losing rows stay
          // with filmId=f.id and get cleaned up by the cascade when we
          // DELETE films.id=f.id below.
          await db.run(sql`
            UPDATE OR IGNORE screenings
            SET film_id = ${existing[0].id}
            WHERE film_id = ${f.id}
          `);
          await db.delete(films).where(eq(films.id, f.id));
          merged++;
          const fromYear = f.year === null ? 'no year' : `year=${f.year}`;
          warnings.push(
            `merged film ${f.id} "${f.scrapedTitle}" (${fromYear}) into existing id=${existing[0].id} after TMDB resolved year=${resolvedYear}`,
          );
          await sleep(100);
          continue;
        }
      }

      await db
        .update(films)
        .set({
          tmdbId: result.delta.tmdbId,
          imdbId: result.delta.imdbId,
          title: result.delta.title,
          titleOriginal: result.delta.titleOriginal,
          director: result.delta.director,
          country: result.delta.country,
          year: result.delta.year ?? f.year,
          runtimeMin: result.delta.runtimeMin,
          posterUrl: result.delta.posterUrl,
          matchConfidence: result.delta.matchConfidence,
          matchSource: result.delta.matchSource,
        })
        .where(eq(films.id, f.id));
      enriched++;
    } else {
      skipped++;
      if (result.reason === 'error') {
        warnings.push(
          `TMDB error for "${f.scrapedTitle}" (${f.year ?? 'no year'}): ${result.error}`,
        );
      }
      if (result.reason === 'no-candidates' || result.reason === 'low-confidence') {
        await db
          .update(films)
          .set({ matchSource: 'none-attempted' })
          .where(eq(films.id, f.id));
      }
    }
    // Be kind to TMDB
    await sleep(100);
  }

  return { enriched, merged, skipped };
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
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
