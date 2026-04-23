/**
 * Tests for the edition number + dateline composer.
 *
 * ISO-8601 week spec: a week runs Mon–Sun, and the year it belongs to
 * is the year that contains the majority of its days. This means:
 *   - Dec 29–31 can belong to week 1 of the NEXT year (e.g., 2024-12-31 → 2025 W1)
 *   - Jan 1–3 can belong to week 52/53 of the PREVIOUS year (e.g., 2023-01-01 → 2022 W52)
 *
 * These edge cases are locked down here so a future refactor or library
 * swap can't silently change the masthead number across year boundaries.
 */

import { describe, it, expect } from 'vitest';
import { getEditionNumber, editionFullSentence } from './iso-week';

describe('getEditionNumber — ISO 8601 week of year', () => {
  it('standard mid-year date: 2026-04-26 → week 17', () => {
    expect(getEditionNumber(new Date('2026-04-26'))).toBe(17);
  });

  it('leap year Feb 29: 2024-02-29 → week 9', () => {
    expect(getEditionNumber(new Date('2024-02-29'))).toBe(9);
  });

  it('Dec 31 Sunday belonging to previous-year last week: 2023-12-31 → week 52', () => {
    // 2023-12-31 is a Sunday. The ISO week containing it (Mon 2023-12-25 →
    // Sun 2023-12-31) is fully in 2023, so it's week 52 of 2023.
    expect(getEditionNumber(new Date('2023-12-31'))).toBe(52);
  });

  it('Jan 1 belonging to previous-year last week: 2023-01-01 → week 52 (of 2022)', () => {
    // 2023-01-01 is a Sunday. The ISO week (Mon 2022-12-26 → Sun 2023-01-01)
    // has 6 days in 2022 and 1 in 2023, so it's week 52 of 2022.
    expect(getEditionNumber(new Date('2023-01-01'))).toBe(52);
  });

  it('Dec 31 belonging to next-year first week: 2024-12-31 → week 1 (of 2025)', () => {
    // 2024-12-31 is a Tuesday. The ISO week (Mon 2024-12-30 → Sun 2025-01-05)
    // has 2 days in 2024 and 5 in 2025, so it's week 1 of 2025.
    expect(getEditionNumber(new Date('2024-12-31'))).toBe(1);
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
    ).toBe(
      'Edición número 17. Semana del 23 al 30 de abril. 81 funciones en 5 salas.',
    );
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
    ).toBe(
      'Edición número 5. Semana del 1 al 7 de febrero. 1 función en 3 salas.',
    );
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
