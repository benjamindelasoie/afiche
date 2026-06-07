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
 * Merge-on-collision: cross-provider/cross-scrape deduplication. Multiple
 * rows can legitimately scrape into existence pointing at the same film
 * — VLM drift on image-source providers (Lorca: `GIOIA MIA` vs `GUIOTA MÍA`),
 * cross-provider format divergence (Lorca all-caps vs Lugones title-case
 * for the same film), and pre-fix year-null legacy. Once enrichment
 * resolves the same tmdb_id on each, mergeIfTmdbIdCollides collapses them:
 * re-points screenings to the existing row, deletes ours. Existing row
 * wins (it has the slug; URL contract is anchored on it).
 *
 * (History: pre-2026-05-07 this merge keyed on (scrapedTitle, year)
 * equality. That predicate silently missed VLM drift and cross-provider
 * format divergence because scrapedTitle differed between the two rows.
 * Replaced with tmdb_id equality — strictly broader, closes all three
 * classes uniformly. See migration 0007 for the supporting tmdb_id index.
 * See memory: project_afiche_mutable_key_upsert_bug for the prior fix
 * arc that introduced scraped_year as the immutable upsert anchor.)
 *
 * Rate-limiting: TMDB free tier is ~40 req/sec. For safety we sleep 100ms
 * between lookups — gives us ~10 req/sec which is plenty.
 *
 * Exported for tests. Not part of the public module contract.
 */

import { and, desc, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { db, films, screenings } from '@/db';
import { enrichFilm, enrichByTmdbId, type EnrichResult } from '@/tmdb/enrich';
import { hasTmdbToken } from '@/tmdb/client';
import { mergeFilmInto } from './films';

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
      const wasMerged = await mergeIfTmdbIdCollides(f, result.delta.tmdbId, warnings);
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
  return (
    db
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
        and(
          // Hard skip for rows operator-marked as non-films. Survives matcher
          // improvements — only flipped back via Drizzle Studio.
          eq(films.skipTmdb, false),
          // Only enrich films users can still see — at least one screening
          // today or later. Films whose screenings are all in the past
          // (expired festival residue, finished cycles, one-off premieres)
          // don't impact the cartelera, so they're not worth a TMDB call.
          // When they return (a new scrape inserts future screenings),
          // they automatically re-enter the pool. Index-backed via
          // screenings_starts_idx + screenings.film_id cascade index.
          sql`EXISTS (
            SELECT 1 FROM ${screenings}
            WHERE ${screenings.filmId} = ${films.id}
              AND ${screenings.startsAtUtc} >= unixepoch()
          )`,
          or(
            eq(films.matchSource, 'none'),
            and(eq(films.matchSource, 'none-attempted'), isNotNull(films.tmdbId)),
            and(
              eq(films.matchSource, 'manual'),
              isNotNull(films.tmdbId),
              isNull(films.posterUrl),
            ),
          ),
        ),
      )
      // Highest id first. mergeIfTmdbIdCollides makes the row currently being
      // processed the loser when a collision is found — DESC order means the
      // newer row (higher id) loses, the older row (lower id, anchored slug)
      // survives. Matters when multiple rows in the pending pool collide
      // (e.g. operator manually patched several rows to the same tmdb_id).
      // For the common single-pending-row VLM-drift case the order is moot —
      // the existing winner row isn't in the pool to begin with.
      .orderBy(desc(films.id))
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
 * If another row already has the tmdb_id this enrichment just resolved,
 * merge our row into theirs and return true. Otherwise return false and
 * let the caller proceed with a normal UPDATE.
 *
 * Why tmdb_id and not (scrapedTitle, year):
 *
 *   The original mergeIfYearCollides keyed on scrapedTitle equality, which
 *   silently missed three duplicate classes:
 *     1. VLM drift on Lorca (same image, different scraped_title across
 *        Haiku runs — `GIOIA MIA` vs `GUIOTA MÍA`, `…HERMANO` vs `…HERMANO?`)
 *     2. Cross-provider format divergence (Lorca all-caps vs Lugones
 *        title-case for the same film)
 *     3. Pre-fix year-null legacy rows
 *
 *   Once both rows enrich, they resolve to the same tmdb_id — that's the
 *   strongest identity signal in the system. Keying the merge on tmdb_id
 *   collision closes all three classes uniformly.
 *
 * Sequencing guarantee: enrichment runs sequentially over fetchPendingFilms.
 * The first row in any duplicate pair writes its tmdb_id via applyEnrichment.
 * The second row, on its iteration, sees the first row in the SELECT and
 * merges into it. This is why the merge fires BEFORE applyEnrichment in
 * the loop — applyEnrichment would write a duplicate tmdb_id otherwise.
 *
 * "Existing row wins" invariant: the row found by the SELECT keeps its
 * slug, prior enrichment, and any provider-fields-win venue synopsis.
 * Our row (the duplicate) is the loser. This anchors slug stability —
 * `films.slug` is a unique index and the URL contract; the first row to
 * receive a slug owns it forever.
 *
 * Concurrency note: across two simultaneous scrape processes, both could
 * fetch + apply enrichment before either merges, leaving a duplicate that
 * the next scrape catches. Vercel cron is serial so this is mostly
 * theoretical; manual + cron overlap is operator error and self-heals.
 */
async function mergeIfTmdbIdCollides(
  f: PendingFilm,
  resolvedTmdbId: number | null | undefined,
  warnings: string[],
): Promise<boolean> {
  // Guard against null/undefined AND zero (TMDB ids are positive ints; a
  // zero would be a bug upstream and finding any row with tmdb_id=0 would
  // be wrong). Two checks for explicitness.
  if (resolvedTmdbId == null || resolvedTmdbId <= 0) return false;

  // Predicate is `id < f.id` (NOT `id != f.id`) so the merge ALWAYS picks
  // a row with a lower id as the winner. f is always the loser when there's
  // a match. This enforces the slug-stability invariant at the SQL level
  // rather than depending on loop ordering — defense in depth against a
  // future refactor that drops the DESC sort on fetchPendingFilms.
  const [existing] = await db
    .select({ id: films.id })
    .from(films)
    .where(and(eq(films.tmdbId, resolvedTmdbId), lt(films.id, f.id)))
    .limit(1);
  if (!existing) return false;

  await mergeFilmInto(f.id, existing.id);
  warnings.push(
    `merged film ${f.id} "${f.scrapedTitle}" into existing id=${existing.id} (tmdb_id=${resolvedTmdbId} collision)`,
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
  if (!result.delta) return; // narrow; caller already checked
  await writeEnrichmentToFilm(f.id, f.synopsisEs, f.year, result.delta);
}

/**
 * Single source of truth for "how a successful TMDB match lands in films".
 *
 * Shared by:
 *   - enrichPendingFilms (this file's auto/manual/override re-enrichment loop)
 *   - the admin panel's manual-assign server action (operator picks a TMDB
 *     id in the UI → assign action calls getMovie → constructs a delta →
 *     calls this helper; same write path, same provider-fields-win invariant)
 *
 * Centralizing the write path is what keeps the two surfaces from drifting:
 * an enrichment change here automatically flows through to operator patches.
 *
 * The signature takes a film id + the two "current row state" pieces the
 * write logic needs (current synopsis for the provider-fields-win check,
 * current year as a fallback when TMDB returned year=null) instead of a
 * full row object, so callers don't need to fabricate a PendingFilm shape.
 */
export async function writeEnrichmentToFilm(
  filmId: number,
  currentSynopsisEs: string | null,
  currentYear: number | null,
  delta: NonNullable<EnrichResult['delta']>,
): Promise<void> {
  const synopsisToWrite =
    currentSynopsisEs && currentSynopsisEs.trim().length > 0
      ? currentSynopsisEs
      : delta.synopsisEs;

  await db
    .update(films)
    .set({
      tmdbId: delta.tmdbId,
      imdbId: delta.imdbId,
      title: delta.title,
      titleOriginal: delta.titleOriginal,
      director: delta.director,
      country: delta.country,
      year: delta.year ?? currentYear,
      runtimeMin: delta.runtimeMin,
      posterUrl: delta.posterUrl,
      backdropUrl: delta.backdropUrl,
      popularity: delta.popularity,
      voteAverage: delta.voteAverage,
      voteCount: delta.voteCount,
      tagline: delta.tagline,
      synopsisEs: synopsisToWrite,
      cast: delta.cast,
      genres: delta.genres,
      matchConfidence: delta.matchConfidence,
      matchSource: delta.matchSource,
    })
    .where(eq(films.id, filmId));
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
