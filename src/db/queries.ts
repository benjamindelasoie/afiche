/**
 * Query helpers for the Afiche cartelera views.
 *
 * Two surfaces consume these:
 *
 *   1. The HOMEPAGE (`/`) — window-scoped, GROUP-BY-FILM (redesign 2026-06-06).
 *      `getWindowScreeningsByFilm` returns FilmGroup[] for a selected window
 *      (hoy/finde/semana/prox); `getFeaturedFilms` derives the curated band;
 *      `getJsonLdScreenings` feeds the 7-day JSON-LD.
 *   2. `/cartelera` — the exhaustive DAY-GROUPED view (the old homepage,
 *      relocated). `getTwoWeeksScreenings` (14-day rolling, grouped by day,
 *      navigated by the sticky date strip) + `getUpcomingScreenings`
 *      ("Próximamente", week-grouped, open-ended).
 *
 * History: the day-grouped model was a 3-tier ISO-week layout, consolidated
 * 2026-05 to the 14-day rolling window (DESIGN.md Decisions Log 2026-05-02),
 * then in 2026-06 the homepage moved to the group-by-film view above and the
 * 14-day day view moved to `/cartelera` (GitHub issue #17).
 *
 * All functions run on the server (Server Components) and return plain data.
 */

import { cache } from 'react';
import { and, eq, gt, gte, lt, asc, desc, sql } from 'drizzle-orm';
import { db, screenings, films, cinemas, scrapeRuns } from './index';
import type { CastMember, ScreeningTag } from './schema';
import {
  getTodayStartBA,
  getEndOfTwoWeeksBA,
  getIsoWeekStartBA,
  isScreeningExpired,
  BA_TZ,
} from '@/lib/date-ranges';
import { getWindowDef, type WindowKey } from '@/lib/windows';
import { displayFilmTitle } from '@/lib/title-case';
import { slugify } from '@/lib/slug';

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
    /** 16:9 cinematic still from TMDB. Null until enriched, or when TMDB has no backdrop. */
    backdropUrl: string | null;
    /** URL slug for /pelicula/<slug> link target. Always populated post-backfill. */
    slug: string | null;
    /** Top-billed TMDB cast (up to 8). Null pre-enrichment, [] when TMDB had no credits. */
    cast: CastMember[] | null;
    /** TMDB genre IDs. Null pre-enrichment, [] when TMDB had no genres. Resolve to labels via GENRE_LABELS_ES. */
    genres: number[] | null;
    /** TMDB popularity (recency/buzz). Null pre-enrichment. Ranks featured slots. */
    popularity: number | null;
    /** TMDB vote average (0-10). Null pre-enrichment. */
    voteAverage: number | null;
    /** TMDB vote count (notability). Null pre-enrichment. Ranks the classic slot. */
    voteCount: number | null;
    /** When the film row first entered the DB (first-seen). Drives "nuevo en cartelera". */
    createdAt: Date;
  };
  cinema: {
    id: string;
    name: string;
    neighborhood: string | null;
    /**
     * Street address, when known. Nullable because seed data backfilled
     * addresses on a venue-by-venue cadence; some cinemas still have it
     * blank. Consumed by JSON-LD's MovieTheater.address (omits when null).
     */
    address: string | null;
    type: 'indie' | 'chain';
  };
}

export interface DayGroup {
  dateKey: string; // 'YYYY-MM-DD' in BA time — stable grouping key
  label: string; // e.g. 'martes 19 de abril'
  isToday: boolean;
  screenings: ScreeningRow[];
}

export interface WeekGroup {
  /** YYYY-MM-DD of the Monday of this ISO week, in BA — stable grouping key. */
  weekKey: string;
  /** "Semana del 19 al 25 de mayo" or "Semana del 28 de abril al 4 de mayo". */
  label: string;
  screenings: ScreeningRow[];
}

// ---------------------------------------------------------------------------
// Shared row shaper + grouper
// ---------------------------------------------------------------------------

interface BoundedQuery {
  lower: Date;
  /** Exclusive upper bound. Omit for open-ended (próximamente). */
  upper?: Date;
  /** Optional film-id filter — used by /pelicula/<slug>. */
  filmId?: number;
  /** Optional cinema-id filter — used by /sala/<id>. */
  cinemaId?: string;
}

// Request-scoped memoization. The homepage render calls fetchRows with the SAME
// [todayStart, +7d) bounds up to 3× per render (getFeaturedFilms,
// getJsonLdScreenings, and getWindowScreeningsByFilm('semana')). React cache()
// dedups them within a single render. Keyed on PRIMITIVES (epoch ms + ids)
// because cache() compares args with Object.is — fresh Date/option objects
// would never hit. cache() is per-request only, so this never serves stale data
// and is compatible with the page's force-dynamic freshness.
const fetchRowsCached = cache(
  async (
    lowerMs: number,
    upperMs: number | null,
    filmId: number | null,
    cinemaId: string | null,
  ): Promise<ScreeningRow[]> => {
    const lower = new Date(lowerMs);
    const upper = upperMs === null ? undefined : new Date(upperMs);

    const conditions = [gte(screenings.startsAtUtc, lower)];
    if (upper) conditions.push(lt(screenings.startsAtUtc, upper));
    if (filmId !== null) conditions.push(eq(screenings.filmId, filmId));
    if (cinemaId !== null) conditions.push(eq(screenings.cinemaId, cinemaId));
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
        // Render-ready: smart-cased for unmatched all-caps titles, otherwise
        // verbatim. The DB column stays raw; see src/lib/title-case.ts.
        title: displayFilmTitle(row.film),
        titleOriginal: row.film.titleOriginal,
        director: row.film.director,
        year: row.film.year,
        country: row.film.country,
        runtimeMin: row.film.runtimeMin,
        synopsisEs: row.film.synopsisEs,
        posterUrl: row.film.posterUrl,
        backdropUrl: row.film.backdropUrl,
        slug: row.film.slug ?? null,
        cast: row.film.cast ?? null,
        genres: row.film.genres ?? null,
        popularity: row.film.popularity ?? null,
        voteAverage: row.film.voteAverage ?? null,
        voteCount: row.film.voteCount ?? null,
        createdAt: row.film.createdAt,
      },
      cinema: {
        id: row.cinema.id,
        name: row.cinema.name,
        neighborhood: row.cinema.neighborhood,
        address: row.cinema.address,
        type: row.cinema.type,
      },
    }));
  },
);

async function fetchRows({
  lower,
  upper,
  filmId,
  cinemaId,
}: BoundedQuery): Promise<ScreeningRow[]> {
  return fetchRowsCached(
    lower.getTime(),
    upper?.getTime() ?? null,
    filmId ?? null,
    cinemaId ?? null,
  );
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

/**
 * Group a flat ScreeningRow list by ISO week. Each group's `weekKey` is
 * the Monday-of-the-week as YYYY-MM-DD (BA), used as a stable React key.
 * The label is "Semana del DD al DD de Month" or, when the week crosses
 * a month boundary, "Semana del DD de Month al DD de Month2".
 *
 * Multi-week cycles (e.g., MALBA Continúa films): each individual screening
 * lands in the week it falls in, so a film with screenings on May 19 + May
 * 26 appears once under each week. That's correct — the user is asking
 * "what's on this week" per week, not "what films appear at all."
 *
 * Note: a screening on, say, May 17 (Saturday) belongs to the ISO week
 * starting Monday May 12. We compute that via getIsoWeekStartBA which
 * handles the BA-tz weekday lookup correctly across DST-free Argentina.
 */
function groupByWeek(rows: ScreeningRow[]): WeekGroup[] {
  const groups = new Map<string, WeekGroup>();
  for (const s of rows) {
    const monday = getIsoWeekStartBA(s.startsAtUtc);
    const sunday = new Date(monday.getTime() + 6 * 86_400_000);
    const weekKey = formatDateKeyBA(monday);
    if (!groups.has(weekKey)) {
      groups.set(weekKey, {
        weekKey,
        label: formatWeekLabel(monday, sunday),
        screenings: [],
      });
    }
    groups.get(weekKey)!.screenings.push(s);
  }
  return Array.from(groups.values());
}

// ---------------------------------------------------------------------------
// Tier queries
// ---------------------------------------------------------------------------

/**
 * Tier 1 — 14-day rolling cartelera. All screenings from today 00:00 BA
 * through today+14 00:00 BA (exclusive upper). Grouped by day. Today is
 * always the first day group; the 14th day is always the last.
 *
 * Replaces the previous `getThisWeekScreenings` (1-7 days, ISO-week-bounded)
 * and `getNextWeekScreenings` (8-14 days, ISO-week-bounded) — consolidated
 * 2026-05-02 because the date strip on the page lets users one-tap-jump to
 * any day in the window, so the editorial-week boundary stopped earning its
 * UX cost. BA-midnight lower bound preserved (Sunday-late edge intact).
 */
export async function getTwoWeeksScreenings(now: Date = new Date()): Promise<DayGroup[]> {
  const lower = getTodayStartBA(now);
  const upper = getEndOfTwoWeeksBA(now);
  const rows = await fetchRows({ lower, upper });
  // Always return exactly 14 day groups, including days with zero
  // screenings — the date strip needs every day in the rolling window
  // (so chips for quiet Tuesdays still render and anchor-jump correctly,
  // landing on an editorial empty-day banner per design-review D3).
  return fillTwoWeeks(groupByDay(rows, now), lower, now);
}

/**
 * Pad a partial day-group list out to all 14 days of the rolling window.
 * Days that the underlying query returned no rows for get an empty
 * DayGroup ({ dateKey, label, isToday, screenings: [] }). The rendering
 * layer surfaces the empty state with an editorial "Hoy las salas
 * descansan" banner.
 */
function fillTwoWeeks(groups: DayGroup[], lower: Date, now: Date): DayGroup[] {
  const today = formatDateKeyBA(now);
  const groupsByKey = new Map(groups.map((g) => [g.dateKey, g]));
  const result: DayGroup[] = [];
  for (let i = 0; i < 14; i++) {
    const dayInstant = new Date(lower.getTime() + i * 86_400_000);
    const dateKey = formatDateKeyBA(dayInstant);
    const existing = groupsByKey.get(dateKey);
    if (existing) {
      result.push(existing);
    } else {
      result.push({
        dateKey,
        label: formatDayLabel(dayInstant),
        isToday: dateKey === today,
        screenings: [],
      });
    }
  }
  return result;
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
 * Tier 2 — "Próximamente". Everything from today+14 00:00 BA onward.
 * Boundary aligns with `getTwoWeeksScreenings` upper, so a screening lands
 * in exactly one tier.
 *
 * Returns week-grouped (Monday-of-ISO-week as the bucket key). The page
 * renders this as a text index with one banner per week ("Semana del 19
 * al 25 de mayo") + chronological rows beneath. Week-grouping is denser
 * and more skimmable than per-day banners at this 4-8-week horizon.
 */
export async function getUpcomingScreenings(
  now: Date = new Date(),
): Promise<WeekGroup[]> {
  const lower = getEndOfTwoWeeksBA(now);
  const rows = await fetchRows({ lower });
  return groupByWeek(rows);
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

/**
 * Single-screening lookup by primary key. Returns the joined Screening +
 * Film + Cinema shape so callers (currently the .ics route) can render
 * title/director/runtime/venue from one DB hit. Returns null for unknown
 * IDs — the caller maps that to 404.
 */
export async function getScreeningById(id: number): Promise<ScreeningRow | null> {
  const rows = await db
    .select({
      screening: screenings,
      film: films,
      cinema: cinemas,
    })
    .from(screenings)
    .innerJoin(films, eq(screenings.filmId, films.id))
    .innerJoin(cinemas, eq(screenings.cinemaId, cinemas.id))
    .where(eq(screenings.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.screening.id,
    startsAtUtc: row.screening.startsAtUtc,
    tags: row.screening.tags,
    sourceUrl: row.screening.sourceUrl,
    programName: row.screening.programName ?? null,
    film: {
      id: row.film.id,
      title: displayFilmTitle(row.film),
      titleOriginal: row.film.titleOriginal,
      director: row.film.director,
      year: row.film.year,
      country: row.film.country,
      runtimeMin: row.film.runtimeMin,
      synopsisEs: row.film.synopsisEs,
      posterUrl: row.film.posterUrl,
      backdropUrl: row.film.backdropUrl,
      slug: row.film.slug ?? null,
      cast: row.film.cast ?? null,
      genres: row.film.genres ?? null,
      popularity: row.film.popularity ?? null,
      voteAverage: row.film.voteAverage ?? null,
      voteCount: row.film.voteCount ?? null,
      createdAt: row.film.createdAt,
    },
    cinema: {
      id: row.cinema.id,
      name: row.cinema.name,
      neighborhood: row.cinema.neighborhood,
      address: row.cinema.address,
      type: row.cinema.type,
    },
  };
}

// ---------------------------------------------------------------------------
// Group-by-film homepage queries (window-scoped redesign, 2026-06-06).
//
// The redesigned `/` renders ONE row per film for a selected time window,
// instead of one card per showtime (which produced a 50-70 card scroll wall
// on busy weekends). 64% of films have a single showtime; 95% play a single
// venue — so the common row is clean, and only the heavy tail (a handful of
// films with 11-25 showtimes) collapses behind a disclosure.
// ---------------------------------------------------------------------------

/** A film's showtimes at one venue, sorted ascending by start time. */
export interface VenueShowtimes {
  cinema: ScreeningRow['cinema'];
  screenings: ScreeningRow[];
}

/**
 * One film's full presence within a window: its venues (each with that
 * venue's showtimes), the flat showtime list, and the sort key.
 *
 * `nextCatchableUtc` is the soonest NOT-yet-expired showtime (15-min grace),
 * in epoch-ms — the film-ordering key. Null when every showtime in the window
 * has already passed; such films sink to the bottom, ordered by their last
 * showtime (see `sortFilmGroups`). Past showtimes still render (struck) in the
 * row — they're just not the sort anchor.
 */
export interface FilmGroup {
  film: ScreeningRow['film'];
  byVenue: VenueShowtimes[];
  /** All showtimes flat, ascending — fed to the disclosure's day/venue grouping. */
  screenings: ScreeningRow[];
  nextCatchableUtc: number | null;
  totalCount: number;
}

/**
 * Transform a flat (ascending) ScreeningRow list into FilmGroups: group by
 * film, then by venue within each film. Both groupings preserve first-seen
 * order, which — because `fetchRows` orders by `startsAtUtc ASC` — is
 * chronological. Sorted by `sortFilmGroups` before returning.
 *
 * Exported (pure) so the group transform is unit-tested without a DB.
 */
export function groupByFilm(rows: ScreeningRow[], now: Date): FilmGroup[] {
  const byFilm = new Map<number, ScreeningRow[]>();
  for (const s of rows) {
    const list = byFilm.get(s.film.id);
    if (list) list.push(s);
    else byFilm.set(s.film.id, [s]);
  }

  const groups: FilmGroup[] = [];
  for (const screeningList of byFilm.values()) {
    const byVenueMap = new Map<string, ScreeningRow[]>();
    for (const s of screeningList) {
      const v = byVenueMap.get(s.cinema.id);
      if (v) v.push(s);
      else byVenueMap.set(s.cinema.id, [s]);
    }
    const byVenue: VenueShowtimes[] = Array.from(byVenueMap.values()).map((list) => ({
      cinema: list[0].cinema,
      screenings: list,
    }));
    // Earliest NOT-yet-expired showtime drives ordering. screeningList is
    // already ascending, so the first non-expired entry is the soonest.
    const nextCatchable = screeningList.find(
      (s) => !isScreeningExpired(s.startsAtUtc, now),
    );
    groups.push({
      film: screeningList[0].film,
      byVenue,
      screenings: screeningList,
      nextCatchableUtc: nextCatchable ? nextCatchable.startsAtUtc.getTime() : null,
      totalCount: screeningList.length,
    });
  }
  return sortFilmGroups(groups);
}

/**
 * Order films by next catchable showtime ascending. Films whose showtimes
 * have all passed (within the window) sink below every still-catchable film,
 * ordered among themselves by their LAST showtime (so the most-recently-ended
 * sits just under the catchable set). Mutates + returns the input array.
 */
function sortFilmGroups(groups: FilmGroup[]): FilmGroup[] {
  return groups.sort((a, b) => {
    const aSunk = a.nextCatchableUtc === null;
    const bSunk = b.nextCatchableUtc === null;
    if (aSunk !== bSunk) return aSunk ? 1 : -1;
    if (!aSunk && !bSunk) return a.nextCatchableUtc! - b.nextCatchableUtc!;
    // Both sunk: most-recently-ended first (descending by last showtime), so
    // the film you just missed sits directly under the still-catchable set.
    const aLast = a.screenings[a.screenings.length - 1].startsAtUtc.getTime();
    const bLast = b.screenings[b.screenings.length - 1].startsAtUtc.getTime();
    return bLast - aLast;
  });
}

/**
 * Window-scoped, group-by-film cartelera for the homepage. Fetches the
 * window's bounded rows (one query, ≤~250 rows at BA scale), groups them, and
 * drops films with NO catchable showtime left in the window (`nextCatchableUtc
 * === null`).
 *
 * The homepage answers "what can I still see?" — a film whose every showtime in
 * the window has already passed is noise (and late at night it's ALL of "Hoy":
 * a wall of struck cards). Partially-catchable films are kept, with their past
 * times struck in place. The exhaustive `/cartelera` day view is where the full
 * day (incl. what already played) lives.
 */
export async function getWindowScreeningsByFilm(
  windowKey: WindowKey,
  now: Date = new Date(),
): Promise<FilmGroup[]> {
  const { lower, upper } = getWindowDef(windowKey).bounds(now);
  const rows = await fetchRows({ lower, upper });
  return groupByFilm(rows, now).filter((g) => g.nextCatchableUtc !== null);
}

// ---------------------------------------------------------------------------
// Curated "Esta semana" band — diversity-by-construction (4 fixed slots).
//
// Four axes a thoughtful programmer would showcase: 🇦🇷 local · ✨ new ·
// 🏛 canon · 🎲 wildcard. Each slot takes the best ELIGIBLE film by its own
// rank metric; a film fills at most one slot. Any fixed slot that can't fill
// that week falls back to the SAME wildcard chain the 4th slot uses, so the
// band fills to 4 whenever ≥4 films qualify and is omitted when 0 do.
//
// Every candidate clears two gates: a real poster (no SIN AFICHE in the
// showcase) and a future screening (still catchable). Ranking uses the TMDB
// signals captured on `films` — popularity for buzz, vote_count for notability
// (a recency-weighted metric would bury classics). Thresholds below are
// deliberately tunable against backfilled prod data (TODO #32).
// ---------------------------------------------------------------------------

export type FeaturedReason =
  | 'argentina'
  | 'estreno'
  | 'clasico'
  | 'ultima'
  | 'nuevo'
  | 'mundo'
  | 'destacada';

export interface FeaturedPick {
  film: ScreeningRow['film'];
  reason: FeaturedReason;
  /** Display WHY tag, e.g. "Cine argentino" | "Estreno" | "Clásico". */
  reasonLabel: string;
}

// --- Tunable thresholds (revisit against real backfilled numbers) ----------
/** A film at/under this year counts as "classic"/repertory. */
const CLASSIC_MAX_YEAR = 2000;
/** Min TMDB votes for the classic slot — keeps "Clásico" to genuinely notable
 *  titles (Godard's thousands beat an obscure contemporary's dozens). */
const CLASSIC_MIN_VOTE_COUNT = 1000;
/** "Nuevo en cartelera" = first seen in our DB within this many days. */
const NUEVO_MAX_AGE_DAYS = 14;
/** Countries excluded from "Cine del mundo" (local + mainstream). */
const WORLD_EXCLUDE_COUNTRIES = new Set(['AR', 'US']);

/** A featured candidate: one film + whether any of its screenings is a premiere. */
interface FeaturedCandidate {
  film: ScreeningRow['film'];
  hasPremiereTag: boolean;
}

interface FeaturedCtx {
  now: Date;
  currentYear: number;
  windowUpper: Date;
  lastPerFilm: Map<number, number>;
}

/** Default rank metric: TMDB popularity (null → 0). */
const byPopularity = (c: FeaturedCandidate): number => c.film.popularity ?? 0;

/**
 * A slot rule: can a candidate fill it, and how good a fit (higher = picked
 * first)? Used for both the fixed slots and the wildcard chain.
 */
interface FeaturedSlot {
  reason: FeaturedReason;
  label: string;
  eligible: (c: FeaturedCandidate, ctx: FeaturedCtx) => boolean;
  rank: (c: FeaturedCandidate) => number;
}

/** Slots 1-3, picked in order (assign-once). */
const FIXED_SLOTS: FeaturedSlot[] = [
  {
    reason: 'argentina',
    label: 'Cine argentino',
    eligible: (c) => c.film.country === 'AR',
    rank: byPopularity,
  },
  {
    reason: 'estreno',
    label: 'Estreno',
    eligible: (c, ctx) => c.hasPremiereTag || c.film.year === ctx.currentYear,
    rank: byPopularity,
  },
  {
    reason: 'clasico',
    label: 'Clásico',
    eligible: (c) =>
      c.film.year !== null &&
      c.film.year <= CLASSIC_MAX_YEAR &&
      (c.film.voteCount ?? 0) >= CLASSIC_MIN_VOTE_COUNT,
    rank: (c) => c.film.voteCount ?? 0,
  },
];

/**
 * The wildcard chain — also the shared fallback for any empty fixed slot.
 * Tries sub-reasons in priority order; the first with an eligible candidate
 * wins (best by popularity). The final `destacada` rule matches anything, so
 * the band fills to 4 whenever candidates remain.
 */
const WILDCARD_RULES: FeaturedSlot[] = [
  {
    reason: 'ultima',
    label: 'Última función',
    // The film's last FUTURE screening falls within the window → leaving soon.
    eligible: (c, ctx) => {
      const last = ctx.lastPerFilm.get(c.film.id);
      return last !== undefined && last < ctx.windowUpper.getTime();
    },
    rank: byPopularity,
  },
  {
    reason: 'nuevo',
    label: 'Nuevo en cartelera',
    eligible: (c, ctx) =>
      ctx.now.getTime() - c.film.createdAt.getTime() < NUEVO_MAX_AGE_DAYS * 86_400_000,
    rank: byPopularity,
  },
  {
    reason: 'mundo',
    label: 'Cine del mundo',
    eligible: (c) =>
      c.film.country !== null && !WORLD_EXCLUDE_COUNTRIES.has(c.film.country),
    rank: byPopularity,
  },
  {
    reason: 'destacada',
    label: 'Destacada',
    eligible: () => true,
    rank: byPopularity,
  },
];

/** Best eligible candidate in `pool` for `slot`, or null. */
function pickBestForSlot(
  pool: FeaturedCandidate[],
  slot: FeaturedSlot,
  ctx: FeaturedCtx,
): FeaturedCandidate | null {
  let best: FeaturedCandidate | null = null;
  let bestRank = -Infinity;
  for (const c of pool) {
    if (!slot.eligible(c, ctx)) continue;
    const r = slot.rank(c);
    if (r > bestRank) {
      best = c;
      bestRank = r;
    }
  }
  return best;
}

/** Best wildcard pick (first matching rule in WILDCARD_RULES), or null. */
function pickWildcard(
  pool: FeaturedCandidate[],
  ctx: FeaturedCtx,
): { candidate: FeaturedCandidate; reason: FeaturedReason; label: string } | null {
  for (const rule of WILDCARD_RULES) {
    const best = pickBestForSlot(pool, rule, ctx);
    if (best) return { candidate: best, reason: rule.reason, label: rule.label };
  }
  return null;
}

/**
 * Derive the curated band from the `semana` window's rows. Pure + exported so
 * the slot rules are unit-tested without a DB.
 *
 * Gates each candidate (poster + future screening via the unbounded
 * `lastPerFilm` MAX), then the three fixed slots (Argentina, Estreno, Clásico)
 * each take their best eligible unpicked film. The remaining positions (up to
 * 4 total) — the 4th slot AND any empty fixed slot — are filled by the wildcard
 * chain. Returns `[]` when nothing qualifies; the caller omits the band.
 */
export function deriveFeatured(
  rows: ScreeningRow[],
  lastPerFilm: Map<number, number>,
  windowUpper: Date,
  now: Date = new Date(),
): FeaturedPick[] {
  const ctx: FeaturedCtx = {
    now,
    currentYear: Number(formatDateKeyBA(now).slice(0, 4)),
    windowUpper,
    lastPerFilm,
  };

  // One gated candidate per film.
  const byFilm = new Map<number, ScreeningRow[]>();
  for (const s of rows) {
    const list = byFilm.get(s.film.id);
    if (list) list.push(s);
    else byFilm.set(s.film.id, [s]);
  }
  const remaining: FeaturedCandidate[] = [];
  for (const [filmId, list] of byFilm) {
    const film = list[0].film;
    if (!film.posterUrl) continue; // no SIN AFICHE in the showcase
    if (lastPerFilm.get(filmId) === undefined) continue; // must be catchable
    remaining.push({
      film,
      hasPremiereTag: list.some((s) => s.tags.includes('premiere')),
    });
  }

  const picks: FeaturedPick[] = [];
  const take = (c: FeaturedCandidate) => {
    const i = remaining.indexOf(c);
    if (i >= 0) remaining.splice(i, 1);
  };

  // Slots 1-3: each fixed slot takes its best eligible film (assign-once).
  for (const slot of FIXED_SLOTS) {
    const best = pickBestForSlot(remaining, slot, ctx);
    if (best) {
      picks.push({ film: best.film, reason: slot.reason, reasonLabel: slot.label });
      take(best);
    }
  }
  // Fill the rest (slot 4 + any empty fixed slot) via the shared wildcard chain.
  while (picks.length < 4) {
    const w = pickWildcard(remaining, ctx);
    if (!w) break;
    picks.push({ film: w.candidate.film, reason: w.reason, reasonLabel: w.label });
    take(w.candidate);
  }
  return picks;
}

/**
 * Curated band for the homepage. Always derives from the `semana` window
 * (reuses the same bounded query + the unbounded `getLastScreeningPerFilm`),
 * regardless of which window the visitor is viewing — the band is "Esta
 * semana" by definition. Returns `[]` when nothing qualifies.
 */
export async function getFeaturedFilms(now: Date = new Date()): Promise<FeaturedPick[]> {
  const { lower, upper } = getWindowDef('semana').bounds(now);
  const [rows, lastPerFilm] = await Promise.all([
    fetchRows({ lower, upper }),
    getLastScreeningPerFilm(now),
  ]);
  return deriveFeatured(rows, lastPerFilm, upper, now);
}

/**
 * Flat 7-day screening list for the homepage JSON-LD (`buildHomepageJsonLd`
 * trims to today + next 6 days internally). Decoupled from the visible
 * `?ventana=` window so the structured-data horizon stays a stable 7 days no
 * matter which window the visitor selected — preserves the SEO surface the old
 * day-grouped homepage emitted (don't regress json-ld.tsx's 7-day window).
 */
export async function getJsonLdScreenings(
  now: Date = new Date(),
): Promise<ScreeningRow[]> {
  const lower = getTodayStartBA(now);
  const upper = new Date(lower.getTime() + 7 * 86_400_000);
  return fetchRows({ lower, upper });
}

// ---------------------------------------------------------------------------
// Date formatting helpers — always in America/Argentina/Buenos_Aires.
// BA_TZ is imported from @/lib/date-ranges (canonical home for the constant).
// ---------------------------------------------------------------------------

export function formatDateKeyBA(d: Date): string {
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
 * "23 Abr" short day label for the Próximamente text index where each
 * row carries its own date chip.
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

/**
 * Compact day chip for multi-day homepage windows — "Hoy" when the showtime
 * is today (BA), else "Vie 6" (capitalized short weekday + day-of-month).
 * Used to prefix single-showtime rows and disclosure day groups in the
 * `finde` / `semana` / `prox` views, where a showtime can land on any day.
 */
export function formatDayChipBA(d: Date, now: Date): string {
  if (formatDateKeyBA(d) === formatDateKeyBA(now)) return 'Hoy';
  const parts = new Intl.DateTimeFormat('es-AR', {
    timeZone: BA_TZ,
    weekday: 'short',
    day: 'numeric',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  let dow = get('weekday').replace(/\.$/, '');
  dow = dow.charAt(0).toUpperCase() + dow.slice(1);
  return `${dow} ${get('day')}`;
}

/**
 * Week-banner label for the Próximamente text index. Renders as
 * "Semana del 19 al 25 de mayo" when the week sits entirely within one
 * month, or "Semana del 28 de abril al 4 de mayo" when it crosses a
 * month boundary. Echoes the masthead's "Edición Nº · Semana del…"
 * voice for the future-week-preview frame.
 */
function formatWeekLabel(monday: Date, sunday: Date): string {
  const fmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: BA_TZ,
    day: 'numeric',
    month: 'long',
  });
  const mp = fmt.formatToParts(monday);
  const sp = fmt.formatToParts(sunday);
  const md = mp.find((p) => p.type === 'day')?.value ?? '';
  const mm = mp.find((p) => p.type === 'month')?.value ?? '';
  const sd = sp.find((p) => p.type === 'day')?.value ?? '';
  const sm = sp.find((p) => p.type === 'month')?.value ?? '';
  if (mm === sm) return `Semana del ${md} al ${sd} de ${mm}`;
  return `Semana del ${md} de ${mm} al ${sd} de ${sm}`;
}

// ---------------------------------------------------------------------------
// Per-cinema queries — used by /sala/<id>
// ---------------------------------------------------------------------------

export interface CinemaRow {
  id: string;
  name: string;
  neighborhood: string | null;
  address: string | null;
  type: 'indie' | 'chain';
  ticketingBaseUrl: string | null;
}

/** Look up a single cinema by its slug id. Returns null when not found. */
export async function getCinema(id: string): Promise<CinemaRow | null> {
  const [row] = await db
    .select({
      id: cinemas.id,
      name: cinemas.name,
      neighborhood: cinemas.neighborhood,
      address: cinemas.address,
      type: cinemas.type,
      ticketingBaseUrl: cinemas.ticketingBaseUrl,
    })
    .from(cinemas)
    .where(eq(cinemas.id, id))
    .limit(1);
  return row ?? null;
}

/** Tier 1 for a single cinema — same 14-day rolling window as the homepage. */
export async function getTwoWeeksScreeningsByCinema(
  cinemaId: string,
  now: Date = new Date(),
): Promise<DayGroup[]> {
  const lower = getTodayStartBA(now);
  const upper = getEndOfTwoWeeksBA(now);
  const rows = await fetchRows({ lower, upper, cinemaId });
  return fillTwoWeeks(groupByDay(rows, now), lower, now);
}

/** Tier 2 for a single cinema — open-ended beyond the 14-day window. */
export async function getUpcomingScreeningsByCinema(
  cinemaId: string,
  now: Date = new Date(),
): Promise<WeekGroup[]> {
  const lower = getEndOfTwoWeeksBA(now);
  const rows = await fetchRows({ lower, cinemaId });
  return groupByWeek(rows);
}

// ---------------------------------------------------------------------------
// Venue-page agenda helpers — used by /sala/<id>
// ---------------------------------------------------------------------------

/**
 * Apply the venue-agenda visibility rule to fetched day groups:
 *   1. drop expired screenings (already-started + 15-min grace), and
 *   2. drop any day left with zero screenings.
 *
 * `getTwoWeeksScreeningsByCinema`'s lower bound is BA midnight, so TODAY's
 * group still carries already-started screenings, and `fillTwoWeeks` inserts
 * empty days for the homepage's per-day banners. The venue agenda wants
 * neither: dark days simply don't appear. Extracted from the page so this
 * contract is unit-tested — a regression here (filtering on raw rows, or
 * forgetting the expiry pass) silently renders dead rows or an empty agenda
 * past the empty-state guard.
 */
export function visibleAgendaDays(days: DayGroup[], now: Date): DayGroup[] {
  return days
    .map((d) => ({
      ...d,
      screenings: d.screenings.filter((s) => !isScreeningExpired(s.startsAtUtc, now)),
    }))
    .filter((d) => d.screenings.length > 0);
}

/**
 * Day-rail label parts for the venue agenda — { dow: 'Dom', day: '25',
 * month: 'May' }. Centralizes the BA-tz Intl formatting (one home for the
 * timezone + capitalization fixes) so VenueAgenda stays presentational.
 */
export function formatAgendaDayBA(d: Date): {
  dow: string;
  day: string;
  month: string;
} {
  const parts = new Intl.DateTimeFormat('es-AR', {
    timeZone: BA_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const cap = (s: string) => {
    const trimmed = s.replace(/\.$/, '');
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  };
  return { dow: cap(get('weekday')), day: get('day'), month: cap(get('month')) };
}

/**
 * Verbose BA day label for assistive tech — "Jueves 4 de junio". The agenda's
 * visual date rail is an abbreviated three-line stack ("Jue / 4 / Jun"); this
 * is the screen-reader name for the day's <h2> so heading navigation announces
 * a real date, not "Jue 4 Jun".
 */
export function formatAgendaDayLongBA(d: Date): string {
  const parts = new Intl.DateTimeFormat('es-AR', {
    timeZone: BA_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const wd = get('weekday');
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${get('day')} de ${get('month')}`;
}

/**
 * A curatorial program/cycle running at a venue, summarized for the
 * "Ciclos en curso" block on /sala/<id>.
 */
export interface Ciclo {
  /** URL-safe id, unique within one venue's ciclo list. Anchor target is
   *  `#programa-<slug>`, placed on `anchorScreeningId`'s agenda row. */
  slug: string;
  /** Display label — the program's verbatim name (first occurrence). */
  name: string;
  /** DISTINCT films in the program (a film screened 3× counts once). */
  filmCount: number;
  /** id of the EARLIEST visible screening — where the anchor `id` lands. */
  anchorScreeningId: number;
  firstStartsAt: Date;
  lastStartsAt: Date;
}

/**
 * Group a flat list of (already expiry-filtered, visible) screenings into
 * ciclos by `programName`.
 *
 * Grouping key is `slugify(programName)`, NOT the raw string: accent / case /
 * whitespace / punctuation drift in provider copy would otherwise fragment a
 * single cycle into several pills. The slug is the group key, so it is unique
 * by construction — no duplicate `#programa-<slug>` DOM ids. A program whose
 * name slugifies to empty (all-punctuation) collapses to the `ciclo` key.
 *
 * v1 scope: fed ONLY the visible agenda rows, so every returned ciclo has an
 * anchor inside the agenda (no future-only / Próximamente-fallback case).
 *
 *   screenings ──group by slugify(programName)──▶ Map<slug, rows[]>
 *        │  (programName == null → skipped)
 *        ▼
 *   per group: distinct film count · min/max startsAt · earliest screening id
 *        │
 *        ▼  sorted by firstStartsAt
 *   Ciclo[]
 */
export function groupCiclos(rows: ScreeningRow[]): Ciclo[] {
  const byKey = new Map<string, ScreeningRow[]>();
  for (const s of rows) {
    const name = s.programName?.trim();
    if (!name) continue;
    const key = slugify(name) || 'ciclo';
    const list = byKey.get(key);
    if (list) list.push(s);
    else byKey.set(key, [s]);
  }

  const ciclos: Ciclo[] = [];
  for (const [slug, list] of byKey) {
    const sorted = [...list].sort(
      (a, b) => a.startsAtUtc.getTime() - b.startsAtUtc.getTime(),
    );
    const first = sorted[0];
    ciclos.push({
      slug,
      name: first.programName!.trim(),
      filmCount: new Set(sorted.map((s) => s.film.id)).size,
      anchorScreeningId: first.id,
      firstStartsAt: first.startsAtUtc,
      lastStartsAt: sorted[sorted.length - 1].startsAtUtc,
    });
  }
  return ciclos.sort((a, b) => a.firstStartsAt.getTime() - b.firstStartsAt.getTime());
}
