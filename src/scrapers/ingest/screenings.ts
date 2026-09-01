/**
 * Screenings replace pass — per cinema, atomically:
 *   1. delete future screenings (preserve historical rows)
 *   2. insert the new ones, with onConflictDoUpdate to refresh metadata
 *
 * Done BEFORE TMDB enrichment on purpose. `enrichPendingFilms` may merge
 * duplicate film rows (collapsing a year-less or wrong-year row into an
 * existing enriched one), and the merge deletes the losing row. If
 * enrichment ran first, the film_ids in our `filmIdByKey` map could point
 * at rows the merge just deleted — FOREIGN KEY violation on screening
 * INSERT. With this order, screenings land first, and the merge's own
 * `UPDATE screenings SET film_id = existingId WHERE film_id = f.id`
 * re-points them to the surviving row safely.
 */

import { and, count, eq, gt, sql } from 'drizzle-orm';
import { db, screenings } from '@/db';
import type { ScrapedScreening } from '@/providers/types';
import { filmKey } from './films';

export interface ReplaceScreeningsResult {
  inserted: number;
  /** True when the breaker fired: an empty fetch was refused to protect a live schedule. */
  circuitBroke: boolean;
  /** Future rows left intact when circuitBroke; 0 otherwise. */
  preservedFuture: number;
}

/**
 * Replace future screenings for a cinema with the freshly-scraped set.
 *
 * Pre-write circuit breaker: the delete+insert would wipe the live schedule, so
 * a scraper that silently breaks (returns 0) could publish an empty venue. When
 * the fetch is empty AND future rows exist, refuse the replace, keep the last
 * good schedule, and report circuitBroke so the caller warns. Empty-only on
 * purpose — a smaller-but-nonzero fetch is ambiguous (a winding-down cycle looks
 * like a half-broken scraper), so partial drops stay the audit's soft FYI.
 *
 * `now` is passed in so a test can control the freeze point.
 */
export async function replaceFutureScreenings(
  cinemaId: string,
  now: Date,
  scraped: ScrapedScreening[],
  filmIdByKey: Map<string, number>,
): Promise<ReplaceScreeningsResult> {
  if (scraped.length === 0) {
    // Empty fetch — break only if wiping would destroy a live schedule.
    const [{ n }] = await db
      .select({ n: count() })
      .from(screenings)
      .where(and(eq(screenings.cinemaId, cinemaId), gt(screenings.startsAtUtc, now)));
    if (n > 0) return { inserted: 0, circuitBroke: true, preservedFuture: n };
    return { inserted: 0, circuitBroke: false, preservedFuture: 0 };
  }

  // Clear existing future screenings for this cinema. Keeps historical
  // rows so we never wipe past programming once we have any.
  await db
    .delete(screenings)
    .where(and(eq(screenings.cinemaId, cinemaId), gt(screenings.startsAtUtc, now)));

  const toInsert = scraped
    .map((s) => buildScreeningRow(s, filmIdByKey))
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (toInsert.length === 0) {
    return { inserted: 0, circuitBroke: false, preservedFuture: 0 };
  }

  // onConflictDoUpdate (NOT DoNothing) so re-scrape refreshes metadata that
  // may have changed: programName, sourceUrl, tags, scrapedAt. Without
  // DoUpdate, the back half of multi-week Lugones programs would never get
  // programName populated post-migration — the (filmId, cinemaId,
  // startsAtUtc) row already exists from a prior scrape, so DoNothing
  // would skip the update.
  //
  // Defensive subset of fields: do NOT include identity columns (filmId,
  // cinemaId, startsAtUtc — these are the conflict target). `excluded.X`
  // pulls the value from the row we just tried to insert.
  await db
    .insert(screenings)
    .values(toInsert)
    .onConflictDoUpdate({
      target: [screenings.filmId, screenings.cinemaId, screenings.startsAtUtc],
      set: {
        programName: sql`excluded.program_name`,
        sourceUrl: sql`excluded.source_url`,
        tags: sql`excluded.tags`,
        scrapedAt: sql`excluded.scraped_at`,
      },
    });

  return { inserted: toInsert.length, circuitBroke: false, preservedFuture: 0 };
}

/**
 * Build one screening insert row from a scraped record. Returns null when
 * the film row couldn't be resolved (defensive — shouldn't happen because
 * `upsertFilms` runs first, but better to drop the row than crash the
 * batch insert).
 */
function buildScreeningRow(s: ScrapedScreening, filmIdByKey: Map<string, number>) {
  const key = filmKey(s.filmTitle, s.year);
  const filmId = filmIdByKey.get(key);
  if (!filmId) return null;

  return {
    filmId,
    cinemaId: s.cinemaId,
    startsAtUtc: s.startsAtUtc,
    tags: s.tags,
    sourceUrl: s.sourceUrl,
    programName: filterEchoingProgramName(s.programName, s.filmTitle),
  };
}

/**
 * No-echo filter: when programName equals filmTitle (case-insensitive,
 * whitespace-collapsed), drop it. A pill that just repeats the film title
 * adds zero curatorial signal and clutters the card. Applies uniformly
 * across all providers — Lugones S2 single-film pages, MALBA listings
 * where the cycle wraps one film, etc.
 */
function filterEchoingProgramName(
  programName: string | null | undefined,
  filmTitle: string,
): string | null {
  if (programName == null) return null;
  if (normalizeForEcho(programName) === normalizeForEcho(filmTitle)) return null;
  return programName;
}

/**
 * Normalize for the echo check: lowercase + collapse whitespace + trim.
 * Catches "El Faro" vs "el faro" and "Pizza, Birra, Faso" vs
 * "Pizza,  Birra,  Faso" — both editorially the same.
 */
function normalizeForEcho(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}
