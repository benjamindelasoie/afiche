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
import { parseDetailPage, parseDateRange, type ProgramLink } from './lugones';

function fixture(name: string): string {
  return readFileSync(
    resolve(__dirname, '../../test/fixtures/lugones', name),
    'utf8',
  );
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

    const elHijo = screenings.filter(
      (s) => s.filmTitle === 'El hijo de Frankenstein',
    );
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
