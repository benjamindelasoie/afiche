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
import {
  parseAgenda,
  parseEventDetail,
  enrichFromDetailPages,
  type LumitonVenueConfig,
} from './lumiton-agenda';
import type { ScrapedScreening } from './types';

const html = readFileSync(
  resolve(__dirname, '../../test/fixtures/cine-york/agenda-listing.html'),
  'utf8',
);

const eventDetailHtml = readFileSync(
  resolve(__dirname, '../../test/fixtures/cine-york/event-vinas-de-ira.html'),
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

// ---------------------------------------------------------------------------
// Event detail page parser — rescues metadata TMDB can't resolve
// ---------------------------------------------------------------------------

describe('parseEventDetail — Viñas de Ira fixture (full metadata)', () => {
  const detail = parseEventDetail(eventDetailHtml);

  it('extracts director from the <b>Dirección</b> label', () => {
    expect(detail.director).toBe('John Ford');
  });

  it('extracts original title from the <b>Título Original</b> label', () => {
    expect(detail.titleOriginal).toBe('Grapes of wrath');
  });

  it('extracts release year (1940) from the .text-sm row', () => {
    expect(detail.year).toBe(1940);
  });

  it('extracts runtime in minutes (129)', () => {
    expect(detail.runtimeMin).toBe(129);
  });

  it('extracts country, stripping trailing punctuation', () => {
    // Source HTML is "EE.UU.."  — we keep the internal dot but trim trailing.
    expect(detail.country).toBe('EE.UU');
  });
});

describe('parseEventDetail — resilience to missing fields', () => {
  it('returns an empty object when the metadata block is absent', () => {
    const html = '<html><body><article><h1>Title only</h1></article></body></html>';
    expect(parseEventDetail(html)).toEqual({});
  });

  it('extracts only the fields that are present (director-only case)', () => {
    const html = `
      <html><body><article>
        <div class="mb-4 uppercase">
          <b>Dirección</b>
          Agnès Varda <br>
        </div>
      </article></body></html>
    `;
    const d = parseEventDetail(html);
    expect(d.director).toBe('Agnès Varda');
    expect(d.titleOriginal).toBeUndefined();
    expect(d.year).toBeUndefined();
    expect(d.runtimeMin).toBeUndefined();
    expect(d.country).toBeUndefined();
  });

  it('handles "90 min" without a trailing dot and infers country only', () => {
    const html = `
      <html><body><article>
        <div class="mb-4 uppercase">
          <div class="text-sm">Francia. 90 min</div>
        </div>
      </article></body></html>
    `;
    const d = parseEventDetail(html);
    expect(d.runtimeMin).toBe(90);
    expect(d.country).toBe('Francia');
    expect(d.year).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Enrichment orchestration — fetch detail pages, dedupe, merge, warn on fail
// ---------------------------------------------------------------------------

function makeScreening(
  sourceUrl: string,
  overrides: Partial<ScrapedScreening> = {},
): ScrapedScreening {
  return {
    cinemaId: 'cine-york',
    filmTitle: 'ANY TITLE',
    startsAtUtc: new Date('2026-04-25T23:30:00Z'),
    tags: [],
    sourceUrl,
    ...overrides,
  };
}

describe('enrichFromDetailPages — dedup, merge, resilience', () => {
  it('fetches each unique detail URL exactly once even when many showtimes share it', async () => {
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      return eventDetailHtml;
    };
    const urlA = 'https://lumiton.ar/evento/vinas-de-ira/';
    const screenings = [
      makeScreening(urlA, { filmTitle: 'VIÑAS DE IRA' }),
      makeScreening(urlA, { filmTitle: 'VIÑAS DE IRA' }),
      makeScreening(urlA, { filmTitle: 'VIÑAS DE IRA' }),
    ];

    await enrichFromDetailPages(screenings, [], fetcher);

    expect(calls).toEqual([urlA]);
    for (const s of screenings) {
      expect(s.director).toBe('John Ford');
      expect(s.filmTitleOriginal).toBe('Grapes of wrath');
      expect(s.year).toBe(1940);
      expect(s.runtimeMin).toBe(129);
    }
  });

  it('skips sourceUrls that fall back to the agenda (no /evento/ path)', async () => {
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      return eventDetailHtml;
    };
    const screenings = [makeScreening('https://lumiton.ar/agenda-presencial/')];

    await enrichFromDetailPages(screenings, [], fetcher);

    expect(calls).toEqual([]);
    expect(screenings[0].director).toBeUndefined();
  });

  it('pushes a warning and leaves agenda data intact when the fetcher throws', async () => {
    const fetcher = async () => {
      throw new Error('HTTP 503');
    };
    const warnings: string[] = [];
    const url = 'https://lumiton.ar/evento/broken/';
    const screenings = [
      makeScreening(url, { filmTitle: 'BROKEN FILM', director: undefined }),
    ];

    await enrichFromDetailPages(screenings, warnings, fetcher);

    expect(screenings[0].director).toBeUndefined();
    expect(screenings[0].filmTitle).toBe('BROKEN FILM');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/HTTP 503/);
    expect(warnings[0]).toContain(url);
  });

  it('does NOT overwrite provider-provided fields — detail data is only a fallback', async () => {
    const fetcher = async () => eventDetailHtml;
    const url = 'https://lumiton.ar/evento/vinas-de-ira/';
    // Imagine a hypothetical future where the agenda pre-populates director.
    const screenings = [makeScreening(url, { director: 'Ford, John (agenda-provided)' })];

    await enrichFromDetailPages(screenings, [], fetcher);

    // Agenda wins — detail page is a fallback, not authoritative.
    expect(screenings[0].director).toBe('Ford, John (agenda-provided)');
    // But fields the agenda didn't set DO get filled from detail.
    expect(screenings[0].year).toBe(1940);
    expect(screenings[0].runtimeMin).toBe(129);
  });
});
