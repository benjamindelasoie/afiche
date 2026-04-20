/**
 * Query helpers for the Afiche week view.
 *
 * All functions run on the server (Server Components) and return plain data
 * that can be serialized and rendered.
 */

import { eq, gte, asc } from 'drizzle-orm';
import { db, screenings, films, cinemas } from './index';
import type { ScreeningTag } from './schema';

export interface ScreeningRow {
  id: number;
  startsAtUtc: Date;
  tags: ScreeningTag[];
  sourceUrl: string | null;
  film: {
    id: number;
    title: string;
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
  dateKey: string;             // 'YYYY-MM-DD' in BA time — stable grouping key
  label: string;               // e.g. 'Martes 19 de abril'
  isToday: boolean;
  screenings: ScreeningRow[];
}

/**
 * Return all screenings from now through the next ~7 days,
 * grouped by day (Buenos Aires timezone), ordered chronologically.
 */
export async function getThisWeeksScreenings(): Promise<DayGroup[]> {
  const now = new Date();

  const rows = await db
    .select({
      screening: screenings,
      film: films,
      cinema: cinemas,
    })
    .from(screenings)
    .innerJoin(films, eq(screenings.filmId, films.id))
    .innerJoin(cinemas, eq(screenings.cinemaId, cinemas.id))
    .where(gte(screenings.startsAtUtc, now))
    .orderBy(asc(screenings.startsAtUtc));

  // Group by BA-local date key
  const groups = new Map<string, DayGroup>();
  const today = formatDateKeyBA(now);

  for (const row of rows) {
    const dateKey = formatDateKeyBA(row.screening.startsAtUtc);
    if (!groups.has(dateKey)) {
      groups.set(dateKey, {
        dateKey,
        label: formatDayLabel(row.screening.startsAtUtc),
        isToday: dateKey === today,
        screenings: [],
      });
    }
    groups.get(dateKey)!.screenings.push({
      id: row.screening.id,
      startsAtUtc: row.screening.startsAtUtc,
      tags: row.screening.tags,
      sourceUrl: row.screening.sourceUrl,
      film: {
        id: row.film.id,
        title: row.film.title,
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
    });
  }

  return Array.from(groups.values());
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
  // e.g. "Martes 19 de abril"
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: BA_TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(d);
}

export function formatTimeBA(d: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: BA_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}
