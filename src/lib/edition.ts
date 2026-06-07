/**
 * Masthead edition + date-range helpers, shared by the homepage (`/`) and the
 * relocated day-grouped view (`/cartelera`).
 *
 * The "Edición Nº N · Semana del X al Y" dateline is anchored to the ISO week
 * `now` falls in (editorial flavor), decoupled from whichever content window a
 * page renders. Extracted here so both pages compute it identically — see
 * src/app/page.tsx and src/app/cartelera/page.tsx.
 */

import { getEditionNumber, editionFullSentence } from '@/lib/iso-week';
import { getIsoWeekStartBA, getIsoWeekEndBA, BA_TZ } from '@/lib/date-ranges';
import { formatTimeBA } from '@/db/queries';

export interface EditionInfo {
  editionNumber: number;
  weekRangeLabel: string;
  /** Compact "DD MMM — DD MMM" form for the mobile dateline. */
  weekRangeShort: string;
  fullSentence: string;
}

export function computeEdition(
  now: Date,
  totalScreenings: number,
  distinctCinemas: number,
): EditionInfo {
  const weekStart = getIsoWeekStartBA(now);
  const weekEnd = getIsoWeekEndBA(now);
  const editionNumber = getEditionNumber(weekStart);
  const weekRangeLabel = formatRangeLabel(weekStart, weekEnd);
  const weekRangeShort = formatRangeShort(weekStart, weekEnd);
  const fullSentence = editionFullSentence({
    editionNumber,
    weekRangeLabel,
    totalScreenings,
    distinctCinemas,
    isWeekSpan: true,
  });
  return { editionNumber, weekRangeLabel, weekRangeShort, fullSentence };
}

/**
 * "23 de abril" / "23 al 30 de abril" / "23 de abril al 5 de mayo" — BA tz.
 * Shared by the masthead edition dateline and section subtitles.
 */
export function formatRangeLabel(first: Date, last: Date): string {
  const fmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: BA_TZ,
    day: 'numeric',
    month: 'long',
  });
  const firstParts = fmt.formatToParts(first);
  const lastParts = fmt.formatToParts(last);
  const firstMonth = firstParts.find((p) => p.type === 'month')?.value;
  const lastMonth = lastParts.find((p) => p.type === 'month')?.value;
  const firstDay = firstParts.find((p) => p.type === 'day')?.value;
  const lastDay = lastParts.find((p) => p.type === 'day')?.value;

  if (firstDay === lastDay && firstMonth === lastMonth) {
    return `${firstDay} de ${firstMonth}`;
  }
  if (firstMonth === lastMonth) {
    return `${firstDay} al ${lastDay} de ${firstMonth}`;
  }
  return `${firstDay} de ${firstMonth} al ${lastDay} de ${lastMonth}`;
}

/**
 * Compact "DD MMM — DD MMM" range for the masthead dateline. Months are
 * clipped to 3-letter abbreviations (no trailing period, Spanish headline
 * convention) so the row fits under the wordmark at mobile 375.
 */
export function formatRangeShort(first: Date, last: Date): string {
  const fmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: BA_TZ,
    day: 'numeric',
    month: 'short',
  });
  const firstParts = fmt.formatToParts(first);
  const lastParts = fmt.formatToParts(last);
  const firstDay = firstParts.find((p) => p.type === 'day')?.value;
  const firstMonth = firstParts.find((p) => p.type === 'month')?.value?.replace('.', '');
  const lastDay = lastParts.find((p) => p.type === 'day')?.value;
  const lastMonth = lastParts.find((p) => p.type === 'month')?.value?.replace('.', '');
  return `${firstDay} ${firstMonth} — ${lastDay} ${lastMonth}`;
}

/**
 * Footer timestamp — "23 de abril a las 14:30" in BA time. Rendered after
 * "Actualizado el " so the reader sees freshness without a label to parse.
 */
export function formatLastScrape(d: Date): string {
  const dateFmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: BA_TZ,
    day: 'numeric',
    month: 'long',
  });
  const parts = dateFmt.formatToParts(d);
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const time = formatTimeBA(d);
  return `${day} de ${month} a las ${time}`;
}
