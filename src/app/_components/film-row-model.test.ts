/**
 * Tests for FilmRow's pure view-model helpers — the disclosure day-cap, the
 * multi-venue / "funciones hoy" summary, and the sunk-film lead. These had no
 * coverage and carry the redesign's anti-bloat logic.
 *
 * @/db is mocked only to satisfy the import chain (queries.ts pulls the db
 * client at module load); the helpers under test are pure and never touch it.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ScreeningRow, VenueShowtimes } from '@/db/queries';
import type { ScreeningTag } from '@/db/schema';

vi.mock('@/db', async () => {
  const schema = await vi.importActual<typeof import('@/db/schema')>('@/db/schema');
  return { ...schema, get db() { return undefined; } };
});

const { buildDisclosureVenue, filmRowSummary, filmRowLead, DISCLOSURE_DAY_CAP } = await import(
  './film-row-model'
);
const { groupByFilm } = await import('@/db/queries');

// Thu 2026-06-04 12:00 BA (15:00 UTC).
const NOW = new Date('2026-06-04T15:00:00Z');
const at = (utc: string) => new Date(utc);

let nextId = 1;
function mkRow(opts: {
  filmId: number;
  cinemaId: string;
  startsAtUtc: Date;
  cinemaName?: string;
  tags?: ScreeningTag[];
}): ScreeningRow {
  return {
    id: nextId++,
    startsAtUtc: opts.startsAtUtc,
    tags: opts.tags ?? [],
    sourceUrl: 'https://tickets.example/x',
    programName: null,
    film: {
      id: opts.filmId,
      title: `Film ${opts.filmId}`,
      titleOriginal: null,
      director: null,
      year: null,
      country: null,
      runtimeMin: null,
      synopsisEs: null,
      posterUrl: null,
      backdropUrl: null,
      slug: `film-${opts.filmId}`,
      cast: null,
      genres: null,
      popularity: null,
      voteAverage: null,
      voteCount: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    },
    cinema: {
      id: opts.cinemaId,
      name: opts.cinemaName ?? opts.cinemaId.toUpperCase(),
      neighborhood: null,
      address: null,
      type: 'indie',
    },
  };
}

function venue(screenings: ScreeningRow[]): VenueShowtimes {
  return { cinema: screenings[0].cinema, screenings };
}

describe('buildDisclosureVenue — day grouping + cap', () => {
  it('caps a multi-day venue at DISCLOSURE_DAY_CAP and lists the omitted weekdays', () => {
    // 6 distinct days: Thu 04 … Tue 09, each at 20:00 BA.
    const days = ['04', '05', '06', '07', '08', '09'];
    const v = venue(
      days.map((d) => mkRow({ filmId: 1, cinemaId: 'lugones', startsAtUtc: at(`2026-06-${d}T23:00:00Z`) })),
    );
    const out = buildDisclosureVenue(v, NOW, true);
    expect(out.days).toHaveLength(DISCLOSURE_DAY_CAP);
    // Dropped days are Mon 08 and Tue 09, in order.
    expect(out.omittedDayNames).toEqual(['Lun', 'Mar']);
  });

  it('never caps in the single-day (hoy) window, even with many times', () => {
    // Three times, all on BA day 2026-06-04 (18:00, 20:00, 22:00 BA).
    const v = venue([
      mkRow({ filmId: 1, cinemaId: 'lugones', startsAtUtc: at('2026-06-04T21:00:00Z') }),
      mkRow({ filmId: 1, cinemaId: 'lugones', startsAtUtc: at('2026-06-04T23:00:00Z') }),
      mkRow({ filmId: 1, cinemaId: 'lugones', startsAtUtc: at('2026-06-05T01:00:00Z') }),
    ]);
    const out = buildDisclosureVenue(v, NOW, false);
    expect(out.days).toHaveLength(1);
    expect(out.days[0].times).toHaveLength(3);
    expect(out.omittedDayNames).toEqual([]);
  });
});

describe('filmRowSummary', () => {
  it('single venue → cinema name; hoy uses "funciones hoy"', () => {
    const group = groupByFilm(
      [
        mkRow({ filmId: 1, cinemaId: 'malba', cinemaName: 'MALBA', startsAtUtc: at('2026-06-04T22:00:00Z') }),
        mkRow({ filmId: 1, cinemaId: 'malba', cinemaName: 'MALBA', startsAtUtc: at('2026-06-04T23:30:00Z') }),
      ],
      NOW,
    )[0];
    expect(filmRowSummary(group, false).summaryRest).toBe('2 funciones hoy · MALBA');
    expect(filmRowSummary(group, true).summaryRest).toBe('2 funciones · MALBA');
  });

  it('multiple venues → "{n} salas"', () => {
    const group = groupByFilm(
      [
        mkRow({ filmId: 1, cinemaId: 'malba', startsAtUtc: at('2026-06-04T22:00:00Z') }),
        mkRow({ filmId: 1, cinemaId: 'lugones', startsAtUtc: at('2026-06-04T23:00:00Z') }),
      ],
      NOW,
    )[0];
    expect(filmRowSummary(group, true).venueLabel).toBe('2 salas');
  });
});

describe('filmRowLead', () => {
  it('uses the soonest catchable time', () => {
    const group = groupByFilm(
      [
        mkRow({ filmId: 1, cinemaId: 'malba', startsAtUtc: at('2026-06-04T10:00:00Z') }), // past
        mkRow({ filmId: 1, cinemaId: 'malba', startsAtUtc: at('2026-06-04T22:00:00Z') }), // catchable
      ],
      NOW,
    )[0];
    const lead = filmRowLead(group, false, NOW);
    expect(lead.leadTime).toBe('19:00'); // 22:00 UTC = 19:00 BA
  });

  it('returns nulls for an all-past (sunk) film — never advertise a past time', () => {
    const group = groupByFilm(
      [
        mkRow({ filmId: 1, cinemaId: 'malba', startsAtUtc: at('2026-06-04T10:00:00Z') }),
        mkRow({ filmId: 1, cinemaId: 'malba', startsAtUtc: at('2026-06-04T12:00:00Z') }),
      ],
      NOW,
    )[0];
    expect(group.nextCatchableUtc).toBeNull();
    expect(filmRowLead(group, true, NOW)).toEqual({ leadTime: null, leadDayHint: null });
  });
});
