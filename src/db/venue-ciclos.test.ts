/**
 * Unit tests for the venue-page (/sala/<id>) pure helpers:
 *   - groupCiclos       — programName → ciclo grouping for "Ciclos en curso"
 *   - visibleAgendaDays — expired-today + empty-day filter (the regression
 *                         Codex flagged: the 14-day lower bound is BA midnight,
 *                         so today carries already-started rows, and
 *                         fillTwoWeeks inserts empty days)
 *
 * Both are pure functions over in-memory fixtures — no DB needed.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ScreeningRow, DayGroup } from './queries';

// queries.ts → ./index → ./client throws without DATABASE_URL. groupCiclos and
// visibleAgendaDays are pure (never touch the db), so a bare stub is enough to
// let the module import. Same mock-then-dynamic-import pattern as queries.test.ts.
vi.mock('@/db', async () => {
  const schema = await vi.importActual<typeof import('@/db/schema')>('@/db/schema');
  return { ...schema, db: {} };
});

const { groupCiclos, visibleAgendaDays } = await import('./queries');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
let nextId = 1;

function screening(over: {
  filmId: number;
  startsAt: Date;
  programName?: string | null;
}): ScreeningRow {
  return {
    id: nextId++,
    startsAtUtc: over.startsAt,
    tags: [],
    sourceUrl: null,
    programName: over.programName ?? null,
    film: {
      id: over.filmId,
      title: `Film ${over.filmId}`,
      titleOriginal: null,
      director: null,
      year: null,
      country: null,
      runtimeMin: null,
      synopsisEs: null,
      posterUrl: null,
      backdropUrl: null,
      slug: `film-${over.filmId}`,
      cast: null,
      genres: null,
    },
    cinema: {
      id: 'malba',
      name: 'MALBA',
      neighborhood: 'Palermo',
      address: null,
      type: 'indie',
    },
  };
}

function day(dateKey: string, screenings: ScreeningRow[], isToday = false): DayGroup {
  return { dateKey, label: dateKey, isToday, screenings };
}

const D = (iso: string) => new Date(iso);

// ---------------------------------------------------------------------------
// groupCiclos
// ---------------------------------------------------------------------------
describe('groupCiclos', () => {
  it('groups screenings by programName into one ciclo per program', () => {
    const rows = [
      screening({
        filmId: 1,
        startsAt: D('2026-05-25T21:00:00Z'),
        programName: 'Retrospectiva David Lynch',
      }),
      screening({
        filmId: 2,
        startsAt: D('2026-05-26T23:00:00Z'),
        programName: 'Retrospectiva David Lynch',
      }),
    ];
    const ciclos = groupCiclos(rows);
    expect(ciclos).toHaveLength(1);
    expect(ciclos[0].name).toBe('Retrospectiva David Lynch');
    expect(ciclos[0].slug).toBe('retrospectiva-david-lynch');
  });

  it('skips screenings with null/blank programName', () => {
    const rows = [
      screening({ filmId: 1, startsAt: D('2026-05-25T21:00:00Z'), programName: null }),
      screening({ filmId: 2, startsAt: D('2026-05-25T23:00:00Z'), programName: '   ' }),
    ];
    expect(groupCiclos(rows)).toEqual([]);
  });

  it('counts DISTINCT films — a film screened multiple times counts once', () => {
    const rows = [
      screening({
        filmId: 7,
        startsAt: D('2026-05-25T21:00:00Z'),
        programName: 'Ciclo X',
      }),
      screening({
        filmId: 7,
        startsAt: D('2026-05-27T21:00:00Z'),
        programName: 'Ciclo X',
      }),
      screening({
        filmId: 8,
        startsAt: D('2026-05-28T21:00:00Z'),
        programName: 'Ciclo X',
      }),
    ];
    expect(groupCiclos(rows)[0].filmCount).toBe(2);
  });

  it('spans firstStartsAt/lastStartsAt across all screenings, anchors on the earliest', () => {
    const early = screening({
      filmId: 1,
      startsAt: D('2026-05-25T21:00:00Z'),
      programName: 'Ciclo Y',
    });
    const late = screening({
      filmId: 2,
      startsAt: D('2026-06-10T21:00:00Z'),
      programName: 'Ciclo Y',
    });
    // Pass out of order to prove sorting.
    const c = groupCiclos([late, early])[0];
    expect(c.firstStartsAt).toEqual(early.startsAtUtc);
    expect(c.lastStartsAt).toEqual(late.startsAtUtc);
    expect(c.anchorScreeningId).toBe(early.id);
  });

  it('normalizes the grouping key — accent/case/whitespace drift stays one ciclo', () => {
    const rows = [
      screening({
        filmId: 1,
        startsAt: D('2026-05-25T21:00:00Z'),
        programName: 'Ciclo Almodóvar',
      }),
      screening({
        filmId: 2,
        startsAt: D('2026-05-26T21:00:00Z'),
        programName: 'CICLO  almodovar',
      }),
    ];
    const ciclos = groupCiclos(rows);
    expect(ciclos).toHaveLength(1);
    expect(ciclos[0].slug).toBe('ciclo-almodovar');
  });

  it('falls back to "ciclo" slug for an all-punctuation program name', () => {
    const ciclos = groupCiclos([
      screening({ filmId: 1, startsAt: D('2026-05-25T21:00:00Z'), programName: '!!!' }),
    ]);
    expect(ciclos[0].slug).toBe('ciclo');
  });

  it('returns ciclos ordered by first screening', () => {
    const rows = [
      screening({
        filmId: 1,
        startsAt: D('2026-06-01T21:00:00Z'),
        programName: 'Segundo',
      }),
      screening({
        filmId: 2,
        startsAt: D('2026-05-25T21:00:00Z'),
        programName: 'Primero',
      }),
    ];
    expect(groupCiclos(rows).map((c) => c.name)).toEqual(['Primero', 'Segundo']);
  });

  it('returns [] for empty input', () => {
    expect(groupCiclos([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// visibleAgendaDays
// ---------------------------------------------------------------------------
describe('visibleAgendaDays', () => {
  const now = D('2026-05-25T20:00:00Z'); // BA 17:00

  it('drops screenings that already started (past + grace) from today', () => {
    const today = day(
      '2026-05-25',
      [
        screening({ filmId: 1, startsAt: D('2026-05-25T18:00:00Z') }), // 2h ago — expired
        screening({ filmId: 2, startsAt: D('2026-05-25T23:00:00Z') }), // future — kept
      ],
      true,
    );
    const [visible] = visibleAgendaDays([today], now);
    expect(visible.screenings.map((s) => s.film.id)).toEqual([2]);
  });

  it('drops a day that becomes empty after expiry filtering', () => {
    const today = day(
      '2026-05-25',
      [screening({ filmId: 1, startsAt: D('2026-05-25T18:00:00Z') })], // expired
      true,
    );
    expect(visibleAgendaDays([today], now)).toEqual([]);
  });

  it('drops fully-empty filler days (fillTwoWeeks inserts them)', () => {
    const empty = day('2026-05-27', []);
    const future = day('2026-05-28', [
      screening({ filmId: 3, startsAt: D('2026-05-28T21:00:00Z') }),
    ]);
    expect(visibleAgendaDays([empty, future], now).map((d) => d.dateKey)).toEqual([
      '2026-05-28',
    ]);
  });

  it('keeps future days untouched', () => {
    const future = day('2026-05-30', [
      screening({ filmId: 4, startsAt: D('2026-05-30T21:00:00Z') }),
    ]);
    expect(visibleAgendaDays([future], now)).toHaveLength(1);
  });
});
