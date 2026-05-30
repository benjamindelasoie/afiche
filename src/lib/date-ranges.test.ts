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
  getStartOfWeekAfterNextBA,
  isScreeningExpired,
  SCREENING_GRACE_MS,
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

describe('getStartOfWeekAfterNextBA — exclusive upper bound of "próxima semana"', () => {
  it('Wed 2026-04-22 → Mon 2026-05-04 00:00 BA (next-next Monday)', () => {
    iso(
      '2026-05-04T03:00:00.000Z',
      getStartOfWeekAfterNextBA(new Date('2026-04-22T15:00:00Z')),
    );
  });

  it('always exactly 7 days after getNextIsoMondayBA, regardless of weekday', () => {
    const days = [
      '2026-04-20T15:00:00Z', // Mon
      '2026-04-23T15:00:00Z', // Thu
      '2026-04-26T15:00:00Z', // Sun
    ];
    for (const d of days) {
      const now = new Date(d);
      const span =
        getStartOfWeekAfterNextBA(now).getTime() - getNextIsoMondayBA(now).getTime();
      expect(span).toBe(7 * 86_400_000);
    }
  });

  it('end-of-month no longer collapses Tier 2: Tue 2026-04-28 → Mon 2026-05-11', () => {
    // Old design: Tier 2 ended at next month start (May 1), and on Apr 28
    // weekEnd (May 4) was already past it → Tier 2 collapsed to 0 days.
    // New design: Tier 2 always ends Monday-after-next, so May 1 lands
    // squarely in the Tier 2 window for an Apr 28 visitor.
    iso(
      '2026-05-11T03:00:00.000Z',
      getStartOfWeekAfterNextBA(new Date('2026-04-28T15:00:00Z')),
    );
  });
});

describe('isScreeningExpired — 15-min grace past startsAtUtc', () => {
  // Anchor "now" at a round UTC instant; the helper only cares about
  // instant comparison (no BA-tz math), so we don't need fixture dates
  // tied to BA wall time here.
  const now = new Date('2026-05-20T22:00:00.000Z');

  it('grace constant is exactly 15 minutes', () => {
    expect(SCREENING_GRACE_MS).toBe(15 * 60 * 1000);
  });

  it('future screening is not expired', () => {
    const startsAt = new Date(now.getTime() + 60 * 60 * 1000); // +1h
    expect(isScreeningExpired(startsAt, now)).toBe(false);
  });

  it('screening starting exactly at "now" is not expired (grace still applies)', () => {
    expect(isScreeningExpired(now, now)).toBe(false);
  });

  it('screening that started 14:59 ago is still within grace → not expired', () => {
    const startsAt = new Date(now.getTime() - (14 * 60 + 59) * 1000);
    expect(isScreeningExpired(startsAt, now)).toBe(false);
  });

  it('screening that started exactly 15:00 ago is at the boundary → not expired', () => {
    // Predicate is `startsAt + 15min < now`, strict <. At exactly 15:00 ago,
    // startsAt + 15min === now, so not expired yet.
    const startsAt = new Date(now.getTime() - 15 * 60 * 1000);
    expect(isScreeningExpired(startsAt, now)).toBe(false);
  });

  it('screening that started 15:01 ago is expired', () => {
    const startsAt = new Date(now.getTime() - (15 * 60 + 1) * 1000);
    expect(isScreeningExpired(startsAt, now)).toBe(true);
  });

  it('screening that started 3 hours ago is expired', () => {
    const startsAt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    expect(isScreeningExpired(startsAt, now)).toBe(true);
  });
});
