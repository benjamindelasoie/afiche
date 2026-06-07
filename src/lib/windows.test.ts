/**
 * Tests for the homepage time-window registry.
 *
 * Bounds are computed in BA-local time (fixed UTC-3, no DST), so BA midnight
 * on a date = 03:00 UTC same date. Fixtures pick `now` at BA mid-afternoon
 * (18:00 UTC) so the date is unambiguous, and assert bounds via ISO strings.
 */

import { describe, it, expect } from 'vitest';
import {
  WINDOWS,
  DEFAULT_WINDOW,
  getWindowDef,
  resolveWindowKey,
  windowRenderMode,
  type WindowKey,
} from './windows';

function boundsIso(key: WindowKey, now: Date): { lower: string; upper: string } {
  const { lower, upper } = getWindowDef(key).bounds(now);
  return { lower: lower.toISOString(), upper: upper.toISOString() };
}

describe('WINDOWS registry shape', () => {
  it('exposes exactly hoy/finde/semana/prox in nav order', () => {
    expect(WINDOWS.map((w) => w.key)).toEqual(['hoy', 'finde', 'semana', 'prox']);
  });

  it('default front door is hoy', () => {
    expect(DEFAULT_WINDOW).toBe('hoy');
  });
});

describe('window bounds — hoy', () => {
  it('today 00:00 BA → +1 day, BA midnight aligned', () => {
    // Thu 2026-06-04 15:00 BA (18:00 UTC).
    const b = boundsIso('hoy', new Date('2026-06-04T18:00:00Z'));
    expect(b.lower).toBe('2026-06-04T03:00:00.000Z');
    expect(b.upper).toBe('2026-06-05T03:00:00.000Z');
  });
});

describe('window bounds — semana', () => {
  it('today 00:00 BA → +7 days', () => {
    const b = boundsIso('semana', new Date('2026-06-04T18:00:00Z'));
    expect(b.lower).toBe('2026-06-04T03:00:00.000Z');
    expect(b.upper).toBe('2026-06-11T03:00:00.000Z');
  });
});

describe('window bounds — prox', () => {
  it('today+7 → today+90, BA midnight aligned', () => {
    const b = boundsIso('prox', new Date('2026-06-04T18:00:00Z'));
    expect(b.lower).toBe('2026-06-11T03:00:00.000Z');
    expect(b.upper).toBe('2026-09-02T03:00:00.000Z');
  });
});

describe('window bounds — finde (coming/current weekend)', () => {
  // June 2026: 1=Mon, 5=Fri, 6=Sat, 7=Sun, 8=Mon.
  it('Mon → coming Fri .. next Mon', () => {
    // Mon 2026-06-01.
    const b = boundsIso('finde', new Date('2026-06-01T18:00:00Z'));
    expect(b.lower).toBe('2026-06-05T03:00:00.000Z'); // Fri
    expect(b.upper).toBe('2026-06-08T03:00:00.000Z'); // next Mon
  });

  it('Thu → coming Fri (tomorrow) .. next Mon', () => {
    // Thu 2026-06-04.
    const b = boundsIso('finde', new Date('2026-06-04T18:00:00Z'));
    expect(b.lower).toBe('2026-06-05T03:00:00.000Z'); // Fri
    expect(b.upper).toBe('2026-06-08T03:00:00.000Z'); // Mon
  });

  it('Fri → today .. Mon (weekend underway)', () => {
    // Fri 2026-06-05.
    const b = boundsIso('finde', new Date('2026-06-05T18:00:00Z'));
    expect(b.lower).toBe('2026-06-05T03:00:00.000Z'); // today (Fri)
    expect(b.upper).toBe('2026-06-08T03:00:00.000Z'); // Mon
  });

  it('Sat → today (Sat), not the dead Friday .. Mon', () => {
    // Sat 2026-06-06.
    const b = boundsIso('finde', new Date('2026-06-06T18:00:00Z'));
    expect(b.lower).toBe('2026-06-06T03:00:00.000Z'); // today (Sat), clamps past Fri
    expect(b.upper).toBe('2026-06-08T03:00:00.000Z'); // Mon
  });

  it('Sun → today (Sun) .. Mon', () => {
    // Sun 2026-06-07.
    const b = boundsIso('finde', new Date('2026-06-07T18:00:00Z'));
    expect(b.lower).toBe('2026-06-07T03:00:00.000Z'); // today (Sun)
    expect(b.upper).toBe('2026-06-08T03:00:00.000Z'); // Mon
  });

  it('Sunday-late (23:00 BA) still maps to that Sunday, not Monday', () => {
    // Sun 2026-06-07 23:00 BA = Mon 2026-06-08 02:00 UTC.
    const b = boundsIso('finde', new Date('2026-06-08T02:00:00Z'));
    expect(b.lower).toBe('2026-06-07T03:00:00.000Z'); // still Sunday
    expect(b.upper).toBe('2026-06-08T03:00:00.000Z'); // Mon
  });
});

describe('resolveWindowKey', () => {
  it('returns a valid key unchanged', () => {
    expect(resolveWindowKey('finde')).toBe('finde');
    expect(resolveWindowKey('semana')).toBe('semana');
    expect(resolveWindowKey('prox')).toBe('prox');
    expect(resolveWindowKey('hoy')).toBe('hoy');
  });

  it('falls back to DEFAULT_WINDOW for missing/garbage/empty values', () => {
    expect(resolveWindowKey(undefined)).toBe('hoy');
    expect(resolveWindowKey('')).toBe('hoy');
    expect(resolveWindowKey('manana')).toBe('hoy');
    expect(resolveWindowKey('HOY')).toBe('hoy'); // case-sensitive — unknown → default
  });

  it('uses the first entry when given a string[] (repeated param)', () => {
    expect(resolveWindowKey(['semana', 'hoy'])).toBe('semana');
    expect(resolveWindowKey(['bogus'])).toBe('hoy');
  });
});

describe('windowRenderMode', () => {
  it('hoy is single-day: expanded by default, no day chips', () => {
    expect(windowRenderMode('hoy')).toEqual({ multiDay: false, disclosureDefaultOpen: true });
  });

  it('finde/semana/prox are multi-day: collapsed by default, day chips', () => {
    for (const key of ['finde', 'semana', 'prox'] as const) {
      expect(windowRenderMode(key)).toEqual({ multiDay: true, disclosureDefaultOpen: false });
    }
  });
});
