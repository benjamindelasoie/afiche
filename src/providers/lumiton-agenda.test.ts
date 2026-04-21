/**
 * Tests for the shared Lumiton agenda parser. Complements
 * cine-york.test.ts (which exercises the full parsing contract) by
 * proving the venue-filter slug works correctly for each of the three
 * venues Lumiton operates.
 *
 * The same fixture (test/fixtures/cine-york/agenda-listing.html) is
 * the agenda for ALL three venues — client-side filtering is what
 * separates them in the UI.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseAgenda, type LumitonVenueConfig } from './lumiton-agenda';

const html = readFileSync(
  resolve(__dirname, '../../test/fixtures/cine-york/agenda-listing.html'),
  'utf8',
);

const VENUES: Record<string, LumitonVenueConfig & { expectedCount: number }> = {
  cineYork: {
    cinemaId: 'cine-york',
    displayName: 'Cine York',
    locationSlug: 'cine-york',
    expectedCount: 8,
  },
  munro: {
    cinemaId: 'centro-cultural-munro',
    displayName: 'Centro Cultural Munro',
    locationSlug: 'centro-cultural-munro',
    expectedCount: 7,
  },
  lumiton: {
    cinemaId: 'lumiton',
    displayName: 'Lumiton',
    locationSlug: 'lumiton',
    expectedCount: 2,
  },
};

describe('parseAgenda — venue-slug filtering', () => {
  it('Cine York: 8 events from the fixture', () => {
    const out = parseAgenda(html, VENUES.cineYork, []);
    expect(out).toHaveLength(VENUES.cineYork.expectedCount);
    for (const s of out) expect(s.cinemaId).toBe('cine-york');
  });

  it('Centro Cultural Munro: 7 events from the fixture', () => {
    const out = parseAgenda(html, VENUES.munro, []);
    expect(out).toHaveLength(VENUES.munro.expectedCount);
    for (const s of out) expect(s.cinemaId).toBe('centro-cultural-munro');
  });

  it('Lumiton: 2 events from the fixture', () => {
    const out = parseAgenda(html, VENUES.lumiton, []);
    expect(out).toHaveLength(VENUES.lumiton.expectedCount);
    for (const s of out) expect(s.cinemaId).toBe('lumiton');
  });

  it('venue counts sum to the fixture total (no silent drops, no overlap)', () => {
    // 8 + 7 + 2 = 17 event tiles total in the fixture (none of which
    // are tagged to multiple venues in this snapshot).
    const all = [
      ...parseAgenda(html, VENUES.cineYork, []),
      ...parseAgenda(html, VENUES.munro, []),
      ...parseAgenda(html, VENUES.lumiton, []),
    ];
    expect(all).toHaveLength(17);
  });

  it('an unknown venue slug returns zero screenings without warnings', () => {
    const unknown: LumitonVenueConfig = {
      cinemaId: 'mystery-cinema',
      displayName: 'Mystery',
      locationSlug: 'this-slug-does-not-exist',
    };
    const warnings: string[] = [];
    const out = parseAgenda(html, unknown, warnings);
    expect(out).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
