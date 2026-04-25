/**
 * Tests for the edition number + dateline composer.
 *
 * Edition number is launch-anchored: Nº 1 = week of Monday 2026-04-27
 * (Afiche's launch week). Each subsequent ISO week (Mon→Sun in BA local,
 * UTC-3, no DST) increments the counter by 1.
 *
 * Pre-launch weeks clamp to Nº 1 so the masthead never shows 0 or
 * negatives if the page is reached before the launch date.
 */

import { describe, it, expect } from 'vitest';
import { getEditionNumber, editionFullSentence } from './iso-week';
import { getIsoWeekStartBA } from './date-ranges';

describe('getEditionNumber — launch-anchored counter', () => {
  // Convenience: pass any Date in the target week and let getIsoWeekStartBA
  // resolve it to the Monday 00:00 BA UTC instant the counter expects.
  function editionFor(isoString: string): number {
    return getEditionNumber(getIsoWeekStartBA(new Date(isoString)));
  }

  it('week of Mon 2026-04-27 (launch week) → Nº 1', () => {
    expect(editionFor('2026-04-27T15:00:00Z')).toBe(1);
  });

  it('any day inside the launch week resolves to Nº 1', () => {
    // Sun 2026-05-03 is still in launch week (Mon→Sun ISO).
    expect(editionFor('2026-05-03T15:00:00Z')).toBe(1);
  });

  it('week of Mon 2026-05-04 (one week after launch) → Nº 2', () => {
    expect(editionFor('2026-05-04T15:00:00Z')).toBe(2);
  });

  it('week of Mon 2026-05-11 → Nº 3', () => {
    expect(editionFor('2026-05-11T15:00:00Z')).toBe(3);
  });

  it('twelve weeks after launch → Nº 13', () => {
    // 2026-04-27 + 84 days = 2026-07-20 Monday.
    expect(editionFor('2026-07-20T15:00:00Z')).toBe(13);
  });

  it('pre-launch dates clamp to Nº 1 (the week before launch)', () => {
    // Mon 2026-04-20 is one week BEFORE launch. Clamps to 1, not 0.
    expect(editionFor('2026-04-20T15:00:00Z')).toBe(1);
  });

  it('far pre-launch dates clamp to Nº 1, not negative numbers', () => {
    // 2026-01-05: ~16 weeks before launch.
    expect(editionFor('2026-01-05T15:00:00Z')).toBe(1);
  });

  it('survives a year-end boundary cleanly (no ISO week-of-year reset)', () => {
    // 2026-12-28 Monday is 35 weeks past launch. Old ISO-week-of-year
    // would have returned ~52; the launch-anchored counter keeps counting.
    expect(editionFor('2026-12-28T15:00:00Z')).toBe(36);
  });
});

describe('editionFullSentence — screen reader dateline', () => {
  it('composes a full Spanish sentence with plural counts', () => {
    expect(
      editionFullSentence({
        editionNumber: 17,
        weekRangeLabel: '23 al 30 de abril',
        totalScreenings: 81,
        distinctCinemas: 5,
        isWeekSpan: true,
      }),
    ).toBe('Edición número 17. Semana del 23 al 30 de abril. 81 funciones en 5 salas.');
  });

  it('uses singular "función" / "sala" when exactly one of each', () => {
    expect(
      editionFullSentence({
        editionNumber: 1,
        weekRangeLabel: '1 de enero',
        totalScreenings: 1,
        distinctCinemas: 1,
        isWeekSpan: true,
      }),
    ).toBe('Edición número 1. Semana del 1 de enero. 1 función en 1 sala.');
  });

  it('mixes singular + plural correctly (1 función · 3 salas)', () => {
    expect(
      editionFullSentence({
        editionNumber: 5,
        weekRangeLabel: '1 al 7 de febrero',
        totalScreenings: 1,
        distinctCinemas: 3,
        isWeekSpan: true,
      }),
    ).toBe('Edición número 5. Semana del 1 al 7 de febrero. 1 función en 3 salas.');
  });

  it('drops "Semana del" when range spans more than a week', () => {
    // A 34-day Lugones cycle labelled "Semana del" would be dishonest.
    // When isWeekSpan is false, use "Próximas funciones del X al Y" instead.
    expect(
      editionFullSentence({
        editionNumber: 17,
        weekRangeLabel: '23 de abril al 27 de mayo',
        totalScreenings: 81,
        distinctCinemas: 5,
        isWeekSpan: false,
      }),
    ).toBe(
      'Edición número 17. Próximas funciones del 23 de abril al 27 de mayo. 81 funciones en 5 salas.',
    );
  });
});
