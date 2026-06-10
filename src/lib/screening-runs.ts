// ---------------------------------------------------------------------------
// Display-layer grouping for the /sala/[id] "weekly-run" shape (TODO #34b).
//
// Pure functions over already-fetched, already-expiry-filtered ScreeningRow[].
// ONE module powers both:
//   - groupScreeningRuns  → the film-first weekly-run view (VenueRuns)
//   - collapseDayByFilm   → the within-day collapse in the chronological view
//
// No DB import (types are `import type`, erased at build) so unit tests stay
// pure. BA local time = UTC-3, no DST — computed via Intl, same as queries.ts.
// ---------------------------------------------------------------------------
import type { ScreeningRow, DayGroup } from '@/db/queries';

const BA_TZ = 'America/Argentina/Buenos_Aires';

/** 'HH:MM' in BA local time (24h). */
function timeBA(d: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: BA_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** 'YYYY-MM-DD' BA calendar date — stable per-day grouping key. */
function dateKeyBA(d: Date): string {
  // en-CA renders ISO-ordered Y-M-D.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** BA weekday index for a 'YYYY-MM-DD' key: 0=Sun … 6=Sat. Noon-UTC avoids edges. */
function weekdayOfKey(key: string): number {
  return new Date(`${key}T12:00:00Z`).getUTCDay();
}

/**
 * Sort 'HH:MM' by cinema-day clock, not lexically: a trasnoche 00:30 belongs at
 * the END of the night's listing (after 23:xx), not the start. So 00:00–04:59
 * map past 24:00. Without this, a midnight show renders/groups as the day's
 * first time. (Lexical sort of zero-padded 24h is otherwise fine.)
 */
function clockMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h < 5 ? h + 24 : h) * 60 + m;
}
const byClock = (a: string, b: string) => clockMinutes(a) - clockMinutes(b);

// Spanish weekday names indexed 0=Sun … 6=Sat.
const WD_SINGULAR = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
];
const WD_PLURAL = [
  'domingos',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábados',
];
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0]; // display order: lunes … domingo
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A coherent time-signature within a run: the weekdays that share one time set. */
export interface RunSignature {
  weekdays: number[]; // distinct BA weekday indices (0..6), display-sorted (Mon-first)
  times: string[]; // distinct 'HH:MM', ascending
}

/**
 * A film's screenings at one venue, grouped for the film-first weekly-run view.
 * `uniform` (the common Lorca/Cosmos case) ⇒ exactly one signature. A
 * non-uniform film keeps ONE block with several signature lines — never a
 * separate section (design review 2026-06-09).
 */
export interface ScreeningRun {
  film: ScreeningRow['film'];
  programName: string | null;
  weekdays: number[]; // all distinct weekdays, display-sorted
  times: string[]; // distinct union, ascending
  uniform: boolean; // signatures.length === 1
  signatures: RunSignature[]; // ascending by earliest time
  firstUtc: Date; // date-range start (NOT a sort key — runs sort by title)
  lastUtc: Date; // date-range end
  screenings: ScreeningRow[];
}

function sortWeekdaysForDisplay(wds: number[]): number[] {
  return [...new Set(wds)].sort((a, b) => MON_FIRST.indexOf(a) - MON_FIRST.indexOf(b));
}

/**
 * Group a single venue's already-filtered rows into film-first runs, sorted
 * alphabetically by title (the page's object is the film, not a showtime).
 */
export function groupScreeningRuns(rows: ScreeningRow[]): ScreeningRun[] {
  const byFilm = new Map<number, ScreeningRow[]>();
  for (const r of rows) {
    const list = byFilm.get(r.film.id);
    if (list) list.push(r);
    else byFilm.set(r.film.id, [r]);
  }

  const runs: ScreeningRun[] = [];
  for (const screenings of byFilm.values()) {
    // Per BA-day: the set of times that day.
    const dayTimes = new Map<string, Set<string>>();
    for (const s of screenings) {
      const key = dateKeyBA(s.startsAtUtc);
      const set = dayTimes.get(key) ?? new Set<string>();
      set.add(timeBA(s.startsAtUtc));
      dayTimes.set(key, set);
    }

    // Group days by identical time-signature → one RunSignature each.
    const bySig = new Map<string, { weekdays: number[]; times: string[] }>();
    for (const [key, set] of dayTimes) {
      const times = [...set].sort(byClock);
      const sigKey = times.join('|');
      const sig = bySig.get(sigKey);
      if (sig) sig.weekdays.push(weekdayOfKey(key));
      else bySig.set(sigKey, { weekdays: [weekdayOfKey(key)], times });
    }

    const signatures: RunSignature[] = [...bySig.values()]
      .map((s) => ({ weekdays: sortWeekdaysForDisplay(s.weekdays), times: s.times }))
      .sort((a, b) => byClock(a.times[0], b.times[0]));

    const allTimes = [...new Set(screenings.map((s) => timeBA(s.startsAtUtc)))].sort(
      byClock,
    );
    const allWeekdays = sortWeekdaysForDisplay([...dayTimes.keys()].map(weekdayOfKey));
    const utcs = screenings.map((s) => s.startsAtUtc.getTime());

    runs.push({
      film: screenings[0].film,
      programName: screenings.find((s) => s.programName)?.programName ?? null,
      weekdays: allWeekdays,
      times: allTimes,
      uniform: signatures.length === 1,
      signatures,
      firstUtc: new Date(Math.min(...utcs)),
      lastUtc: new Date(Math.max(...utcs)),
      screenings,
    });
  }

  return runs.sort((a, b) => a.film.title.localeCompare(b.film.title, 'es'));
}

/** One film collapsed within a single agenda day — its same-day showtimes as one row. */
export interface DayFilmGroup {
  film: ScreeningRow['film'];
  programName: string | null;
  tags: ScreeningRow['tags']; // union across the day's showtimes (render filters 'cycle')
  times: string[]; // ascending 'HH:MM'
  firstUtc: Date; // ordering key within the day
  screenings: ScreeningRow[]; // raw rows, time-sorted (carry ids + startsAtUtc for <time>/anchor)
}

/**
 * Collapse a chronological day's screenings to one row per film (times merged),
 * ordered by each film's earliest showtime. For repertory venues (MALBA, …)
 * whose same-day slots are distinct films this is a NO-OP (every group has one
 * screening) — guarding the shared VenueAgenda against regression.
 */
export function collapseDayByFilm(day: DayGroup): DayFilmGroup[] {
  const byFilm = new Map<number, ScreeningRow[]>();
  for (const s of day.screenings) {
    const list = byFilm.get(s.film.id);
    if (list) list.push(s);
    else byFilm.set(s.film.id, [s]);
  }
  const groups: DayFilmGroup[] = [...byFilm.values()].map((screenings) => {
    const sorted = [...screenings].sort(
      (a, b) => a.startsAtUtc.getTime() - b.startsAtUtc.getTime(),
    );
    return {
      film: sorted[0].film,
      programName: sorted.find((s) => s.programName)?.programName ?? null,
      tags: [...new Set(sorted.flatMap((s) => s.tags))],
      times: sorted.map((s) => timeBA(s.startsAtUtc)),
      firstUtc: sorted[0].startsAtUtc,
      screenings: sorted,
    };
  });
  return groups.sort((a, b) => a.firstUtc.getTime() - b.firstUtc.getTime());
}

/**
 * Spanish label for a set of weekday indices (0=Sun..6=Sat). The `.days`
 * element renders the result UPPERCASE via the mono eyebrow style, matching
 * the date-rail's `dow` caps — so this returns lowercase words.
 */
export function formatWeekdaySet(weekdays: number[]): string {
  const wd = sortWeekdaysForDisplay(weekdays);
  if (wd.length === 0) return '';
  if (wd.length === 7) return 'Todos los días';
  // exactly Mon..Fri
  if (wd.length === 5 && [1, 2, 3, 4, 5].every((d) => wd.includes(d))) {
    return 'De lunes a viernes';
  }
  if (wd.length === 1) return `Los ${WD_PLURAL[wd[0]]}`;
  if (wd.length === 2) return `${cap(WD_SINGULAR[wd[0]])} y ${WD_SINGULAR[wd[1]]}`;
  // ≥3: contiguous in Mon-first order → "De X a Y"; else comma list.
  const positions = wd.map((d) => MON_FIRST.indexOf(d));
  const contiguous = positions.every((p, i) => i === 0 || p === positions[i - 1] + 1);
  if (contiguous) return `De ${WD_SINGULAR[wd[0]]} a ${WD_SINGULAR[wd[wd.length - 1]]}`;
  const names = wd.map((d, i) => (i === 0 ? cap(WD_SINGULAR[d]) : WD_SINGULAR[d]));
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/** Lowercase 3-letter BA month, no trailing dot. */
function shortMonthBA(d: Date): string {
  const m = new Intl.DateTimeFormat('es-AR', { timeZone: BA_TZ, month: 'short' }).format(
    d,
  );
  return m.replace(/\.$/, '').toLowerCase();
}
function dayNumBA(d: Date): string {
  return new Intl.DateTimeFormat('es-AR', { timeZone: BA_TZ, day: 'numeric' }).format(d);
}

/** "9 jun" (same day) · "9–10 jun" (same month) · "30 jun – 2 jul" (cross-month). */
export function formatRunDateRange(firstUtc: Date, lastUtc: Date): string {
  const d1 = dayNumBA(firstUtc);
  const d2 = dayNumBA(lastUtc);
  const m1 = shortMonthBA(firstUtc);
  const m2 = shortMonthBA(lastUtc);
  if (d1 === d2 && m1 === m2) return `${d1} ${m1}`;
  if (m1 === m2) return `${d1}–${d2} ${m1}`;
  return `${d1} ${m1} – ${d2} ${m2}`;
}
