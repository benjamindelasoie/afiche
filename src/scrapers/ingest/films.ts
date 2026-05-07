/**
 * Films upsert pass — one row per unique (scrapedTitle, year) combination.
 *
 * Slug handling lives here, not in queries.ts, because every scraper run
 * goes through this single ingest path. Centralized = single helper to
 * audit. The slug derivation flow:
 *
 *   1. Insert (or upsert by scraped_title+year) WITHOUT setting slug
 *      — the slug column is nullable at the DB level for this reason.
 *   2. Read back films.id + films.slug.
 *   3. If slug is non-null: row already had one (existing row, idempotent
 *      re-scrape, or earlier backfill). Done.
 *   4. If slug is null: compute base = buildFilmSlug(title, { year, id }).
 *      Try UPDATE films SET slug = base. On UNIQUE collision (different
 *      film already owns this slug — re-releases, festival cuts), retry
 *      with `${base}-${id}` tiebreaker. The id-suffixed slug is
 *      guaranteed unique by construction (films.id is unique).
 *
 * The slug never updates after first set. URLs are the contract.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, films, type FilmInsert } from '@/db';
import type { ScrapedScreening } from '@/providers/types';
import { buildFilmSlug, withIdSuffix } from '@/lib/slug';
import { isSlugUniqueViolation } from './errors';

/**
 * Upsert every distinct film referenced by the scraped screenings.
 * Returns a map keyed by `filmKey(title, year)` → films.id, used by the
 * screenings insert step to resolve each scraped row to its film_id.
 */
export async function upsertFilms(
  scraped: ScrapedScreening[],
): Promise<Map<string, number>> {
  // Dedup by key so we only call upsertOneFilm once per distinct film,
  // even when N screenings reference the same film.
  const byKey = new Map<string, ScrapedScreening>();
  for (const s of scraped) {
    const key = filmKey(s.filmTitle, s.year);
    if (!byKey.has(key)) byKey.set(key, s);
  }

  const idByKey = new Map<string, number>();
  for (const [key, s] of byKey) {
    const filmId = await upsertOneFilm(s);
    if (filmId !== undefined) idByKey.set(key, filmId);
  }
  return idByKey;
}

/**
 * Compose the unique key for a (title, year) pair. NULL year stringifies as
 * `no-year` so two distinct year-less rows hash to the same bucket here even
 * though SQLite's unique index treats NULLs as distinct (see the year-less
 * branch in `upsertFilmRow` for the find-or-create that compensates).
 */
export function filmKey(title: string, year: number | undefined): string {
  return `${title}::${year ?? 'no-year'}`;
}

async function upsertOneFilm(s: ScrapedScreening): Promise<number | undefined> {
  const { filmId, existingSlug } = await upsertFilmRow(s);
  if (filmId === undefined) return undefined;
  if (!existingSlug) {
    await ensureFilmSlug(filmId, s.filmTitle, s.year);
  }
  return filmId;
}

interface UpsertResult {
  filmId: number | undefined;
  existingSlug: string | null;
}

/**
 * Upsert one film row by (scrapedTitle, scrapedYear). Three branches:
 *
 *   1. year=undefined         → app-level find-or-create on (title, scraped_year IS NULL)
 *   2. year known + has fields → ON CONFLICT DO UPDATE
 *   3. year known + no fields  → ON CONFLICT DO NOTHING + lookup
 *
 * The upsert key is (scrapedTitle, scrapedYear) — NOT (scrapedTitle, year).
 * The films table has both a `year` column (mutable; enrichment writes the
 * TMDB-resolved year here) and a `scraped_year` column (immutable after
 * insert; what the scraper first emitted). Keying the upsert on the
 * immutable scraped_year is what keeps re-scrapes finding the existing
 * row even after enrichment has filled in `year`. See
 * project_afiche_mutable_key_upsert_bug for the bug this fixes.
 *
 * Some providers (MALBA S2 single-event pages) only know the film title —
 * every metadata field is undefined. Drizzle's mapUpdateSet strips undefined
 * keys at SQL-build time and throws "No values to set" on an empty set
 * clause, which would blow up the whole ingest. Branch 3 is the workaround.
 *
 * country intentionally NOT taken from the scraper. Venue FICHA TÉCNICA
 * text is locale-dirty ("EE.UU", "República Checa, Eslovaquia y Hungría"
 * for co-productions, full-name "Argentina" instead of ISO "AR") which
 * poisons the column for filtering. TMDB's `iso_3166_1` is the canonical
 * 2-letter ISO source. Trade-off: films that never match TMDB will have
 * country=NULL forever (or until manually patched). At ~5-10 unmatched
 * films out of ~110 in the catalog, that's an acceptable price for a
 * clean, filterable column.
 */
async function upsertFilmRow(s: ScrapedScreening): Promise<UpsertResult> {
  const insertValues: FilmInsert = {
    title: s.filmTitle,
    scrapedTitle: s.filmTitle,
    titleOriginal: s.filmTitleOriginal,
    director: s.director,
    year: s.year,
    // Immutable record of what the scraper saw on this insert. Never
    // touched on subsequent updates — the (scrapedTitle, scrapedYear)
    // pair must remain stable for the upsert to be idempotent across
    // re-scrapes. enrichment.ts may freely update `year` (e.g.
    // null → 2025 when TMDB resolves a year-less row) without breaking
    // re-scrape lookup.
    scrapedYear: s.year,
    runtimeMin: s.runtimeMin,
    synopsisEs: s.synopsisEs,
    matchSource: 'none',
    slug: null,
  };
  const updateSet = buildUpdateSet(s);

  if (s.year === undefined) {
    return upsertYearlessFilm(s, insertValues, updateSet);
  }

  if (Object.keys(updateSet).length > 0) {
    const [row] = await db
      .insert(films)
      .values(insertValues)
      .onConflictDoUpdate({
        target: [films.scrapedTitle, films.scrapedYear],
        set: updateSet,
      })
      .returning({ id: films.id, slug: films.slug });
    return { filmId: row?.id, existingSlug: row?.slug ?? null };
  }

  // Branch 3: nothing to refresh, year known. Insert if new, otherwise leave
  // the existing row alone and look its id up. onConflictDoNothing +
  // .returning() omits the row when the insert was a no-op, hence the
  // SELECT fallback.
  const [inserted] = await db
    .insert(films)
    .values(insertValues)
    .onConflictDoNothing()
    .returning({ id: films.id, slug: films.slug });
  if (inserted) {
    return { filmId: inserted.id, existingSlug: inserted.slug ?? null };
  }
  const [existing] = await db
    .select({ id: films.id, slug: films.slug })
    .from(films)
    .where(and(eq(films.scrapedTitle, s.filmTitle), eq(films.scrapedYear, s.year)))
    .limit(1);
  return { filmId: existing?.id, existingSlug: existing?.slug ?? null };
}

/**
 * Year-NULL branch. SQLite treats NULL as distinct in unique indexes:
 * NULL == NULL is NULL, not TRUE, so the (scraped_title, scraped_year)
 * unique constraint never fires for two NULL-scraped-year rows with the
 * same title. Without this app-level dedup, every scrape that emits a
 * year-less screening (e.g., Lugones detail pages where the year
 * couldn't be parsed) would create a new orphan film row, and downstream
 * the cartelera would render one card per row.
 *
 * The lookup is keyed on `scraped_year IS NULL`, NOT `year IS NULL`.
 * That's the whole point of the column split: enrichment may have
 * filled in `year` from TMDB, but `scraped_year` stays at NULL forever
 * (it's what the scraper saw, not what we now believe). Matching on
 * `scraped_year IS NULL` finds the row regardless of whether `year`
 * has been resolved. Pre-fix, this lookup keyed on `year IS NULL` and
 * would miss any row whose year had been resolved by enrichment —
 * causing the manual-patch tmdb_id loss bug from 2026-05-05.
 */
async function upsertYearlessFilm(
  s: ScrapedScreening,
  insertValues: FilmInsert,
  updateSet: Record<string, unknown>,
): Promise<UpsertResult> {
  const [existing] = await db
    .select({ id: films.id, slug: films.slug })
    .from(films)
    .where(and(eq(films.scrapedTitle, s.filmTitle), isNull(films.scrapedYear)))
    .limit(1);
  if (existing) {
    if (Object.keys(updateSet).length > 0) {
      await db.update(films).set(updateSet).where(eq(films.id, existing.id));
    }
    return { filmId: existing.id, existingSlug: existing.slug ?? null };
  }
  const [inserted] = await db
    .insert(films)
    .values(insertValues)
    .returning({ id: films.id, slug: films.slug });
  return { filmId: inserted?.id, existingSlug: inserted?.slug ?? null };
}

/**
 * Build the ON CONFLICT DO UPDATE set clause from a scraped row. Only
 * fields the scraper actually defined go in — Drizzle's mapUpdateSet
 * strips undefineds and throws on an empty set, so we own the filter here.
 */
function buildUpdateSet(s: ScrapedScreening): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  if (s.filmTitleOriginal !== undefined) set.titleOriginal = s.filmTitleOriginal;
  if (s.director !== undefined) set.director = s.director;
  if (s.runtimeMin !== undefined) set.runtimeMin = s.runtimeMin;
  if (s.synopsisEs !== undefined) set.synopsisEs = s.synopsisEs;
  return set;
}

/**
 * Set the slug on a film row that doesn't have one yet. On UNIQUE collision
 * (different film already owns this slug — re-releases, festival cuts),
 * retry with the `-<id>` tiebreaker. The id-suffixed slug is guaranteed
 * unique because films.id is unique.
 */
async function ensureFilmSlug(
  filmId: number,
  title: string,
  year: number | undefined,
): Promise<void> {
  const base = buildFilmSlug(title, { year: year ?? null, id: filmId });
  try {
    await db.update(films).set({ slug: base }).where(eq(films.id, filmId));
  } catch (err) {
    if (isSlugUniqueViolation(err)) {
      const tieslug = withIdSuffix(base, filmId);
      await db.update(films).set({ slug: tieslug }).where(eq(films.id, filmId));
    } else {
      throw err;
    }
  }
}

/**
 * Consolidate the loser film row INTO the winner. Used by:
 *   - the enrichment loop's mergeIfTmdbIdCollides when two rows resolve to
 *     the same TMDB id (cross-provider duplicates, VLM drift, year-null
 *     legacy)
 *   - the one-shot dedupe-films cleanup script for existing duplicates
 *     that aren't in the enrichment-pending pool
 *
 * Two-step shape:
 *   - UPDATE OR IGNORE re-points screenings. Conflicts on the (film_id,
 *     cinema_id, starts_at_utc) unique index leave the loser's screening
 *     row in place — those are then dropped by step two's cascade.
 *   - DELETE on films cascades to any leftover screenings via
 *     onDelete: 'cascade' (schema.ts:226).
 *
 *   NOTE on UPDATE OR IGNORE: today the only constraint that can fire is
 *   the (film_id, cinema_id, starts_at_utc) unique index. A future
 *   migration that adds another constraint (CHECK, additional FK) could
 *   silently drop screenings via this clause. If you add such a
 *   constraint, audit this merge logic.
 *
 * Atomicity trade-off (known): the two statements are NOT wrapped in a
 * `db.transaction()`. libSQL `:memory:` connections (used by the test
 * helper) don't share state with the transaction sub-client, which would
 * break ~10 tests. In prod (libSQL HTTP / file-backed) a transaction
 * would be safe; here the test cost outweighs the defense. The window
 * where a mid-crash leaves screenings reparented but the loser film row
 * alive is microseconds long. If it ever fires, the next scrape re-merges
 * the residual loser via mergeIfTmdbIdCollides — self-healing. Worth a
 * proper transaction once the test helper is upgraded to use shared-cache
 * in-memory mode (`file::memory:?cache=shared`) or temp files.
 *
 * Slug invariant: the winner's slug is preserved; the loser's slug is
 * freed by the DELETE. URL contract holds — `/pelicula/<winner-slug>`
 * keeps working, `/pelicula/<loser-slug>` 404s. This is intentional; the
 * winner is the older row by id (first to receive a slug = canonical).
 *
 * Best-effort warning push: if `warnings` is provided, the merge appends
 * a human-readable line for run-log surfacing. The string format is
 * deliberately stable across call sites (enrichment + dedupe script) so
 * downstream tooling can grep for "merged film" uniformly.
 */
export async function mergeFilmInto(
  loserId: number,
  winnerId: number,
  warnings?: string[],
): Promise<void> {
  await db.run(sql`
    UPDATE OR IGNORE screenings
    SET film_id = ${winnerId}
    WHERE film_id = ${loserId}
  `);
  await db.delete(films).where(eq(films.id, loserId));
  warnings?.push(`merged film ${loserId} into existing id=${winnerId}`);
}
