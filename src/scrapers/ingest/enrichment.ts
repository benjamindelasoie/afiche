/**
 * TMDB enrichment pass.
 *
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
 * Manual-patch path: when an operator sets `films.tmdb_id` directly in
 * Drizzle Studio for a row whose auto match failed, the next pass picks
 * it up — the WHERE clause includes `matchSource='none-attempted' AND
 * tmdbId IS NOT NULL`, and the loop branches to `enrichByTmdbId` which
 * skips search and fetches details for the supplied id. The row ends up
 * matchSource='manual', which locks it from further re-search.
 * Workflow: see DEPLOY.md "Manual TMDB patching" section.
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

import { and, eq, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import { db, films } from '@/db';
import { enrichFilm, enrichByTmdbId, type EnrichResult } from '@/tmdb/enrich';
import { hasTmdbToken } from '@/tmdb/client';

interface PendingFilm {
  id: number;
  scrapedTitle: string;
  titleOriginal: string | null;
  director: string | null;
  year: number | null;
  synopsisEs: string | null;
  tmdbId: number | null;
}

interface EnrichmentStats {
  enriched: number;
  merged: number;
  skipped: number;
}

export async function enrichPendingFilms(warnings: string[]): Promise<EnrichmentStats> {
  if (!hasTmdbToken()) {
    return { enriched: 0, merged: 0, skipped: 0 };
  }

  const pending = await fetchPendingFilms();

  let enriched = 0;
  let merged = 0;
  let skipped = 0;

  for (const f of pending) {
    const result = await fetchTmdbResult(f);

    if (result.delta) {
      const wasMerged = await mergeIfYearCollides(f, result.delta.year, warnings);
      if (wasMerged) {
        merged++;
      } else {
        await applyEnrichment(f, result);
        enriched++;
      }
    } else {
      skipped++;
      await recordEnrichmentMiss(f, result, warnings);
    }

    // Be kind to TMDB.
    await sleep(100);
  }

  return { enriched, merged, skipped };
}

/**
 * Three paths feed into this pass:
 *   1. Fresh rows (matchSource='none') — full search via enrichFilm.
 *   2. Failed-then-patched rows (matchSource='none-attempted' with a non-null
 *      tmdb_id, set by an operator in Drizzle Studio after the auto match
 *      failed) — direct fetch via enrichByTmdbId, no search.
 *   3. Pre-emptively patched rows (matchSource='manual' with a non-null
 *      tmdb_id BUT poster_url still null). 'manual' is normally the END
 *      state of path #2, but operators intuitively pick it when patching
 *      ("this is a manual link"). The poster_url null guard means the
 *      row hasn't been enriched yet — pick it up. Once enrichByTmdbId
 *      runs and writes poster_url, the row stops matching this clause
 *      so we don't keep re-fetching on every scrape.
 *      Edge case: films TMDB has but with no poster will keep re-matching
 *      this clause every scrape. Acceptable cost; the operator can break
 *      the loop by manually setting poster_url to '' in Studio.
 */
async function fetchPendingFilms(): Promise<PendingFilm[]> {
  return db
    .select({
      id: films.id,
      scrapedTitle: films.scrapedTitle,
      titleOriginal: films.titleOriginal,
      director: films.director,
      year: films.year,
      // Read existing synopsisEs so we can apply provider-fields-win:
      // never overwrite a scraped venue synopsis (Lumiton/MALBA/Lugones
      // detail-page enrichment) with a TMDB-sourced one.
      synopsisEs: films.synopsisEs,
      tmdbId: films.tmdbId,
    })
    .from(films)
    .where(
      or(
        eq(films.matchSource, 'none'),
        and(eq(films.matchSource, 'none-attempted'), isNotNull(films.tmdbId)),
        and(
          eq(films.matchSource, 'manual'),
          isNotNull(films.tmdbId),
          isNull(films.posterUrl),
        ),
      ),
    );
}

/**
 * Fetch TMDB metadata for one pending row. When the row already has a
 * tmdb_id (operator patched it), bypass search and go direct — bypassing
 * the search costs nothing and means a wrong match the operator just
 * corrected won't be re-confused by another fuzzy hit.
 *
 * Otherwise pass every signal the scraper gave us. Providers like Lugones
 * and the Lumiton-family pull titleOriginal + director from detail pages;
 * TMDB search on the Spanish localized title alone misses ~20% of films
 * that a search on the original title + director match finds instantly.
 */
async function fetchTmdbResult(f: PendingFilm): Promise<EnrichResult> {
  if (f.tmdbId !== null) {
    return enrichByTmdbId(f.tmdbId);
  }
  return enrichFilm(f.scrapedTitle, f.year ?? undefined, {
    titleOriginal: f.titleOriginal ?? undefined,
    director: f.director ?? undefined,
  });
}

/**
 * If TMDB resolved a year that would collide with an existing
 * (scrapedTitle, year) row, merge our row into theirs and return true.
 * Otherwise return false and let the caller proceed with a normal UPDATE.
 *
 * Two collision shapes both trip this:
 *   a) f.year was null, TMDB provides one (classic duplicate from the
 *      scraper emitting the same title pre- vs post-year-match)
 *   b) f.year was WRONG (scraper's best guess), TMDB corrects it —
 *      e.g., scraper said 2024, TMDB returns 2025 and a row with
 *      (same title, 2025) already exists from a prior enrichment.
 */
async function mergeIfYearCollides(
  f: PendingFilm,
  resolvedYearMaybe: number | null | undefined,
  warnings: string[],
): Promise<boolean> {
  const resolvedYear = resolvedYearMaybe ?? f.year;
  const yearWouldChange =
    resolvedYear !== f.year && resolvedYear !== null && resolvedYear !== undefined;
  if (!yearWouldChange) return false;

  const [existing] = await db
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
  if (!existing) return false;

  // Re-point our screenings to the already-enriched row. Use
  // UPDATE OR IGNORE: some of our screenings may duplicate screenings
  // already pointing at the existing film (same cinema + same starts_at,
  // just inserted by this or a prior run). For those, the unique index
  // (film_id, cinema_id, starts_at_utc) would fire on UPDATE; OR IGNORE
  // makes the conflicting UPDATEs silently skip. The losing rows stay
  // with filmId=f.id and get cleaned up by the cascade when we DELETE
  // films.id=f.id below.
  await db.run(sql`
    UPDATE OR IGNORE screenings
    SET film_id = ${existing.id}
    WHERE film_id = ${f.id}
  `);
  await db.delete(films).where(eq(films.id, f.id));

  const fromYear = f.year === null ? 'no year' : `year=${f.year}`;
  warnings.push(
    `merged film ${f.id} "${f.scrapedTitle}" (${fromYear}) into existing id=${existing.id} after TMDB resolved year=${resolvedYear}`,
  );
  return true;
}

/**
 * Apply a successful TMDB enrichment to the films row. Provider-fields-win
 * for synopsisEs: only fill it from TMDB when the row currently has no
 * scraped venue synopsis. Lumiton/MALBA/Lugones detail-page synopses are
 * editorially better than TMDB's peninsular-Spanish fallback.
 */
async function applyEnrichment(f: PendingFilm, result: EnrichResult): Promise<void> {
  const delta = result.delta;
  if (!delta) return; // narrow; caller already checked

  const synopsisToWrite =
    f.synopsisEs && f.synopsisEs.trim().length > 0 ? f.synopsisEs : delta.synopsisEs;

  await db
    .update(films)
    .set({
      tmdbId: delta.tmdbId,
      imdbId: delta.imdbId,
      title: delta.title,
      titleOriginal: delta.titleOriginal,
      director: delta.director,
      country: delta.country,
      year: delta.year ?? f.year,
      runtimeMin: delta.runtimeMin,
      posterUrl: delta.posterUrl,
      backdropUrl: delta.backdropUrl,
      synopsisEs: synopsisToWrite,
      cast: delta.cast,
      genres: delta.genres,
      matchConfidence: delta.matchConfidence,
      matchSource: delta.matchSource,
    })
    .where(eq(films.id, f.id));
}

/**
 * Record the outcome of a missed TMDB enrichment. Deterministic misses
 * (no-candidates / low-confidence) flip match_source to 'none-attempted'
 * to lock the row out of future passes. Transient errors are captured as
 * warnings and leave match_source='none' so the next run retries.
 */
async function recordEnrichmentMiss(
  f: PendingFilm,
  result: EnrichResult,
  warnings: string[],
): Promise<void> {
  if (result.delta !== null) return;

  if (result.reason === 'error') {
    warnings.push(
      `TMDB error for "${f.scrapedTitle}" (${f.year ?? 'no year'}): ${result.error}`,
    );
    return;
  }
  if (result.reason === 'no-candidates' || result.reason === 'low-confidence') {
    await db
      .update(films)
      .set({ matchSource: 'none-attempted' })
      .where(eq(films.id, f.id));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
