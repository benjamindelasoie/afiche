/**
 * Tests for the Sala Leopoldo Lugones provider.
 *
 * Fixture: captured 2026-04-21 from the live Boris Karloff Parte 2 detail
 * page. This cycle is the canonical regression test for the "April program
 * silently stored as May" bug — the dateRange "Del 28 de abril al 5 de mayo"
 * spans two months, and the parser used to pick the END month as the anchor,
 * so April screenings would be dated a month in the future.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseDetailPage,
  parseDateRange,
  matchSingleFilmShowtime,
  type ProgramLink,
} from './lugones';

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, '../../test/fixtures/lugones', name), 'utf8');
}

describe('parseDateRange', () => {
  it('anchors on the START month when the range spans two months', () => {
    // Regression: before the fix this returned { startMonth: 4 /* May */ }.
    expect(parseDateRange('Del 28 de abril al 5 de mayo')).toMatchObject({
      startMonth: 3, // April (0-indexed)
    });
  });

  it('anchors on the shared month in the short-form same-month range', () => {
    expect(parseDateRange('Del 15 al 26 de abril')).toMatchObject({
      startMonth: 3,
    });
  });

  it('anchors on the month after "a partir del"', () => {
    expect(parseDateRange('A partir del 7 de mayo')).toMatchObject({
      startMonth: 4,
    });
  });

  it('returns null for unparseable text', () => {
    expect(parseDateRange('próximamente')).toBeNull();
  });

  // Regression: Lugones uses a single-day form for one-off "bis" encore
  // screenings, special events, and festival add-ons. The dateRangeText
  // looks nothing like the cycle "Del X al Y" syntax, so before this
  // form was added, parseDateRange returned null and the entire program
  // was dropped (warning: 'could not parse date range "Jueves 28 de
  // mayo, 15 y 18 horas"'). Source: Claude Chabrol-bis program, 2026-05.
  it('anchors on day + month for single-day shape with inline times', () => {
    expect(parseDateRange('Jueves 28 de mayo, 15 y 18 horas')).toMatchObject({
      startMonth: 4, // May (0-indexed)
    });
  });

  it('anchors on day + month for single-day shape without inline times', () => {
    expect(parseDateRange('Sábado 14 de junio')).toMatchObject({
      startMonth: 5,
    });
  });

  it('does not let the single-day form steal cycle matches', () => {
    // Cycle strings never start with a weekday, but pin the precedence
    // so a future contributor doesn't reorder the forms array and break
    // the multi-month anchor (the canonical Karloff regression).
    expect(parseDateRange('Del 28 de abril al 5 de mayo')).toMatchObject({
      startMonth: 3, // April, not May
    });
  });
});

describe('parseDetailPage (Boris Karloff Parte 2 fixture)', () => {
  const html = fixture('karloff-parte-2.html');
  const program: ProgramLink = {
    slug: 'Boris-Karloff:-el-hombre-y-la-bestia - Parte 2',
    title: 'Boris Karloff: el hombre y la bestia - Parte 2',
    dateRangeText: 'Del 28 de abril al 5 de mayo',
    detailUrl:
      'https://complejoteatral.gob.ar/ver/Boris-Karloff:-el-hombre-y-la-bestia%20-%20Parte%202',
  };

  it('emits all 18 screenings across the 7-day cycle', () => {
    const warnings: string[] = [];
    const screenings = parseDetailPage(html, program, warnings);
    expect(warnings).toEqual([]);
    expect(screenings).toHaveLength(18);
  });

  it('places Martes 28 screenings on April 28, not May 28', () => {
    const warnings: string[] = [];
    const screenings = parseDetailPage(html, program, warnings);

    // Martes 28 = April 28 local BA. 15h BA and 18h BA stay on April 28 UTC.
    // 21h BA rolls to April 29 00:00 UTC — but NOT to May.
    const aprilDates = new Set(
      screenings
        .map((s) => s.startsAtUtc)
        .filter((d) => d.getUTCFullYear() === 2026 && d.getUTCMonth() === 3)
        .map((d) => d.getUTCDate()),
    );

    // Days 28, 29, 30 of April must appear. 21h screenings on Apr 30 roll to
    // May 1, and May 1 has "no hay funciones" — so UTC day 1 of May can
    // legitimately appear via rollover and is not a bug.
    expect(aprilDates.has(28)).toBe(true);
    expect(aprilDates.has(29)).toBe(true);
    expect(aprilDates.has(30)).toBe(true);
  });

  it('does not place any screening on May 28-30 (the old bug manifestation)', () => {
    const warnings: string[] = [];
    const screenings = parseDetailPage(html, program, warnings);

    const mayMisdated = screenings.filter((s) => {
      const d = s.startsAtUtc;
      if (d.getUTCFullYear() !== 2026 || d.getUTCMonth() !== 4) return false;
      const day = d.getUTCDate();
      return day >= 28 && day <= 31;
    });

    expect(mayMisdated).toEqual([]);
  });

  it('emits "El hijo de Frankenstein" at both 15h and 21h on April 28', () => {
    const warnings: string[] = [];
    const screenings = parseDetailPage(html, program, warnings);

    const elHijo = screenings.filter((s) => s.filmTitle === 'El hijo de Frankenstein');
    // Cycle has: Apr 28 (15+21), Apr 30 (18). 3 total.
    expect(elHijo).toHaveLength(3);

    // 15h BA on Apr 28 → 18:00 UTC on Apr 28.
    expect(
      elHijo.some(
        (s) =>
          s.startsAtUtc.getUTCMonth() === 3 &&
          s.startsAtUtc.getUTCDate() === 28 &&
          s.startsAtUtc.getUTCHours() === 18,
      ),
    ).toBe(true);

    // 21h BA on Apr 28 → 00:00 UTC on Apr 29.
    expect(
      elHijo.some(
        (s) =>
          s.startsAtUtc.getUTCMonth() === 3 &&
          s.startsAtUtc.getUTCDate() === 29 &&
          s.startsAtUtc.getUTCHours() === 0,
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S2 — single-film layout (Ojos extraños fixture, captured 2026-04-25)
// ---------------------------------------------------------------------------
describe('matchSingleFilmShowtime', () => {
  it('parses "Jueves 7, 20 horas" as one day at 20:00', () => {
    expect(matchSingleFilmShowtime('Jueves 7, 20 horas')).toEqual({
      days: [7],
      hour: 20,
      minute: 0,
    });
  });

  it('parses decimal-point minutes "Martes 12, 20.30 horas" as 20:30', () => {
    expect(matchSingleFilmShowtime('Martes 12, 20.30 horas')).toEqual({
      days: [12],
      hour: 20,
      minute: 30,
    });
  });

  it('splits "Viernes 8 y sábado 9, 20.30 horas" into two days at 20:30', () => {
    expect(matchSingleFilmShowtime('Viernes 8 y sábado 9, 20.30 horas')).toEqual({
      days: [8, 9],
      hour: 20,
      minute: 30,
    });
  });

  it('also accepts colon as minute separator', () => {
    expect(matchSingleFilmShowtime('Jueves 7, 20:30 horas')).toEqual({
      days: [7],
      hour: 20,
      minute: 30,
    });
  });

  it('returns null for the cycle-style time marker "A las 20 horas"', () => {
    // Cycle-format pages use a different shape — must not be falsely
    // claimed by the single-film matcher.
    expect(matchSingleFilmShowtime('A las 20 horas')).toBeNull();
  });

  it('returns null for non-showtime prose', () => {
    expect(matchSingleFilmShowtime('Director: Some Person')).toBeNull();
    expect(matchSingleFilmShowtime('Color')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // "a las" connector + optional "de MONTH" suffix (Justa-class editorial
  // prose schedules — first observed in the Teresa Villaverde "Justa" cycle
  // 2026-05). The compressed comma form ("Viernes 8 y sábado 9, 20.30 horas")
  // continues to be supported; this just adds the prose-shaped form alongside.
  // -------------------------------------------------------------------------
  it('parses "Sábado 30 a las 18 horas" via the "a las" connector', () => {
    expect(matchSingleFilmShowtime('Sábado 30 a las 18 horas')).toEqual({
      days: [30],
      hour: 18,
      minute: 0,
    });
  });

  it('parses decimal-minute via "a las" form: "Domingo 31 a las 17.30 horas"', () => {
    expect(matchSingleFilmShowtime('Domingo 31 a las 17.30 horas')).toEqual({
      days: [31],
      hour: 17,
      minute: 30,
    });
  });

  it('captures explicit "de MONTH" suffix: "Jueves 28 y viernes 29 de mayo a las 21 horas"', () => {
    expect(
      matchSingleFilmShowtime('Jueves 28 y viernes 29 de mayo a las 21 horas'),
    ).toEqual({
      days: [28, 29],
      hour: 21,
      minute: 0,
      month: 4, // mayo
    });
  });

  it('captures a different month: "Martes 2 y miércoles 3 de junio a las 21 horas"', () => {
    expect(
      matchSingleFilmShowtime('Martes 2 y miércoles 3 de junio a las 21 horas'),
    ).toEqual({
      days: [2, 3],
      hour: 21,
      minute: 0,
      month: 5, // junio
    });
  });

  it('parses single day without explicit month under "a las" form', () => {
    // The line that proves month-context carryover is needed in the caller
    // (Justa line [12]: inherits "junio" from the preceding "Martes 2 y
    // miércoles 3 de junio" line).
    expect(matchSingleFilmShowtime('Jueves 4 a las 18 horas')).toEqual({
      days: [4],
      hour: 18,
      minute: 0,
    });
  });

  it('returns null when "de MONTH" suffix is unrecognized (defensive — would silently drift the date otherwise)', () => {
    expect(
      matchSingleFilmShowtime('Sábado 30 de mesnoexistente a las 18 horas'),
    ).toBeNull();
  });
});

describe('parseDetailPage S2 fallback (Ojos extraños fixture)', () => {
  const html = fixture('ver-ojos-extranos.html');
  const program: ProgramLink = {
    slug: 'Ojos-extraños',
    title: 'Ojos extraños',
    dateRangeText: 'A partir del 7 de mayo',
    detailUrl: 'https://complejoteatral.gob.ar/ver/Ojos-extra%C3%B1os',
  };

  it('emits 7 screenings (May 7, 8, 9, 10, 12, 13, 14) with no warnings', () => {
    const warnings: string[] = [];
    const screenings = parseDetailPage(html, program, warnings);
    expect(warnings).toEqual([]);
    expect(screenings).toHaveLength(7);

    const dates = screenings
      .map((s) => s.startsAtUtc.getTime() - 3 * 3600 * 1000)
      .map((t) => new Date(t).getUTCDate())
      .sort((a, b) => a - b);
    expect(dates).toEqual([7, 8, 9, 10, 12, 13, 14]);

    for (const s of screenings) {
      expect(s.startsAtUtc.getUTCFullYear()).toBe(2026);
      // BA local = UTC - 3, so May 7 BA stays in May UTC most of the day.
      // Showtime hours are 18, 20, 20:30 → UTC 21, 23, 23:30, all same day.
      expect(s.startsAtUtc.getUTCMonth()).toBe(4); // May
    }
  });

  it('places "Viernes 8 y sábado 9, 20.30 horas" at 20:30 BA on both days', () => {
    const warnings: string[] = [];
    const screenings = parseDetailPage(html, program, warnings);
    const friAndSat = screenings
      .filter((s) => {
        const baLocal = new Date(s.startsAtUtc.getTime() - 3 * 3600 * 1000);
        const day = baLocal.getUTCDate();
        return day === 8 || day === 9;
      })
      .sort((a, b) => a.startsAtUtc.getTime() - b.startsAtUtc.getTime());
    expect(friAndSat).toHaveLength(2);
    // 20:30 BA → 23:30 UTC.
    for (const s of friAndSat) {
      expect(s.startsAtUtc.getUTCHours()).toBe(23);
      expect(s.startsAtUtc.getUTCMinutes()).toBe(30);
    }
  });

  it('extracts the editorial synopsis from the SINOPSIS section', () => {
    const screenings = parseDetailPage(html, program, []);
    const s = screenings[0];
    expect(s.synopsisEs).toBeDefined();
    expect(s.synopsisEs!.startsWith('Tras la misteriosa desaparición')).toBe(true);
    // Must not bleed into the FICHA TÉCNICA section that follows.
    expect(s.synopsisEs).not.toMatch(/FICHA T[ÉE]CNICA/i);
    expect(s.synopsisEs).not.toContain('Título original');
  });

  it('extracts FICHA TÉCNICA fields (year, director, country, runtime, original title)', () => {
    const s = parseDetailPage(html, program, [])[0];
    expect(s.year).toBe(2024);
    expect(s.director).toBe('Yeo Siew Hua');
    expect(s.country).toBe('Singapur, Taiwán, Francia, Estados Unidos');
    expect(s.runtimeMin).toBe(126);
    expect(s.filmTitleOriginal).toBe('Mo shi lu');
  });

  it('uses the on_view <h2> title (stripping the "(YEAR)" suffix)', () => {
    const s = parseDetailPage(html, program, [])[0];
    expect(s.filmTitle).toBe('Ojos extraños');
  });
});

describe('parseDetailPage single-day one-off (Chabrol bis fixture)', () => {
  // Captured 2026-05-05 from /ver/Claude-%20Chabrol-bis. The index page
  // exposes this program with dateRangeText "Jueves 28 de mayo, 15 y 18
  // horas" — a single-day form (no "del...al..." range syntax). Before
  // the parseDateRange single-day form was added, the entire program was
  // dropped at the warning at lugones.ts:191. With the fix, the existing
  // S1 layout walker handles the detail page since matchDayHeader already
  // accepts the month-less "Jueves 28" header (lugones.ts:666).
  //
  // Known source-quality limitation: the source page only labels the
  // 15h film ("Bodas sangrientas") with a <strong> title. The 18h film
  // ("Al anochecer") appears only in the prose intro, NOT as a structured
  // <strong> title in its screening block — so emit() skips it (no title).
  // This is a Lugones CMS data-entry gap, not a scraper bug. The test
  // asserts what is structurally extractable; the 18h screening is
  // intentionally not asserted.
  const html = fixture('chabrol-bis.html');
  const program: ProgramLink = {
    slug: 'Claude- Chabrol-bis',
    title: 'Claude Chabrol bis',
    dateRangeText: 'Jueves 28 de mayo, 15 y 18 horas',
    detailUrl: 'https://complejoteatral.gob.ar/ver/Claude-%20Chabrol-bis',
  };

  it('extracts the 15h Bodas sangrientas screening on May 28', () => {
    const warnings: string[] = [];
    const screenings = parseDetailPage(html, program, warnings);

    // No "could not parse date range" warning — the regression itself.
    expect(warnings.find((w) => /could not parse date range/i.test(w))).toBeUndefined();

    const bodas = screenings.filter((s) => s.filmTitle === 'Bodas sangrientas');
    expect(bodas).toHaveLength(1);

    const s = bodas[0];
    // 15h BA → 18:00 UTC on May 28.
    expect(s.startsAtUtc.getUTCMonth()).toBe(4); // May
    expect(s.startsAtUtc.getUTCDate()).toBe(28);
    expect(s.startsAtUtc.getUTCHours()).toBe(18);
    expect(s.director).toBe('Claude Chabrol');
    expect(s.runtimeMin).toBe(95);
  });
});

describe('parseDetailPage Justa-class prose schedule (Justa fixture, captured 2026-05-11)', () => {
  // The bug: Lugones started using an editorial prose schedule format for
  // Justa (Teresa Villaverde 2025), spreading dates across multiple <p>s
  // with the connector "a las" instead of a comma, plus optional
  // "de MONTH" suffixes for the first line of each month. Before the
  // matchSingleFilmShowtime regex was extended, all 45 detail-page <p>s
  // failed to parse and the run logged 0 screenings + a warning. Now the
  // 7 announced funciones come through.
  //
  // Source: https://complejoteatral.gob.ar/ver/Justa
  // Schedule (per the page):
  //   Jueves 28 y viernes 29 de mayo a las 21 horas       → 2026-05-28 21:00, 2026-05-29 21:00
  //   Sábado 30 a las 18 horas                            → 2026-05-30 18:00
  //   Domingo 31 a las 17.30 horas                        → 2026-05-31 17:30
  //   Martes 2 y miércoles 3 de junio a las 21 horas      → 2026-06-02 21:00, 2026-06-03 21:00
  //   Jueves 4 a las 18 horas (inherits junio)            → 2026-06-04 18:00
  const html = fixture('justa.html');
  const program: ProgramLink = {
    slug: 'Justa',
    title: 'Justa',
    dateRangeText: 'A partir del 28 de mayo',
    detailUrl: 'https://complejoteatral.gob.ar/ver/Justa',
  };

  it('emits all 7 announced funciones with no parser warnings', () => {
    const warnings: string[] = [];
    const screenings = parseDetailPage(html, program, warnings);
    expect(warnings).toEqual([]);
    expect(screenings).toHaveLength(7);
  });

  it('produces the announced (date, BA-local-hour, BA-local-minute) tuples exactly', () => {
    const screenings = parseDetailPage(html, program, []);
    // Convert to (month, day, hourBA, minuteBA) tuples for legible asserts.
    // BA is UTC-3 year-round (no DST), so UTC time minus 3h = BA local.
    const tuples = screenings
      .map((s) => {
        const baMs = s.startsAtUtc.getTime() - 3 * 3600 * 1000;
        const d = new Date(baMs);
        return [
          d.getUTCMonth(),
          d.getUTCDate(),
          d.getUTCHours(),
          d.getUTCMinutes(),
        ] as const;
      })
      .sort(([m1, d1], [m2, d2]) => m1 - m2 || d1 - d2);

    expect(tuples).toEqual([
      [4, 28, 21, 0], // mayo 28, 21:00 BA
      [4, 29, 21, 0], // mayo 29, 21:00 BA
      [4, 30, 18, 0], // mayo 30, 18:00 BA
      [4, 31, 17, 30], // mayo 31, 17:30 BA
      [5, 2, 21, 0], // junio 2, 21:00 BA
      [5, 3, 21, 0], // junio 3, 21:00 BA
      [5, 4, 18, 0], // junio 4, 18:00 BA (inherits 'junio' from the preceding line)
    ]);
  });

  it('attaches the film metadata across every screening (single-film page invariant)', () => {
    const screenings = parseDetailPage(html, program, []);
    for (const s of screenings) {
      expect(s.filmTitle).toBe('Justa');
      expect(s.year).toBe(2025); // FICHA TÉCNICA section: "Portugal/Francia, 2025"
      expect(s.director).toBe('Teresa Villaverde');
      expect(s.runtimeMin).toBe(108); // "108 minutos"
    }
  });

  it('does not emit the "0 screenings parsed" warning that surfaced the bug', () => {
    // Pre-fix, the run's warnings included:
    //   program "Justa": 0 screenings parsed from 45 <p> tags...
    // That's the regression guard against the matchSingleFilmShowtime regex
    // tightening back up to comma-only.
    const warnings: string[] = [];
    parseDetailPage(html, program, warnings);
    expect(warnings.find((w) => /0 screenings parsed/i.test(w))).toBeUndefined();
  });
});
