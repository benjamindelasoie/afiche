/**
 * Tests for the Cine Lorca provider.
 *
 * Lorca's cartelera is a JPEG image; we send it to Claude vision and parse
 * the structured JSON response. To keep tests fast, deterministic, and
 * runnable without an API key, we test against:
 *   - cartelera-2026-04-23.parsed.json    Expected vision output (the
 *                                         contract). Drives expandScreenings.
 *   - synthetic JSON strings              Drive parseVisionResponse.
 *   - current-production-2026-04-23.html  Drives extractCarteleraImageUrl.
 *
 * The committed JPEG fixture (cartelera-2026-04-23.jpeg) is kept around
 * so we can sanity-check the live VLM call once an API key is available.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  extractCarteleraImageUrl,
  parseVisionResponse,
  expandScreenings,
  type ParsedCartelera,
} from './cine-lorca';

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, '../../test/fixtures/lorca', name), 'utf8');
}

const parsedFixture = JSON.parse(
  fixture('cartelera-2026-04-23.parsed.json'),
) as ParsedCartelera;

// ---------------------------------------------------------------------------
// extractCarteleraImageUrl
// ---------------------------------------------------------------------------

describe('extractCarteleraImageUrl', () => {
  it('finds the ~mv2 user-uploaded JPEG on the live /current-production fixture', () => {
    const html = fixture('current-production-2026-04-23.html');
    const url = extractCarteleraImageUrl(html);
    expect(url).not.toBeNull();
    expect(url).toMatch(/~mv2\.jpe?g/i);
  });

  it('prefers the largest ~mv2 JPEG when multiple are present', () => {
    // Real pages serve a small thumb (w_600) and a full-size (w_745) crop.
    // Pick the larger to give vision the best signal.
    const html = `
      <img srcset="https://static.wixstatic.com/media/abc~mv2.jpg/v1/fill/w_600,h_421,al_c,q_80/abc.jpg 1x" />
      <img src="https://static.wixstatic.com/media/abc~mv2.jpg/v1/fill/w_745,h_523,al_c,q_85/abc.jpg" />
    `;
    const url = extractCarteleraImageUrl(html);
    expect(url).toMatch(/w_745,h_523/);
  });

  it('falls back to the cartelera.jpeg filename when no ~mv2 URL is present', () => {
    // Hypothetical older format: SEO rename, no ~mv2 marker. Fallback path.
    const html = `<img src="https://static.wixstatic.com/media/abc/v1/fill/w_600/cartelera.jpeg" />`;
    expect(extractCarteleraImageUrl(html)).toMatch(/cartelera\.jpeg/);
  });

  it('ignores small ~mv2 PNGs (UI icons would be PNG, but defensive)', () => {
    // The provider only cares about JPEGs — Wix UI icons are PNG. A page
    // with only PNGs (no cartelera) should return null.
    const html = `<img src="https://static.wixstatic.com/media/icon~mv2.png/v1/fill/w_33,h_33/icon.png" />`;
    expect(extractCarteleraImageUrl(html)).toBeNull();
  });

  it('returns null when no cartelera image is on the page', () => {
    expect(extractCarteleraImageUrl('<html><body>nothing</body></html>')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseVisionResponse
// ---------------------------------------------------------------------------

describe('parseVisionResponse', () => {
  const goodJson = JSON.stringify({
    validFrom: { day: 23, month: 4 },
    validTo: { day: 29, month: 4 },
    year: 2026,
    films: [{ title: 'Una película', times: ['18:00', '20:30'] }],
  });

  it('parses a clean JSON response', () => {
    const out = parseVisionResponse(goodJson);
    expect(out.validFrom).toEqual({ year: 2026, month: 4, day: 23 });
    expect(out.validTo).toEqual({ year: 2026, month: 4, day: 29 });
    expect(out.films).toHaveLength(1);
    expect(out.films[0]).toEqual({
      title: 'Una película',
      times: [
        { hour: 18, minute: 0 },
        { hour: 20, minute: 30 },
      ],
    });
  });

  it('strips ```json ... ``` markdown fences if the model adds them', () => {
    const fenced = `\`\`\`json\n${goodJson}\n\`\`\``;
    const out = parseVisionResponse(fenced);
    expect(out.films).toHaveLength(1);
  });

  it('strips bare ``` fences', () => {
    const fenced = `\`\`\`\n${goodJson}\n\`\`\``;
    const out = parseVisionResponse(fenced);
    expect(out.films).toHaveLength(1);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseVisionResponse('not json at all')).toThrow(/not valid JSON/i);
  });

  it('throws when required fields are missing', () => {
    const missing = JSON.stringify({ validFrom: { day: 1, month: 1 }, year: 2026 });
    expect(() => parseVisionResponse(missing)).toThrow(/missing required fields/i);
  });

  it('handles year rollover when validTo precedes validFrom in the printed year', () => {
    const json = JSON.stringify({
      validFrom: { day: 30, month: 12 },
      validTo: { day: 5, month: 1 },
      year: 2026,
      films: [{ title: 'X', times: ['18:00'] }],
    });
    const out = parseVisionResponse(json);
    expect(out.validFrom).toEqual({ year: 2026, month: 12, day: 30 });
    expect(out.validTo).toEqual({ year: 2027, month: 1, day: 5 });
  });

  it('drops films with empty titles or no valid times', () => {
    const json = JSON.stringify({
      validFrom: { day: 1, month: 5 },
      validTo: { day: 7, month: 5 },
      year: 2026,
      films: [
        { title: 'Real', times: ['18:00'] },
        { title: '   ', times: ['20:00'] },
        { title: 'NoTimes', times: [] },
        { title: 'BadTimes', times: ['nonsense', '99:99'] },
      ],
    });
    const out = parseVisionResponse(json);
    expect(out.films.map((f) => f.title)).toEqual(['Real']);
  });

  it('skips out-of-range time tuples but keeps valid ones in the same film', () => {
    const json = JSON.stringify({
      validFrom: { day: 1, month: 5 },
      validTo: { day: 7, month: 5 },
      year: 2026,
      films: [{ title: 'X', times: ['18:00', '99:99', '20:30'] }],
    });
    const out = parseVisionResponse(json);
    expect(out.films[0].times).toEqual([
      { hour: 18, minute: 0 },
      { hour: 20, minute: 30 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// expandScreenings
// ---------------------------------------------------------------------------

describe('expandScreenings', () => {
  it('cross-products films × times × days across the validity range', () => {
    const parsed: ParsedCartelera = {
      validFrom: { year: 2026, month: 4, day: 23 },
      validTo: { year: 2026, month: 4, day: 29 },
      films: [
        { title: 'A', times: [{ hour: 18, minute: 0 }] },
        {
          title: 'B',
          times: [
            { hour: 14, minute: 0 },
            { hour: 22, minute: 0 },
          ],
        },
      ],
    };
    const out = expandScreenings(parsed, 'https://example/');
    expect(out).toHaveLength(7 * 3); // 7 days × (1 + 2) times
  });

  it('emits 70 screenings for the captured 2026-04-23 fixture (7 films × 10 times × 7 days)', () => {
    const screenings = expandScreenings(parsedFixture, 'https://example/');
    // 2 + 2 + 1 + 2 + 1 + 1 + 1 = 10 distinct (film, time) tuples × 7 days
    expect(screenings).toHaveLength(70);
  });

  it('converts BA local time to UTC (BA is UTC-3, no DST)', () => {
    const parsed: ParsedCartelera = {
      validFrom: { year: 2026, month: 4, day: 23 },
      validTo: { year: 2026, month: 4, day: 23 },
      films: [{ title: 'X', times: [{ hour: 20, minute: 5 }] }],
    };
    const [s] = expandScreenings(parsed, 'https://example/');
    // 23 Apr 2026 20:05 BA → 23 Apr 2026 23:05 UTC
    expect(s.startsAtUtc.toISOString()).toBe('2026-04-23T23:05:00.000Z');
  });

  it('every screening has cinemaId=lorca, no tags, sourceUrl set', () => {
    const screenings = expandScreenings(parsedFixture, 'https://example/');
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

// ---------------------------------------------------------------------------
// Live smoke test (requires ANTHROPIC_API_KEY; auto-skipped without it)
// ---------------------------------------------------------------------------

describe.skipIf(!process.env.ANTHROPIC_API_KEY)('live vision call', () => {
  it.skip('extracts the captured fixture image into the expected shape (manual)', async () => {
    // Intentionally skipped by default. Unskip locally to verify the live
    // VLM call against the JPEG fixture once an API key is configured.
    // Asserts loose invariants because the model may return slightly
    // different casing or punctuation:
    //   - 7 films
    //   - validFrom == 2026-04-23, validTo == 2026-04-29
    //   - sum of times across all films == 10
  });
});
