/**
 * Tests for the CINTA provider.
 *
 * Fixture: test/fixtures/cinta/sitio-listing.html — captured 2026-09-08 from
 * https://www.passline.com/sitio/cinta-proyecciones. It is the post-challenge
 * DOM (see the Cloudflare note in cinta.ts), which is byte-for-byte the markup
 * a browser renders, so the same fixture pins both fetch paths.
 *
 * It is a real full cycle: seven films, each with a Primer and a Segundo
 * Turno, a mix of sold-out and on-sale, and one hyphenated title
 * ("Punch-Drunk-Love") that exists here to keep the title stripper honest.
 *
 * When Passline changes its template these tests fail and we refresh.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseListing,
  parseEventTitle,
  parseSpanishDateTime,
  looksLikeListing,
} from './cinta';

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, '../../test/fixtures/cinta', name), 'utf8');
}

const LISTING = fixture('sitio-listing.html');

/** Before every function in the fixture, so they all read as upcoming. */
const BEFORE_ALL = new Date(Date.UTC(2026, 8, 1)); // 2026-09-01

describe('parseEventTitle', () => {
  it('strips the DD/MM + turno suffix Passline needs for unique event names', () => {
    expect(parseEventTitle('Midnight in Paris 09/09 - Primer Turno')).toBe(
      'Midnight in Paris',
    );
    expect(parseEventTitle('Lost in Translation 10/09 - Segundo Turno')).toBe(
      'Lost in Translation',
    );
  });

  it('keeps hyphens and parentheses that belong to the film title', () => {
    // Anchoring the strip on the date stamp rather than the dash is the whole
    // reason this one survives.
    expect(parseEventTitle('Punch-Drunk-Love 27/09 - Primer Turno')).toBe(
      'Punch-Drunk-Love',
    );
    expect(parseEventTitle('(500) Days of Summer 14/09 - Primer Turno')).toBe(
      '(500) Days of Summer',
    );
  });

  it('falls back to the turno suffix when the date is dropped', () => {
    expect(parseEventTitle('Perfect Days - Primer Turno')).toBe('Perfect Days');
    expect(parseEventTitle('Punch-Drunk-Love - Segundo Turno')).toBe('Punch-Drunk-Love');
  });

  it('leaves a plain title untouched', () => {
    expect(parseEventTitle('  Blade Runner  ')).toBe('Blade Runner');
    expect(parseEventTitle('Sunset Boulevard')).toBe('Sunset Boulevard');
  });

  it('handles a four-digit year in the stamp', () => {
    expect(parseEventTitle('Amélie 16/09/2026 - Primer Turno')).toBe('Amélie');
  });
});

describe('parseSpanishDateTime', () => {
  it('converts BA wall-clock to UTC with the constant +3h shift', () => {
    expect(parseSpanishDateTime('09 de Septiembre 2026 a las 19:10')?.toISOString()).toBe(
      '2026-09-09T22:10:00.000Z',
    );
    // Late turnos cross midnight UTC — the exact case a naive same-day
    // construction gets wrong.
    expect(parseSpanishDateTime('30 de Septiembre 2026 a las 21:15')?.toISOString()).toBe(
      '2026-10-01T00:15:00.000Z',
    );
  });

  it('accepts both Argentine spellings of September and any casing', () => {
    const a = parseSpanishDateTime('13 de septiembre 2026 a las 19:10');
    const b = parseSpanishDateTime('13 de Setiembre 2026 a las 19:10');
    expect(a?.toISOString()).toBe('2026-09-13T22:10:00.000Z');
    expect(b?.toISOString()).toBe(a?.toISOString());
  });

  it('tolerates the surrounding whitespace and icon markup of the real cell', () => {
    expect(
      parseSpanishDateTime(
        '\n\n      16 de Septiembre 2026 a las 21:25       ',
      )?.toISOString(),
    ).toBe('2026-09-17T00:25:00.000Z');
  });

  it('returns null rather than a rolled-forward date for impossible input', () => {
    expect(parseSpanishDateTime('31 de Febrero 2026 a las 19:10')).toBeNull();
    expect(parseSpanishDateTime('09 de Brumario 2026 a las 19:10')).toBeNull();
    expect(parseSpanishDateTime('09 de Septiembre 2026 a las 99:10')).toBeNull();
    expect(parseSpanishDateTime('proximamente')).toBeNull();
  });
});

describe('looksLikeListing', () => {
  it('recognises the real listing', () => {
    expect(looksLikeListing(LISTING)).toBe(true);
  });

  it('rejects a Cloudflare interstitial, which is what a bare fetch gets', () => {
    expect(
      looksLikeListing(
        '<html><body>Performing security verification…<div id="challenge"></div></body></html>',
      ),
    ).toBe(false);
  });
});

describe('parseListing', () => {
  it('emits one screening per turno, in listing order', () => {
    const out = parseListing(LISTING, BEFORE_ALL);

    // Seven films, two turnos each.
    expect(out).toHaveLength(14);
    expect(out.map((s) => s.filmTitle)).toEqual([
      'Midnight in Paris',
      'Midnight in Paris',
      'Lost in Translation',
      'Lost in Translation',
      'The Secret Life of Walter Mitty',
      'The Secret Life of Walter Mitty',
      '(500) Days of Summer',
      '(500) Days of Summer',
      'The Perks of Being a Wallflower',
      'The Perks of Being a Wallflower',
      'Punch-Drunk-Love',
      'Punch-Drunk-Love',
      'The Spectacular Now',
      'The Spectacular Now',
    ]);
  });

  it('keeps the two turnos of a night as distinct UTC instants', () => {
    const out = parseListing(LISTING, BEFORE_ALL);
    const midnight = out.filter((s) => s.filmTitle === 'Midnight in Paris');

    expect(midnight.map((s) => s.startsAtUtc.toISOString())).toEqual([
      '2026-09-09T22:10:00.000Z', // 19:10 BA
      '2026-09-10T00:15:00.000Z', // 21:15 BA
    ]);
  });

  it('links each screening at its own Passline event page', () => {
    const out = parseListing(LISTING, BEFORE_ALL);

    expect(out[0].sourceUrl).toBe(
      'https://www.passline.com/sitio-evento/midnight-in-paris-0909-primer-turno',
    );
    expect(out.every((s) => /^https:\/\/www\.passline\.com\//.test(s.sourceUrl))).toBe(
      true,
    );
  });

  it('stamps every screening with the cinema id and no invented metadata', () => {
    const out = parseListing(LISTING, BEFORE_ALL);

    for (const s of out) {
      expect(s.cinemaId).toBe('cinta');
      expect(s.tags).toEqual([]);
      // The listing exposes none of these; TMDB enrichment fills them in.
      expect(s.year).toBeUndefined();
      expect(s.director).toBeUndefined();
      expect(s.programName).toBeUndefined();
    }
  });

  it('keeps sold-out functions — a full house is still programming', () => {
    // Every 09/09 and 10/09 function is marked AGOTADAS in the fixture.
    const out = parseListing(LISTING, BEFORE_ALL);
    expect(out.filter((s) => s.filmTitle === 'Lost in Translation')).toHaveLength(2);
  });

  it('drops functions already past, which the producer page retains', () => {
    // Pinned mid-cycle: everything up to and including 16/09 has gone.
    const midCycle = new Date(Date.UTC(2026, 8, 20)); // 2026-09-20
    const out = parseListing(LISTING, midCycle);

    expect(out.map((s) => s.filmTitle)).toEqual([
      'Punch-Drunk-Love',
      'Punch-Drunk-Love',
      'The Spectacular Now',
      'The Spectacular Now',
    ]);
  });

  it('stays quiet while every function is billed at the home terrace', () => {
    const warnings: string[] = [];
    parseListing(LISTING, BEFORE_ALL, warnings);
    expect(warnings).toEqual([]);
  });

  it('warns once per off-site room, because the rendered address is Palermo', () => {
    // CINTA tours (their own IG highlights a Uruguay run). The cinemas.address
    // we render is the Palermo terrace, so an away function must be flagged
    // rather than silently mapped to Gurruchaga 1791.
    const away = LISTING.replace(/Crepas Palermo/g, 'Sala Zitarrosa, Montevideo');
    const warnings: string[] = [];
    const out = parseListing(away, BEFORE_ALL, warnings);

    expect(out).toHaveLength(14);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Sala Zitarrosa, Montevideo');
  });

  it('warns and skips, rather than throwing, on an unparseable date', () => {
    const broken = LISTING.replace(
      '09 de Septiembre 2026 a las 19:10',
      'fecha a confirmar',
    );
    const warnings: string[] = [];
    const out = parseListing(broken, BEFORE_ALL, warnings);

    expect(out).toHaveLength(13);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('fecha a confirmar');
  });

  it('returns nothing for a document with no event cards', () => {
    expect(parseListing('<html><body><p>nada</p></body></html>', BEFORE_ALL)).toEqual([]);
  });
});
