/**
 * Pure view-model helpers for FilmRow — the homepage group-by-film row.
 *
 * Extracted from FilmRow.tsx (a server component that imports next/image) so
 * the intricate disclosure day-cap, the multi-venue summary, and the
 * sunk-film lead logic are unit-testable without rendering React or loading
 * next/* modules. FilmRow builds its serialized client view-model from these.
 *
 * No JSX, no next imports. Date/Intl formatting is delegated to the BA-tz
 * helpers in @/db/queries.
 */

import {
  formatTimeBA,
  formatDateKeyBA,
  formatDayChipBA,
  formatAgendaDayBA,
  type FilmGroup,
  type ScreeningRow,
  type VenueShowtimes,
} from '@/db/queries';
import { isScreeningExpired } from '@/lib/date-ranges';
import type { DisclosureVenue, DisclosureTime } from './ShowtimesDisclosure';

/** Days shown per venue in a multi-day disclosure before "ver todas →". */
export const DISCLOSURE_DAY_CAP = 4;

function toTimeVM(s: ScreeningRow, now: Date): DisclosureTime {
  return {
    id: s.id,
    time: formatTimeBA(s.startsAtUtc),
    iso: s.startsAtUtc.toISOString(),
    href: s.sourceUrl,
    isPast: isScreeningExpired(s.startsAtUtc, now),
  };
}

/**
 * Build one venue's disclosure view-model: group its showtimes by day. In a
 * multi-day window, cap at DISCLOSURE_DAY_CAP days and surface the dropped
 * days' weekday names (rendered as "+ Sáb, Dom · ver todas →"). The `hoy`
 * window (multiDay=false) is single-day, so it never caps.
 */
export function buildDisclosureVenue(
  v: VenueShowtimes,
  now: Date,
  multiDay: boolean,
): DisclosureVenue {
  const dayMap = new Map<string, ScreeningRow[]>();
  for (const s of v.screenings) {
    const key = formatDateKeyBA(s.startsAtUtc);
    const list = dayMap.get(key);
    if (list) list.push(s);
    else dayMap.set(key, [s]);
  }

  let dayEntries = Array.from(dayMap.entries());
  let omittedDayNames: string[] = [];
  if (multiDay && dayEntries.length > DISCLOSURE_DAY_CAP) {
    const omitted = dayEntries.slice(DISCLOSURE_DAY_CAP);
    omittedDayNames = omitted.map(([, rows]) => formatAgendaDayBA(rows[0].startsAtUtc).dow);
    dayEntries = dayEntries.slice(0, DISCLOSURE_DAY_CAP);
  }

  return {
    cinemaId: v.cinema.id,
    cinemaName: v.cinema.name,
    cinemaHref: `/sala/${v.cinema.id}`,
    days: dayEntries.map(([key, rows]) => ({
      key,
      label: formatDayChipBA(rows[0].startsAtUtc, now),
      times: rows.map((s) => toTimeVM(s, now)),
    })),
    omittedDayNames,
  };
}

/**
 * Collapsed-summary right-hand text: "{N} funciones hoy · {venue}" in the
 * single-day `hoy` window, "{N} funciones · {venue}" elsewhere. Venue is the
 * cinema name when single-venue, else "{count} salas".
 */
export function filmRowSummary(
  group: FilmGroup,
  multiDay: boolean,
): { venueLabel: string; summaryRest: string } {
  const venueLabel =
    group.byVenue.length === 1 ? group.byVenue[0].cinema.name : `${group.byVenue.length} salas`;
  const summaryRest = multiDay
    ? `${group.totalCount} funciones · ${venueLabel}`
    : `${group.totalCount} funciones hoy · ${venueLabel}`;
  return { venueLabel, summaryRest };
}

/**
 * Lead time shown in the collapsed summary: the soonest still-catchable
 * showtime. Returns nulls for an all-past (sunk) film — never surface a past
 * time as the lead, which would advertise a screening that already happened.
 */
export function filmRowLead(
  group: FilmGroup,
  multiDay: boolean,
  now: Date,
): { leadTime: string | null; leadDayHint: string | null } {
  if (group.nextCatchableUtc === null) return { leadTime: null, leadDayHint: null };
  const next = group.screenings.find((s) => !isScreeningExpired(s.startsAtUtc, now));
  if (!next) return { leadTime: null, leadDayHint: null };
  return {
    leadTime: formatTimeBA(next.startsAtUtc),
    leadDayHint: multiDay ? formatDayChipBA(next.startsAtUtc, now) : null,
  };
}
