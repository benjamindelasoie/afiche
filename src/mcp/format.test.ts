import { describe, it, expect } from 'vitest';
import {
  toBAISO,
  formatBALabel,
  toShowtime,
  toFilmDTO,
  toVenues,
  catchable,
  filmUrl,
} from './format';
import { SITE_URL } from '@/lib/site';
import type { ScreeningRow } from '@/db/queries';

function film(over: Partial<ScreeningRow['film']> = {}): ScreeningRow['film'] {
  return {
    id: 1,
    title: 'Blue Velvet',
    titleOriginal: 'Blue Velvet',
    director: 'David Lynch',
    year: 1986,
    country: 'US',
    runtimeMin: 120,
    synopsisEs: 'Un misterio en un pueblo.',
    posterUrl: 'https://cdn/p.jpg',
    backdropUrl: null,
    slug: 'blue-velvet',
    cast: [{ name: 'Kyle MacLachlan', character: 'Jeffrey' }],
    genres: [18, 9648], // Drama, Misterio
    popularity: 1,
    voteAverage: 7.7,
    voteCount: 100,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    ...over,
  };
}

function row(over: Partial<ScreeningRow> = {}): ScreeningRow {
  return {
    id: 42,
    startsAtUtc: new Date('2026-06-18T23:30:00Z'), // 20:30 BA
    tags: ['vos'],
    sourceUrl: 'https://venue/x',
    programName: null,
    film: film(),
    cinema: {
      id: 'malba',
      name: 'MALBA',
      neighborhood: 'Palermo',
      address: 'a',
      type: 'indie',
    },
    ...over,
  };
}

describe('format helpers', () => {
  it('toBAISO stamps the fixed -03:00 BA offset', () => {
    expect(toBAISO(new Date('2026-06-18T23:30:00Z'))).toBe('2026-06-18T20:30:00-03:00');
    // Crossing UTC midnight backwards: 01:00Z → 22:00 prev day BA.
    expect(toBAISO(new Date('2026-06-18T01:00:00Z'))).toBe('2026-06-17T22:00:00-03:00');
  });

  it('formatBALabel renders BA time in the label', () => {
    expect(formatBALabel(new Date('2026-06-18T23:30:00Z'))).toContain('20:30');
  });

  it('toShowtime maps tags to ES labels and builds the ics URL', () => {
    const s = toShowtime(row());
    expect(s.startsAt).toBe('2026-06-18T20:30:00-03:00');
    expect(s.tags).toEqual(['VOS']);
    expect(s.icsUrl).toBe(`${SITE_URL}/api/screening/42/ics`);
    expect(s.sourceUrl).toBe('https://venue/x');
  });

  it('toFilmDTO resolves genre labels and builds the film URL', () => {
    const dto = toFilmDTO(film());
    expect(dto.genres).toEqual(['Drama', 'Misterio']);
    expect(dto.url).toBe(`${SITE_URL}/pelicula/blue-velvet`);
    expect(dto.runtimeMin).toBe(120);
    expect(dto.synopsis).toBe('Un misterio en un pueblo.');
  });

  it('toFilmDTO 0-numeric guard: 0 runtime / 0 votes / null slug → null (no literal 0)', () => {
    const dto = toFilmDTO(
      film({ runtimeMin: 0, voteAverage: 0, slug: null, cast: null, genres: null }),
    );
    expect(dto.runtimeMin).toBeNull();
    expect(dto.voteAverage).toBeNull();
    expect(dto.url).toBeNull();
    expect(dto.cast).toEqual([]);
    expect(dto.genres).toEqual([]);
  });

  it('filmUrl returns null for a null slug', () => {
    expect(filmUrl(null)).toBeNull();
    expect(filmUrl('x')).toBe(`${SITE_URL}/pelicula/x`);
  });

  it('catchable drops screenings that already started (15-min grace)', () => {
    const now = new Date('2026-06-18T23:30:00Z');
    const past = row({ id: 1, startsAtUtc: new Date('2026-06-18T23:10:00Z') }); // 20min ago
    const grace = row({ id: 2, startsAtUtc: new Date('2026-06-18T23:20:00Z') }); // 10min ago, within grace
    const future = row({ id: 3, startsAtUtc: new Date('2026-06-19T00:30:00Z') });
    const kept = catchable([past, grace, future], now);
    expect(kept.map((r) => r.id)).toEqual([2, 3]);
  });

  it('toVenues groups a flat list by cinema preserving order', () => {
    const rows = [
      row({
        id: 1,
        cinema: {
          id: 'malba',
          name: 'MALBA',
          neighborhood: 'Palermo',
          address: null,
          type: 'indie',
        },
      }),
      row({
        id: 2,
        cinema: {
          id: 'lugones',
          name: 'Lugones',
          neighborhood: 'San Nicolás',
          address: null,
          type: 'indie',
        },
      }),
      row({
        id: 3,
        cinema: {
          id: 'malba',
          name: 'MALBA',
          neighborhood: 'Palermo',
          address: null,
          type: 'indie',
        },
      }),
    ];
    const venues = toVenues(rows);
    expect(venues.map((v) => v.cinema.id)).toEqual(['malba', 'lugones']);
    expect(venues[0].showtimes).toHaveLength(2);
    expect(venues[1].showtimes).toHaveLength(1);
  });
});
