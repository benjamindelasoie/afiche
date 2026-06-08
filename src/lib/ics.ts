/**
 * RFC 5545 (iCalendar) generator for a single screening.
 *
 * Scope: one VEVENT per call (no recurrence). Output is consumable by
 * Google Calendar, Apple Calendar, Outlook, and any RFC-5545 reader.
 *
 * Escape rules for TEXT values (RFC 5545 §3.3.11):
 *   \  → \\
 *   ;  → \;
 *   ,  → \,
 *   newline → literal "\n"
 * URI properties (URL) are NOT escaped (RFC §3.3.13).
 *
 * Line endings are CRLF per spec. Individual property values are kept
 * short enough today (title + director + venue + two URLs) that the
 * 75-octet folding rule does not become load-bearing; if a future
 * caller passes long synopses through here, add fold-on-write.
 */

import { SITE_URL, SITE_HOST } from './site';

export interface IcsScreeningInput {
  id: number;
  startsAtUtc: Date;
  film: {
    title: string;
    director: string | null;
    year: number | null;
    runtimeMin: number | null;
    slug: string | null;
  };
  cinema: {
    name: string;
    address: string | null;
  };
  sourceUrl: string | null;
}

const PRODID = '-//Afiche//Cartelera BA//ES';
// Runtime fallback for films TMDB hasn't enriched (or shorts/festival
// titles TMDB doesn't carry). Two hours is the common feature length;
// users can shrink the event in their calendar if it's actually 80 min.
const DEFAULT_RUNTIME_MIN = 120;

export function escapeText(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

export function formatUtcDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

export function buildScreeningIcs(
  input: IcsScreeningInput,
  now: Date = new Date(),
): string {
  const { id, startsAtUtc, film, cinema, sourceUrl } = input;
  // `|| DEFAULT` not `?? DEFAULT`: a 0 runtime (TMDB has no runtime for some
  // brand-new films) is "unknown", not "zero-length event" — fall back too.
  const runtimeMin = film.runtimeMin || DEFAULT_RUNTIME_MIN;
  const endsAtUtc = new Date(startsAtUtc.getTime() + runtimeMin * 60_000);

  const summary = escapeText(film.title);
  const locationParts = [cinema.name];
  if (cinema.address) locationParts.push(cinema.address);
  const location = escapeText(locationParts.join(', '));

  const descParts: string[] = [];
  if (film.director) {
    const meta = [film.director, film.year ? String(film.year) : null]
      .filter((v): v is string => v !== null)
      .join(' · ');
    descParts.push(meta);
  }
  if (film.slug) descParts.push(`${SITE_URL}/pelicula/${film.slug}`);
  if (sourceUrl) descParts.push(`Entradas: ${sourceUrl}`);
  const description = escapeText(descParts.join('\n\n'));

  // URL property: prefer /pelicula/<slug> (cinephile context, cross-venue
  // discovery), fall back to the ticketing URL when slug is absent.
  const url = film.slug ? `${SITE_URL}/pelicula/${film.slug}` : sourceUrl;

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:screening-${id}@${SITE_HOST}`,
    `DTSTAMP:${formatUtcDateTime(now)}`,
    `DTSTART:${formatUtcDateTime(startsAtUtc)}`,
    `DTEND:${formatUtcDateTime(endsAtUtc)}`,
    `SUMMARY:${summary}`,
    `LOCATION:${location}`,
  ];
  if (description) lines.push(`DESCRIPTION:${description}`);
  if (url) lines.push(`URL:${url}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.join('\r\n') + '\r\n';
}
