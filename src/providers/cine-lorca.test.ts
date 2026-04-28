/**
 * Tests for the Cine Lorca provider.
 *
 * Lorca's cartelera is a JPEG image; OCR is done via tesseract.js inside
 * the provider. To keep tests fast and deterministic, we capture the OCR
 * output once (test/fixtures/lorca/cartelera-2026-04-23.ocr.json) and
 * test the parser against the captured text. Real OCR runs only when we
 * recapture the fixture (scripts/_capture-ocr.ts in the dev workflow).
 *
 * Fixtures (captured 2026-04-23):
 *   cartelera-2026-04-23.jpeg    The week's actual cartelera image
 *   cartelera-2026-04-23.ocr.json  OCR output (3 cropped strips)
 *   current-production-2026-04-23.html  /current-production page snapshot
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  extractCarteleraImageUrl,
  parseCartelera,
  expandScreenings,
  cleanTitle,
  type ParsedCartelera,
} from './cine-lorca';

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, '../../test/fixtures/lorca', name), 'utf8');
}

const ocrFixture = JSON.parse(fixture('cartelera-2026-04-23.ocr.json')) as {
  left: string;
  mid: string;
  right: string;
};

// ---------------------------------------------------------------------------
// extractCarteleraImageUrl
// ---------------------------------------------------------------------------

describe('extractCarteleraImageUrl', () => {
  it('finds the cartelera.jpeg URL in the /current-production page', () => {
    const html = fixture('current-production-2026-04-23.html');
    const url = extractCarteleraImageUrl(html);
    expect(url).not.toBeNull();
    expect(url).toMatch(/static\.wixstatic\.com\/.*cartelera\.jpe?g/i);
  });

  it('returns null when no cartelera image is on the page', () => {
    expect(extractCarteleraImageUrl('<html><body>nothing</body></html>')).toBeNull();
  });

  it('finds the URL when only a srcset attribute carries it', () => {
    const html = `<img srcset="https://static.wixstatic.com/media/abc~mv2.jpeg/v1/fill/w_600/cartelera.jpeg 1x"/>`;
    expect(extractCarteleraImageUrl(html)).toMatch(/cartelera\.jpeg/);
  });
});

// ---------------------------------------------------------------------------
// cleanTitle
// ---------------------------------------------------------------------------

describe('cleanTitle', () => {
  it('strips enclosing curly quotes', () => {
    expect(cleanTitle('“EL DRAMA”')).toBe('EL DRAMA');
  });

  it('strips trailing comma left by multi-line title joins', () => {
    expect(cleanTitle('PADRE, MADRE, HERMANA, HERMANO,')).toBe(
      'PADRE, MADRE, HERMANA, HERMANO',
    );
  });

  it('collapses internal whitespace', () => {
    expect(cleanTitle('"CALLE   MÁLAGA"')).toBe('CALLE MÁLAGA');
  });

  it('returns null for empty or single-character input', () => {
    expect(cleanTitle('"  "')).toBeNull();
    expect(cleanTitle('a')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseCartelera
// ---------------------------------------------------------------------------

describe('parseCartelera', () => {
  it('extracts the validity range from the LEFT strip', () => {
    const warnings: string[] = [];
    const parsed = parseCartelera(ocrFixture, warnings);
    expect(parsed.validFrom).toEqual({ year: 2026, month: 4, day: 23 });
    expect(parsed.validTo).toEqual({ year: 2026, month: 4, day: 29 });
  });

  it('parses 7 films across the MID and RIGHT strips', () => {
    const warnings: string[] = [];
    const parsed = parseCartelera(ocrFixture, warnings);
    expect(parsed.films).toHaveLength(7);
  });

  it('captures showtimes per film (tolerant to OCR-mangled titles)', () => {
    const warnings: string[] = [];
    const parsed = parseCartelera(ocrFixture, warnings);
    // Anchor each lookup on the most distinctive substring that survives
    // OCR drift. "EL DRAMA" mangles to "El DR A MA" — match the spaced
    // form, since "DRAMA" alone overlaps with "MADRE" in the previous
    // film's title.
    const padre = parsed.films.find((f) => /padre/i.test(f.title));
    expect(padre?.times).toEqual([
      { hour: 14, minute: 10 },
      { hour: 20, minute: 5 },
    ]);
    const drama = parsed.films.find((f) => /\bdr\s*a\s*ma\b|\bdrama\b/i.test(f.title));
    expect(drama?.times).toEqual([
      { hour: 13, minute: 50 },
      { hour: 22, minute: 20 },
    ]);
    const kremlin = parsed.films.find((f) => /kremlin/i.test(f.title));
    expect(kremlin?.times).toEqual([
      { hour: 15, minute: 55 },
      { hour: 22, minute: 5 },
    ]);
    const risa = parsed.films.find((f) => /risa/i.test(f.title));
    expect(risa?.times).toEqual([{ hour: 16, minute: 10 }]);
    const calleMalaga = parsed.films.find((f) => /m[aá]laga/i.test(f.title));
    expect(calleMalaga?.times).toEqual([{ hour: 20, minute: 15 }]);
    const gioia = parsed.films.find((f) => /sicilia/i.test(f.title));
    expect(gioia?.times).toEqual([{ hour: 18, minute: 30 }]);
  });

  it('returns null validity + warning when OCR text lacks a date range', () => {
    const warnings: string[] = [];
    const parsed = parseCartelera({ left: 'no dates here', mid: '', right: '' }, warnings);
    expect(parsed.validFrom).toBeNull();
    expect(parsed.validTo).toBeNull();
    expect(warnings.some((w) => w.includes('validity'))).toBe(true);
  });

  it('handles year rollover when validTo is before validFrom in the same year', () => {
    const warnings: string[] = [];
    const parsed = parseCartelera(
      { left: '30/12 AL 05/01\n2026', mid: '', right: '' },
      warnings,
    );
    expect(parsed.validFrom).toEqual({ year: 2026, month: 12, day: 30 });
    expect(parsed.validTo).toEqual({ year: 2027, month: 1, day: 5 });
  });
});

// ---------------------------------------------------------------------------
// expandScreenings
// ---------------------------------------------------------------------------

describe('expandScreenings', () => {
  function makeParsed(films: ParsedCartelera['films']): ParsedCartelera {
    return {
      validFrom: { year: 2026, month: 4, day: 23 },
      validTo: { year: 2026, month: 4, day: 29 },
      films,
    };
  }

  it('cross-products films × times × days across the validity range', () => {
    const parsed = makeParsed([
      { title: 'A', times: [{ hour: 18, minute: 0 }] },
      {
        title: 'B',
        times: [
          { hour: 14, minute: 0 },
          { hour: 22, minute: 0 },
        ],
      },
    ]);
    const out = expandScreenings(parsed, 'https://cinelorca.wixsite.com/cine-lorca/current-production');
    // 7 days × (1 + 2) times = 21 screenings
    expect(out).toHaveLength(21);
  });

  it('emits 70 screenings for the captured fixture (7 films, 10 distinct times, 7 days)', () => {
    const warnings: string[] = [];
    const parsed = parseCartelera(ocrFixture, warnings);
    const screenings = expandScreenings(parsed, 'https://cinelorca.wixsite.com/cine-lorca/current-production');
    // 7 days × (2+2+1+2+1+1+1) times = 7 × 10 = 70
    expect(screenings).toHaveLength(70);
  });

  it('converts BA local time to UTC (BA is UTC-3, no DST)', () => {
    const parsed: ParsedCartelera = {
      validFrom: { year: 2026, month: 4, day: 23 },
      validTo: { year: 2026, month: 4, day: 23 },
      films: [{ title: 'X', times: [{ hour: 20, minute: 5 }] }],
    };
    const [s] = expandScreenings(parsed, 'https://example/');
    // 23 Apr 2026 20:05 BA = 23 Apr 2026 23:05 UTC
    expect(s.startsAtUtc.toISOString()).toBe('2026-04-23T23:05:00.000Z');
  });

  it('every screening has cinemaId=lorca, no tags, sourceUrl set', () => {
    const warnings: string[] = [];
    const parsed = parseCartelera(ocrFixture, warnings);
    const screenings = expandScreenings(parsed, 'https://example/');
    for (const s of screenings) {
      expect(s.cinemaId).toBe('lorca');
      expect(s.tags).toEqual([]);
      expect(s.sourceUrl).toBe('https://example/');
    }
  });

  it('returns [] when validity is missing', () => {
    const parsed: ParsedCartelera = {
      validFrom: null,
      validTo: null,
      films: [{ title: 'X', times: [{ hour: 18, minute: 0 }] }],
    };
    expect(expandScreenings(parsed, 'https://example/')).toEqual([]);
  });
});
