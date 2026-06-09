/**
 * Tests for the weekly-run grouping + label helpers (TODO #34b).
 * Argentina is fixed at UTC-3 (no DST): 14:00 BA = 17:00 UTC. Fixture dates use
 * real 2026 weekdays — Jun 9 = martes, Jun 10 = miércoles, Jun 13 = sábado.
 */
import { describe, it, expect } from 'vitest';
import type { ScreeningRow, DayGroup } from '@/db/queries';
import {
  groupScreeningRuns,
  collapseDayByFilm,
  formatWeekdaySet,
  formatRunDateRange,
} from './screening-runs';

let nextId = 1;
function row(
  isoUtc: string,
  filmId: number,
  title: string,
  programName: string | null = null,
): ScreeningRow {
  return {
    id: nextId++,
    startsAtUtc: new Date(isoUtc),
    tags: [],
    sourceUrl: null,
    programName,
    film: { id: filmId, title },
    cinema: {
      id: 'lorca',
      name: 'Cine Lorca',
      neighborhood: null,
      address: null,
      type: 'indie',
    },
  } as unknown as ScreeningRow;
}

// 14:00 BA = T17:00Z, 16:00 = T19:00Z, 20:10 = T23:10Z, 23:30 = next-day T02:30Z.
const D = {
  jue9_1400: '2026-06-09T17:00:00Z', // Tue
  jue9_1600: '2026-06-09T19:00:00Z',
  jue9_2010: '2026-06-09T23:10:00Z',
  mie10_1400: '2026-06-10T17:00:00Z', // Wed
  mie10_1600: '2026-06-10T19:00:00Z',
  mie10_2010: '2026-06-10T23:10:00Z',
  sab13_1400: '2026-06-13T17:00:00Z', // Sat
  sab13_1600: '2026-06-13T19:00:00Z',
  sab13_2330: '2026-06-14T02:30:00Z', // 23:30 Sat BA
};

describe('groupScreeningRuns', () => {
  it('collapses a uniform daily run into ONE run (AC #1)', () => {
    const rows = [
      row(D.jue9_1400, 1, 'Amarga Navidad'),
      row(D.jue9_1600, 1, 'Amarga Navidad'),
      row(D.jue9_2010, 1, 'Amarga Navidad'),
      row(D.mie10_1400, 1, 'Amarga Navidad'),
      row(D.mie10_1600, 1, 'Amarga Navidad'),
      row(D.mie10_2010, 1, 'Amarga Navidad'),
    ];
    const runs = groupScreeningRuns(rows);
    expect(runs).toHaveLength(1);
    const r = runs[0];
    expect(r.uniform).toBe(true);
    expect(r.signatures).toHaveLength(1);
    expect(r.times).toEqual(['14:00', '16:00', '20:10']);
    expect(r.weekdays).toEqual([2, 3]); // Tue, Wed
    expect(formatWeekdaySet(r.weekdays)).toBe('Martes y miércoles');
  });

  it('returns one run per film, sorted alphabetically by title', () => {
    const runs = groupScreeningRuns([
      row(D.jue9_2010, 2, 'Recién nacidas'),
      row(D.jue9_1400, 1, 'Amarga Navidad'),
    ]);
    expect(runs.map((r) => r.film.title)).toEqual(['Amarga Navidad', 'Recién nacidas']);
  });

  it('keeps a non-uniform film as ONE run with multiple signatures (AC #4)', () => {
    const rows = [
      row(D.jue9_1400, 1, 'X'),
      row(D.jue9_1600, 1, 'X'),
      row(D.mie10_1400, 1, 'X'),
      row(D.mie10_1600, 1, 'X'),
      row(D.sab13_1400, 1, 'X'),
      row(D.sab13_1600, 1, 'X'),
      row(D.sab13_2330, 1, 'X'),
    ];
    const [r] = groupScreeningRuns(rows);
    expect(r.uniform).toBe(false);
    expect(r.signatures).toHaveLength(2);
    // sig 1: Tue+Wed @ 14/16 ; sig 2: Sat @ 14/16/23:30
    expect(r.signatures[0].weekdays).toEqual([2, 3]);
    expect(r.signatures[0].times).toEqual(['14:00', '16:00']);
    expect(r.signatures[1].weekdays).toEqual([6]);
    expect(r.signatures[1].times).toEqual(['14:00', '16:00', '23:30']);
  });

  it('treats a single screening as a trivially uniform run', () => {
    const [r] = groupScreeningRuns([row(D.sab13_1400, 1, 'Solo')]);
    expect(r.uniform).toBe(true);
    expect(r.signatures).toHaveLength(1);
    expect(r.times).toEqual(['14:00']);
    expect(formatWeekdaySet(r.weekdays)).toBe('Los sábados');
  });

  it('sorts trasnoche (post-midnight) times to the END, not lexically first', () => {
    // Times across the film's screenings: 23:30, 14:00, 00:30 (BA). Lexical sort
    // would put 00:30 first; cinema-day order keeps the trasnoche show last.
    const [r] = groupScreeningRuns([
      row('2026-06-13T02:30:00Z', 1, 'Trasnoche'), // 23:30 BA (Jun 12)
      row('2026-06-13T17:00:00Z', 1, 'Trasnoche'), // 14:00 BA (Jun 13)
      row('2026-06-13T03:30:00Z', 1, 'Trasnoche'), // 00:30 BA (Jun 13)
    ]);
    expect(r.times).toEqual(['14:00', '23:30', '00:30']);
    expect(r.times[r.times.length - 1]).toBe('00:30'); // trasnoche last, not first
  });

  it('carries programName from the first screening that has one', () => {
    const [r] = groupScreeningRuns([
      row(D.jue9_1400, 1, 'X', null),
      row(D.mie10_1400, 1, 'X', 'Ciclo Z'),
    ]);
    expect(r.programName).toBe('Ciclo Z');
  });
});

describe('formatWeekdaySet (AC #2)', () => {
  it.each([
    [[0, 1, 2, 3, 4, 5, 6], 'Todos los días'],
    [[1, 2, 3, 4, 5], 'De lunes a viernes'],
    [[2, 3], 'Martes y miércoles'],
    [[6], 'Los sábados'],
    [[1], 'Los lunes'],
    [[4, 5, 6, 0], 'De jueves a domingo'], // contiguous Thu→Sun (Mon-first order)
    [[1, 3, 5], 'Lunes, miércoles y viernes'],
  ])('%j → %s', (wd, label) => {
    expect(formatWeekdaySet(wd)).toBe(label);
  });
});

describe('formatRunDateRange (AC #3)', () => {
  it('same day', () => {
    expect(formatRunDateRange(new Date(D.jue9_1400), new Date(D.jue9_2010))).toBe(
      '9 jun',
    );
  });
  it('same month', () => {
    expect(formatRunDateRange(new Date(D.jue9_1400), new Date(D.mie10_1400))).toBe(
      '9–10 jun',
    );
  });
  it('cross month', () => {
    expect(
      formatRunDateRange(
        new Date('2026-06-30T17:00:00Z'),
        new Date('2026-07-02T17:00:00Z'),
      ),
    ).toBe('30 jun – 2 jul');
  });
});

describe('collapseDayByFilm (AC #7)', () => {
  function day(screenings: ScreeningRow[]): DayGroup {
    return {
      dateKey: '2026-06-09',
      label: 'martes 9 de junio',
      isToday: false,
      screenings,
    };
  }

  it('collapses a same-film, same-day multi-showtime into one group; orders by first showtime', () => {
    const groups = collapseDayByFilm(
      day([row(D.jue9_1600, 1, 'A'), row(D.jue9_1400, 1, 'A'), row(D.jue9_2010, 2, 'B')]),
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].film.title).toBe('A');
    expect(groups[0].times).toEqual(['14:00', '16:00']);
    expect(groups[1].film.title).toBe('B');
    expect(groups[1].times).toEqual(['20:10']);
  });

  it('is a no-op when each film screens once (repertory venues like MALBA)', () => {
    const groups = collapseDayByFilm(
      day([row(D.jue9_1400, 1, 'A'), row(D.jue9_1600, 2, 'B')]),
    );
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.screenings.length === 1)).toBe(true);
  });
});
