/**
 * Query helpers for the Afiche cartelera view.
 *
 * The home page splits screenings into three chronological tiers:
 *
 *   1. "Esta semana"  — today 00:00 BA .. next ISO Monday 00:00 BA
 *   2. "Este mes"     — next ISO Monday 00:00 BA .. start of next month 00:00 BA
 *                        (empty when the week already crosses into next month)
 *   3. "Próximamente" — everything after max(weekEnd, monthEnd), open-ended
 *
 * Each tier has its own query; the page composes them. Tier 1 returns
 * grouped-by-day (the dense decision layer); tier 2 returns grouped-by-day
 * (still useful for planning); tier 3 returns a flat chronological list
 * (rendered as a compressed text index — days aren't load-bearing here).
 *
 * All functions run on the server (Server Components) and return plain data.
 */

import { and, eq, gte, lt, asc } from 'drizzle-orm';
import { db, screenings, films, cinemas } from './index';
import type { ScreeningTag } from './schema';
import {
  getTodayStartBA,
  getNextIsoMondayBA,
  getNextMonthStartBA,
} from '@/lib/date-ranges';

export interface ScreeningRow {
  id: number;
  startsAtUtc: Date;
  tags: ScreeningTag[];
  sourceUrl: string | null;
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
}

async function fetchRows({ lower, upper }: BoundedQuery): Promise<ScreeningRow[]> {
  const whereClause = upper
    ? and(gte(screenings.startsAtUtc, lower), lt(screenings.startsAtUtc, upper))
    : gte(screenings.startsAtUtc, lower);

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
export async function getThisWeekScreenings(
  now: Date = new Date(),
): Promise<DayGroup[]> {
  const lower = getTodayStartBA(now);
  const upper = getNextIsoMondayBA(now);
  const rows = await fetchRows({ lower, upper });
  return groupByDay(rows, now);
}

/**
 * Tier 2 — "Este mes". Screenings between the end of this ISO week and the
 * start of next calendar month. When today lands late enough that the week
 * already crosses the month boundary (e.g., Tuesday April 28 → week ends
 * May 4 which is after May 1), returns [] and the page hides the section.
 */
export async function getThisMonthScreenings(
  now: Date = new Date(),
): Promise<DayGroup[]> {
  const lower = getNextIsoMondayBA(now);
  const upper = getNextMonthStartBA(now);
  if (lower.getTime() >= upper.getTime()) return [];
  const rows = await fetchRows({ lower, upper });
  return groupByDay(rows, now);
}

/**
 * Tier 3 — "Próximamente". Everything after the end of the current month
 * (or end of this week, whichever is later — we pick the later boundary
 * so the same screening never appears in two tiers).
 *
 * Returns a flat chronological list. The page renders this as a compressed
 * text index; day grouping isn't load-bearing at this horizon because each
 * row carries its own date.
 */
export async function getUpcomingScreenings(
  now: Date = new Date(),
): Promise<ScreeningRow[]> {
  const weekEnd = getNextIsoMondayBA(now);
  const monthEnd = getNextMonthStartBA(now);
  const lower = weekEnd.getTime() > monthEnd.getTime() ? weekEnd : monthEnd;
  return fetchRows({ lower });
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
