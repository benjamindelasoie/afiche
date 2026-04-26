/**
 * Query helpers for the Afiche cartelera view.
 *
 * The home page splits screenings into three chronological tiers:
 *
 *   1. "Esta semana"    — today 00:00 BA .. next ISO Monday 00:00 BA
 *                          (1-7 days)
 *   2. "Próxima semana" — next ISO Monday 00:00 BA .. Monday-after-next
 *                          00:00 BA (always 7 days)
 *   3. "Más adelante"   — Monday-after-next 00:00 BA, open-ended
 *
 * Tiers 2 and 3 used to be calendar-month anchored ("este mes" upper =
 * start of next month). That created an end-of-month edge case where a
 * screening one day out (e.g., April 30 → May 1) would render in Tier
 * 3 "Próximamente" rather than Tier 2 — counterintuitive. ISO-week
 * chained tiers fix that.
 *
 * Each tier has its own query; the page composes them. Tier 1 returns
 * grouped-by-day (the dense decision layer); tier 2 returns grouped-by-day
 * (still useful for planning); tier 3 returns a flat chronological list
 * (rendered as a compressed text index — days aren't load-bearing here).
 *
 * All functions run on the server (Server Components) and return plain data.
 */

import { and, eq, gt, gte, lt, asc, desc, sql } from 'drizzle-orm';
import { db, screenings, films, cinemas, scrapeRuns } from './index';
import type { CastMember, ScreeningTag } from './schema';
import {
  getTodayStartBA,
  getNextIsoMondayBA,
  getStartOfWeekAfterNextBA,
} from '@/lib/date-ranges';

export interface ScreeningRow {
  id: number;
  startsAtUtc: Date;
  tags: ScreeningTag[];
  sourceUrl: string | null;
  /**
   * Curatorial program / cycle the screening belongs to (e.g.,
   * "Retrospectiva David Lynch", "Olivera-Aries"). Null when the venue
   * doesn't organize screenings into curated programs (Cosmos) or when
   * the program would just echo the film title (filtered at ingest).
   * Render rule: ProgramPill renders only when non-null.
   */
  programName: string | null;
  film: {
    id: number;
    title: string;
    titleOriginal: string | null;
    director: string | null;
    year: number | null;
    country: string | null;
    runtimeMin: number | null;
    synopsisEs: string | null;
    posterUrl: string | null;
    /** URL slug for /pelicula/<slug> link target. Always populated post-backfill. */
    slug: string | null;
    /** Top-billed TMDB cast (up to 8). Null pre-enrichment, [] when TMDB had no credits. */
    cast: CastMember[] | null;
    /** TMDB genre IDs. Null pre-enrichment, [] when TMDB had no genres. Resolve to labels via GENRE_LABELS_ES. */
    genres: number[] | null;
  };
  cinema: {
    id: string;
    name: string;
    neighborhood: string | null;
    type: 'indie' | 'chain';
  };
}

export interface DayGroup {
  dateKey: string; // 'YYYY-MM-DD' in BA time — stable grouping key
  label: string; // e.g. 'martes 19 de abril'
  isToday: boolean;
  screenings: ScreeningRow[];
}

// ---------------------------------------------------------------------------
// Shared row shaper + grouper
// ---------------------------------------------------------------------------

interface BoundedQuery {
  lower: Date;
  /** Exclusive upper bound. Omit for open-ended (próximamente). */
  upper?: Date;
  /**
   * Optional film-id filter. When set, the query only returns screenings
   * for that film (used by /pelicula/<slug> for the cross-venue
   * upcoming-screenings list). When omitted, all films are included
   * (cartelera tier queries).
   */
  filmId?: number;
}

async function fetchRows({
  lower,
  upper,
  filmId,
}: BoundedQuery): Promise<ScreeningRow[]> {
  const conditions = [gte(screenings.startsAtUtc, lower)];
  if (upper) conditions.push(lt(screenings.startsAtUtc, upper));
  if (filmId !== undefined) conditions.push(eq(screenings.filmId, filmId));
  const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

  const rows = await db
    .select({
      screening: screenings,
      film: films,
      cinema: cinemas,
    })
    .from(screenings)
    .innerJoin(films, eq(screenings.filmId, films.id))
    .innerJoin(cinemas, eq(screenings.cinemaId, cinemas.id))
    .where(whereClause)
    .orderBy(asc(screenings.startsAtUtc));

  return rows.map((row) => ({
    id: row.screening.id,
    startsAtUtc: row.screening.startsAtUtc,
    tags: row.screening.tags,
    sourceUrl: row.screening.sourceUrl,
    programName: row.screening.programName ?? null,
    film: {
      id: row.film.id,
      title: row.film.title,
      titleOriginal: row.film.titleOriginal,
      director: row.film.director,
      year: row.film.year,
      country: row.film.country,
      runtimeMin: row.film.runtimeMin,
      synopsisEs: row.film.synopsisEs,
      posterUrl: row.film.posterUrl,
      slug: row.film.slug ?? null,
      cast: row.film.cast ?? null,
      genres: row.film.genres ?? null,
    },
    cinema: {
      id: row.cinema.id,
      name: row.cinema.name,
      neighborhood: row.cinema.neighborhood,
      type: row.cinema.type,
    },
  }));
}

function groupByDay(rows: ScreeningRow[], now: Date): DayGroup[] {
  const today = formatDateKeyBA(now);
  const groups = new Map<string, DayGroup>();
  for (const s of rows) {
    const dateKey = formatDateKeyBA(s.startsAtUtc);
    if (!groups.has(dateKey)) {
      groups.set(dateKey, {
        dateKey,
        label: formatDayLabel(s.startsAtUtc),
        isToday: dateKey === today,
        screenings: [],
      });
    }
    groups.get(dateKey)!.screenings.push(s);
  }
  return Array.from(groups.values());
}

// ---------------------------------------------------------------------------
// Tier queries
// ---------------------------------------------------------------------------

/**
 * Tier 1 — "Esta semana". All screenings from today 00:00 BA through the
 * end of the current ISO week (exclusive upper bound = next Monday 00:00 BA).
 * Grouped by day.
 */
export async function getThisWeekScreenings(now: Date = new Date()): Promise<DayGroup[]> {
  const lower = getTodayStartBA(now);
  const upper = getNextIsoMondayBA(now);
  const rows = await fetchRows({ lower, upper });
  return groupByDay(rows, now);
}

/**
 * Tier 2 — "Próxima semana". Screenings between next ISO Monday and the
 * Monday after next, i.e. the full 7-day next ISO week. Always 7 days
 * regardless of when in the current week `now` falls.
 */
export async function getNextWeekScreenings(now: Date = new Date()): Promise<DayGroup[]> {
  const lower = getNextIsoMondayBA(now);
  const upper = getStartOfWeekAfterNextBA(now);
  const rows = await fetchRows({ lower, upper });
  return groupByDay(rows, now);
}

/**
 * Latest successful scrape run across all cinemas. Returns the Date the
 * most recent success finished at, or null if no successful run exists
 * yet (fresh DB, all failures, or in-progress-only).
 *
 * Rendered in the footer as "Actualizado el DD de MMMM a las HH:MM" so
 * users know how fresh the cartelera is. Silence-rather-than-lie: when
 * there's no successful run, render nothing — same pattern as the earlier
 * F-004 footer cleanup.
 */
export async function getLastScrapeTime(): Promise<Date | null> {
  const [row] = await db
    .select({ finishedAt: scrapeRuns.finishedAt })
    .from(scrapeRuns)
    .where(eq(scrapeRuns.status, 'success'))
    .orderBy(desc(scrapeRuns.finishedAt))
    .limit(1);
  return row?.finishedAt ?? null;
}

/**
 * Tier 3 — "Más adelante". Everything from Monday-after-next onward.
 * Boundary aligns with Tier 2's upper, so a given screening lands in
 * exactly one tier.
 *
 * Returns a flat chronological list. The page renders this as a compressed
 * text index; day grouping isn't load-bearing at this horizon because each
 * row carries its own date.
 */
export async function getUpcomingScreenings(
  now: Date = new Date(),
): Promise<ScreeningRow[]> {
  const lower = getStartOfWeekAfterNextBA(now);
  return fetchRows({ lower });
}

/**
 * Per-film MAX(startsAtUtc) over the FULL screenings table — unbounded
 * by the cartelera's tier horizons. Returns a Map<filmId, lastUtcMs>.
 *
 * Used to compute the ÚLTIMA FUNCIÓN pill on cartelera cards. The
 * unbounded query is non-negotiable: if we computed against the bounded
 * tier queries, a film with a screening this Saturday AND another in 8
 * weeks (outside the cartelera horizon) would get a false ÚLTIMA FUNCIÓN
 * pill on Saturday — the 8-week screening wouldn't be in the row union
 * the bounded computation could see. Outside-voice catch on the
 * programs+/pelicula/ plan, locked into the design as a must-have
 * regression check.
 *
 * Filters to `startsAtUtc > now()`: a "last function" pill flag should
 * only flip ON for films whose FUTURE last screening is the one being
 * rendered. Films that have already finished their entire run aren't
 * candidates (they wouldn't be on the cartelera anyway, since cartelera
 * tier queries are also `> now()`).
 *
 * Returns Unix-millisecond numbers (not Dates) for cheap === comparison
 * downstream — JavaScript Date equality is reference equality, which
 * doesn't work for the per-row pill check.
 */
export async function getLastScreeningPerFilm(
  now: Date = new Date(),
): Promise<Map<number, number>> {
  const rows = await db
    .select({
      filmId: screenings.filmId,
      maxStarts: sql<number>`MAX(${screenings.startsAtUtc})`,
    })
    .from(screenings)
    .where(gt(screenings.startsAtUtc, now))
    .groupBy(screenings.filmId);

  // SQLite's `timestamp` mode stores Unix seconds; the `MAX` aggregate
  // returns the same epoch-seconds integer. Multiply by 1000 to get the
  // milliseconds shape Date.getTime() returns.
  const result = new Map<number, number>();
  for (const r of rows) {
    if (typeof r.maxStarts === 'number') {
      result.set(r.filmId, r.maxStarts * 1000);
    }
  }
  return result;
}

/**
 * Look up a film by slug, plus all of today's + upcoming screenings of
 * that film across every BA venue. Used by /pelicula/<slug>.
 *
 * Returns null when the slug doesn't exist OR when the film has no
 * screenings from today onwards. /pelicula/ resolves only when both
 * conditions are met (per design doc 2026-04-25): the page's existence
 * depends on the killer feature (cross-venue upcoming list) being
 * satisfiable. Otherwise notFound() → custom 404.
 *
 * Lower bound is `getTodayStartBA(now)` — the start of today in BA.
 * That includes screenings that already started today; the page marks
 * them as past in the UI (B&W poster, "Ya empezó" pill) so users see
 * them but don't tap them. Symmetry with the home cartelera, which
 * also shows today's full programming: tapping a card on the home
 * page must lead somewhere consistent, never to a 404.
 *
 * Returned rows are ordered by startsAtUtc ASC (chronological). The
 * page renders próxima función first; the LAST row is the candidate
 * for the ÚLTIMA FUNCIÓN signal (computed against the unbounded
 * `getLastScreeningPerFilm` map at render time, NOT this list — this
 * list is pelicula-page-bounded but última función needs the truth).
 */
export async function getUpcomingScreeningsByFilm(
  slug: string,
  now: Date = new Date(),
): Promise<{ film: ScreeningRow['film']; screenings: ScreeningRow[] } | null> {
  const [filmRow] = await db
    .select({ id: films.id })
    .from(films)
    .where(eq(films.slug, slug))
    .limit(1);
  if (!filmRow) return null;

  const lower = getTodayStartBA(now);
  const rows = await fetchRows({ lower, filmId: filmRow.id });
  if (rows.length === 0) return null;

  // Pull the film metadata off the first row — it's identical across all
  // rows for a given filmId by construction (the JOIN guarantees this).
  return {
    film: rows[0].film,
    screenings: rows,
  };
}

// ---------------------------------------------------------------------------
// Date formatting helpers — always in America/Argentina/Buenos_Aires
// ---------------------------------------------------------------------------

const BA_TZ = 'America/Argentina/Buenos_Aires';

function formatDateKeyBA(d: Date): string {
  // Returns 'YYYY-MM-DD' as seen in Buenos Aires (stable grouping key)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;
  return `${year}-${month}-${day}`;
}

function formatDayLabel(d: Date): string {
  // e.g. "martes 19 de abril"
  //
  // Build the parts manually instead of using a single formatted string —
  // es-AR's default "weekday, day de month" injects a comma we don't want
  // ("jueves, 23 de abril" reads clunky when uppercased in the banner).
  const fmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: BA_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const parts = fmt.formatToParts(d);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  return `${weekday} ${day} de ${month}`;
}

export function formatTimeBA(d: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: BA_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/**
 * "23 Abr" short day label for the Tier 3 text index where each row
 * carries its own date chip.
 */
export function formatDayShortBA(d: Date): string {
  const fmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: BA_TZ,
    day: 'numeric',
    month: 'short',
  });
  const parts = fmt.formatToParts(d);
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  let month = parts.find((p) => p.type === 'month')?.value ?? '';
  month = month.replace(/\.$/, '');
  month = month.charAt(0).toUpperCase() + month.slice(1);
  return `${day} ${month}`;
}
