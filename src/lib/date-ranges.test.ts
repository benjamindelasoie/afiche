/**
 * Tests for BA-timezone date range helpers.
 *
 * All fixture dates are chosen so the expected BA-local outcome is
 * unambiguous. Argentina is fixed at UTC-3 (no DST), so the conversion
 * is deterministic and these tests don't need to worry about transition
 * edge cases.
 */

import { describe, it, expect } from 'vitest';
import {
  getTodayStartBA,
  getNextIsoMondayBA,
  getIsoWeekStartBA,
  getIsoWeekEndBA,
  getNextMonthStartBA,
} from './date-ranges';

// Helper: assert a Date equals a given ISO string (for readability).
function iso(expected: string, actual: Date): void {
  expect(actual.toISOString()).toBe(expected);
}

describe('getTodayStartBA — today at 00:00 BA as a UTC Date', () => {
  it('Wed 2026-04-22 15:00 BA (18:00 UTC) → 2026-04-22 00:00 BA', () => {
    iso('2026-04-22T03:00:00.000Z', getTodayStartBA(new Date('2026-04-22T18:00:00Z')));
  });

  it('Sun 2026-04-26 23:00 BA (2026-04-27 02:00 UTC) still maps to 2026-04-26 BA', () => {
    // 02:00 UTC on Apr 27 = 23:00 BA on Apr 26 — today-in-BA is still Sunday.
    iso('2026-04-26T03:00:00.000Z', getTodayStartBA(new Date('2026-04-27T02:00:00Z')));
  });

  it('just before midnight BA: Mon 2026-04-20 23:59 BA → 2026-04-20 BA', () => {
    iso('2026-04-20T03:00:00.000Z', getTodayStartBA(new Date('2026-04-21T02:59:00Z')));
  });

  it('right after midnight BA: Tue 2026-04-21 00:01 BA → 2026-04-21 BA', () => {
    iso('2026-04-21T03:00:00.000Z', getTodayStartBA(new Date('2026-04-21T03:01:00Z')));
  });
});

describe('getNextIsoMondayBA — exclusive upper bound of "esta semana"', () => {
  it('Wed 2026-04-22 → next Mon 2026-04-27 00:00 BA', () => {
    iso('2026-04-27T03:00:00.000Z', getNextIsoMondayBA(new Date('2026-04-22T15:00:00Z')));
  });

  it('Mon 2026-04-20 → next Mon 2026-04-27 (not today, next week)', () => {
    // Today IS Monday — current ISO week ends next Monday, 7 days away.
    iso('2026-04-27T03:00:00.000Z', getNextIsoMondayBA(new Date('2026-04-20T15:00:00Z')));
  });

  it('Sun 2026-04-26 → next Mon 2026-04-27 (1 day away)', () => {
    iso('2026-04-27T03:00:00.000Z', getNextIsoMondayBA(new Date('2026-04-26T15:00:00Z')));
  });

  it('Sat 2026-04-25 → next Mon 2026-04-27 (2 days away)', () => {
    iso('2026-04-27T03:00:00.000Z', getNextIsoMondayBA(new Date('2026-04-25T15:00:00Z')));
  });
});

describe('getIsoWeekStartBA — Monday of current ISO week', () => {
  it('Wed 2026-04-22 → Mon 2026-04-20 00:00 BA', () => {
    iso('2026-04-20T03:00:00.000Z', getIsoWeekStartBA(new Date('2026-04-22T15:00:00Z')));
  });

  it('Mon 2026-04-20 → Mon 2026-04-20 (today)', () => {
    iso('2026-04-20T03:00:00.000Z', getIsoWeekStartBA(new Date('2026-04-20T15:00:00Z')));
  });

  it('Sun 2026-04-26 → Mon 2026-04-20 (6 days back)', () => {
    iso('2026-04-20T03:00:00.000Z', getIsoWeekStartBA(new Date('2026-04-26T15:00:00Z')));
  });
});

describe('getIsoWeekEndBA — last instant of Sunday BA', () => {
  it('Wed 2026-04-22 → end of Sun 2026-04-26 (Mon 00:00 minus 1ms)', () => {
    // Mon 2026-04-27 00:00 BA = 2026-04-27T03:00:00Z; minus 1ms = 02:59:59.999Z
    iso('2026-04-27T02:59:59.999Z', getIsoWeekEndBA(new Date('2026-04-22T15:00:00Z')));
  });
});

describe('getNextMonthStartBA — upper bound of "este mes"', () => {
  it('Wed 2026-04-22 → May 1 00:00 BA', () => {
    iso(
      '2026-05-01T03:00:00.000Z',
      getNextMonthStartBA(new Date('2026-04-22T15:00:00Z')),
    );
  });

  it('Thu 2026-04-30 (end of April) → May 1 00:00 BA', () => {
    iso(
      '2026-05-01T03:00:00.000Z',
      getNextMonthStartBA(new Date('2026-04-30T15:00:00Z')),
    );
  });

  it('Dec 2026-12-15 rolls over year: → Jan 1 2027 00:00 BA', () => {
    iso(
      '2027-01-01T03:00:00.000Z',
      getNextMonthStartBA(new Date('2026-12-15T15:00:00Z')),
    );
  });

  it('Jan 2026-01-05 → Feb 1 00:00 BA', () => {
    iso(
      '2026-02-01T03:00:00.000Z',
      getNextMonthStartBA(new Date('2026-01-05T15:00:00Z')),
    );
  });
});

describe('edge case: week crosses month boundary makes "este mes" empty', () => {
  it('Tue 2026-04-28 → weekEnd (May 4) > monthEnd (May 1), este mes empty', () => {
    const now = new Date('2026-04-28T15:00:00Z');
    const weekEnd = getNextIsoMondayBA(now);
    const monthEnd = getNextMonthStartBA(now);
    // este-mes range is [weekEnd, monthEnd). When weekEnd > monthEnd, the
    // range is inverted, which means the section has zero screenings by
    // definition.
    expect(weekEnd.getTime()).toBeGreaterThan(monthEnd.getTime());
  });

  it('Wed 2026-04-22 → weekEnd (Apr 27) < monthEnd (May 1), este mes = 4 days', () => {
    const now = new Date('2026-04-22T15:00:00Z');
    const weekEnd = getNextIsoMondayBA(now);
    const monthEnd = getNextMonthStartBA(now);
    expect(weekEnd.getTime()).toBeLessThan(monthEnd.getTime());
    const daysInEsteMes = (monthEnd.getTime() - weekEnd.getTime()) / 86_400_000;
    expect(daysInEsteMes).toBe(4);
  });
});
