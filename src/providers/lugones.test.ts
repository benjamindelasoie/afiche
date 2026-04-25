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
