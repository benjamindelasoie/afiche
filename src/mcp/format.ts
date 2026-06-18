/**
 * Pure shaping helpers for the MCP server (src/app/api/mcp). Turn the DB-layer
 * row/group types into the flat, model-friendly DTOs the tools return as
 * `structuredContent`. No DB access, no `mcp-handler` import — kept pure so it
 * is unit-tested with fixtures (mirrors src/db/group-by-film.test.ts).
 *
 *   ScreeningRow ──toShowtime──► ShowtimeDTO
 *   ScreeningRow['film'] ──toFilmDTO──► FilmDTO
 *   ScreeningRow[] ──toVenues──► VenueDTO[]   (grouped by cinema)
 *
 * Times: afiche stores UTC; Argentina is fixed UTC-3 year-round (no DST), so a
 * BA-local ISO string is a straight -3h shift + a literal `-03:00` stamp — same
 * fixed-offset approach as src/lib/date-ranges.ts.
 *
 * 0-numeric guard (prior incident `react-zero-and-render`): `runtimeMin` and
 * `voteAverage` are legitimately 0 for unenriched films (TMDB had no
 * runtime/votes). Coerce 0 → null so a consumer never reads a meaningful "0".
 */

import type { ScreeningRow } from '@/db/queries';
import { GENRE_LABELS_ES, TAG_LABELS_ES, type ScreeningTag } from '@/db/schema';
import { isScreeningExpired, BA_TZ } from '@/lib/date-ranges';
import { SITE_URL } from '@/lib/site';

export interface ShowtimeDTO {
  /** ISO-8601 in BA local time with the fixed `-03:00` offset, e.g. `2026-06-18T20:30:00-03:00`. */
  startsAt: string;
  /** es-AR human label, e.g. `Jue 18 Jun, 20:30`. */
  label: string;
  /** Localized screening tags, e.g. `["VOS", "ESTRENO"]`. */
  tags: string[];
  programName: string | null;
  sourceUrl: string | null;
  /** Add-to-calendar link for this exact screening. */
  icsUrl: string;
}

export interface CinemaRefDTO {
  id: string;
  name: string;
  neighborhood: string | null;
}

export interface VenueDTO {
  cinema: CinemaRefDTO;
  showtimes: ShowtimeDTO[];
}

export interface FilmDTO {
  slug: string | null;
  title: string;
  titleOriginal: string | null;
  director: string | null;
  year: number | null;
  country: string | null;
  runtimeMin: number | null;
  synopsis: string | null;
  genres: string[];
  cast: { name: string; character: string }[];
  voteAverage: number | null;
  posterUrl: string | null;
  url: string | null;
}

/** UTC instant → BA-local ISO-8601 with the fixed `-03:00` offset. */
export function toBAISO(d: Date): string {
  const shifted = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return `${shifted.toISOString().slice(0, 19)}-03:00`;
}

/** es-AR label like `Jue 18 Jun, 20:30` (BA tz). */
export function formatBALabel(d: Date): string {
  const parts = new Intl.DateTimeFormat('es-AR', {
    timeZone: BA_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).formatToParts(d);
  const cap = (s: string) =>
    s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/\.$/, '') : '';
  const weekday = cap(parts.find((p) => p.type === 'weekday')?.value ?? '');
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = cap(parts.find((p) => p.type === 'month')?.value ?? '');
  const time = new Intl.DateTimeFormat('es-AR', {
    timeZone: BA_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${weekday} ${day} ${month}, ${time}`;
}

/** Drop screenings that have already started (15-min grace) — never advertise an unattendable showtime. */
export function catchable(rows: ScreeningRow[], now: Date): ScreeningRow[] {
  return rows.filter((r) => !isScreeningExpired(r.startsAtUtc, now));
}

/** Build the absolute /pelicula URL, or null when the film has no slug. */
export function filmUrl(slug: string | null): string | null {
  return slug ? `${SITE_URL}/pelicula/${slug}` : null;
}

export function toShowtime(row: ScreeningRow): ShowtimeDTO {
  return {
    startsAt: toBAISO(row.startsAtUtc),
    label: formatBALabel(row.startsAtUtc),
    tags: row.tags.map((t: ScreeningTag) => TAG_LABELS_ES[t] ?? t),
    programName: row.programName,
    sourceUrl: row.sourceUrl,
    icsUrl: `${SITE_URL}/api/screening/${row.id}/ics`,
  };
}

export function toVenue(cinema: ScreeningRow['cinema'], rows: ScreeningRow[]): VenueDTO {
  return {
    cinema: { id: cinema.id, name: cinema.name, neighborhood: cinema.neighborhood },
    showtimes: rows.map(toShowtime),
  };
}

/** Group a flat (chronological) screening list by cinema, preserving first-seen order. */
export function toVenues(rows: ScreeningRow[]): VenueDTO[] {
  const byCinema = new Map<string, ScreeningRow[]>();
  for (const r of rows) {
    const list = byCinema.get(r.cinema.id);
    if (list) list.push(r);
    else byCinema.set(r.cinema.id, [r]);
  }
  return Array.from(byCinema.values()).map((list) => toVenue(list[0].cinema, list));
}

export function toFilmDTO(film: ScreeningRow['film']): FilmDTO {
  return {
    slug: film.slug,
    title: film.title,
    titleOriginal: film.titleOriginal,
    director: film.director,
    year: film.year,
    country: film.country,
    // 0-numeric guard: an unenriched film has runtimeMin/voteAverage 0 → null.
    runtimeMin: film.runtimeMin ? film.runtimeMin : null,
    synopsis: film.synopsisEs,
    genres: (film.genres ?? []).map((id) => GENRE_LABELS_ES[id]).filter(Boolean),
    cast: film.cast ?? [],
    voteAverage: film.voteAverage ? film.voteAverage : null,
    posterUrl: film.posterUrl,
    url: filmUrl(film.slug),
  };
}
