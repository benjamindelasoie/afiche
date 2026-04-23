/**
 * Tests for the Cine York provider.
 *
 * Fixture: test/fixtures/cine-york/agenda-listing.html — captured
 * 2026-04-20 from https://lumiton.ar/agenda-presencial/. The page
 * contains 17 event tiles across three Lumiton locations; 8 belong
 * to Cine York.
 *
 * When Lumiton changes their HTML structure these tests will fail
 * and we'll know to refresh the fixture.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseAgenda } from './cine-york';

function fixture(name: string): string {
  return readFileSync(
    resolve(__dirname, '../../test/fixtures/cine-york', name),
    'utf8',
  );
}

describe('parseAgenda — Cine York filter + extraction', () => {
  const html = fixture('agenda-listing.html');

  it('emits exactly 8 screenings (only the Cine York events)', () => {
    const warnings: string[] = [];
    const out = parseAgenda(html, warnings);
    expect(out).toHaveLength(8);
    expect(warnings).toEqual([]);
  });

  it('ignores events at sibling Lumiton locations (Munro, Lumiton)', () => {
    const out = parseAgenda(html, []);
    for (const s of out) {
      expect(s.cinemaId).toBe('cine-york');
    }
  });

  it('uses data-date as the authoritative date (no year inference)', () => {
    const out = parseAgenda(html, []);
    for (const s of out) {
      expect(s.startsAtUtc.getUTCFullYear()).toBe(2026);
    }
    // First event in the fixture: Lawrence de Arabia, Thursday 23 April 18:00 BA
    // 18:00 BA (UTC-3) = 21:00 UTC
    const lawrence = out.find((s) => s.filmTitle === 'LAWRENCE DE ARABIA');
    expect(lawrence).toBeDefined();
    expect(lawrence!.startsAtUtc.toISOString()).toBe('2026-04-23T21:00:00.000Z');
  });

  it('captures the Lumiton evento detail URL per screening', () => {
    const out = parseAgenda(html, []);
    for (const s of out) {
      expect(s.sourceUrl).toMatch(/^https:\/\/lumiton\.ar\/evento\//);
    }
  });

  it('leaves synopsisEs undefined — tile preview is truncated mid-sentence', () => {
    // The Lumiton agenda tile renders synopses inside p.line-clamp-3 at
    // ~100-140 chars, always cut mid-sentence. Rendering that on the
    // Afiche card reads as "broken data" — every card trails off with a
    // dangling comma. Design choice: prefer no synopsis over a bad one.
    // The full synopsis body lives on the /evento/ detail page and
    // enrichment from there is tracked separately.
    const out = parseAgenda(html, []);
    for (const s of out) {
      expect(s.synopsisEs).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Synthetic edge cases
// ---------------------------------------------------------------------------
describe('parseAgenda — synthetic edge cases', () => {
  function oneTile(overrides: {
    date?: string;
    locations?: string;
    time?: string;
    title?: string;
  } = {}): string {
    const date = overrides.date ?? '2026-05-15';
    const locations = overrides.locations ?? '["cine-york"]';
    const time = overrides.time ?? '20:30';
    const title = overrides.title ?? 'Test Film';
    return `
      <html><body>
        <article class="group tipo-vecine" data-event data-date="${date}" data-locations='${locations}'>
          <div class="g-event-fecha">
            <div class="tracking-tighter text-6xl">viernes</div>
            <div><span class="text-3xl">15</span><span class="text-xl">may</span></div>
            <div class="tracking-tighter text-6xl">${time}hs</div>
          </div>
          <h3>${title}</h3>
          <p class="line-clamp-3">A synopsis.</p>
          <a href="https://lumiton.ar/evento/test-film/">Ver más</a>
        </article>
      </body></html>
    `;
  }

  it('handles a multi-location event by matching when cine-york is one of many', () => {
    const html = oneTile({ locations: '["cine-york","lumiton"]' });
    const out = parseAgenda(html, []);
    expect(out).toHaveLength(1);
  });

  it('rejects tiles whose data-locations do not include cine-york', () => {
    const html = oneTile({ locations: '["centro-cultural-munro"]' });
    const out = parseAgenda(html, []);
    expect(out).toHaveLength(0);
  });

  it('warns on malformed data-date', () => {
    const html = oneTile({ date: 'not-a-date' });
    const warnings: string[] = [];
    const out = parseAgenda(html, warnings);
    expect(out).toHaveLength(0);
    expect(warnings[0]).toContain('malformed data-date');
  });

  it('warns on unparseable time', () => {
    const html = oneTile({ time: 'whenever' });
    const warnings: string[] = [];
    const out = parseAgenda(html, warnings);
    expect(out).toHaveLength(0);
    expect(warnings[0]).toContain('could not parse time');
  });

  it('rolls hour 24 to 00:00 of the next calendar day', () => {
    const html = oneTile({ date: '2026-12-31', time: '24:00' });
    const out = parseAgenda(html, []);
    expect(out).toHaveLength(1);
    // 2026-12-31 24:00 BA = 2027-01-01 00:00 BA = 2027-01-01T03:00 UTC
    expect(out[0].startsAtUtc.toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });

  it('skips tiles with no title rather than emitting a blank screening', () => {
    const html = oneTile({ title: '' });
    const warnings: string[] = [];
    const out = parseAgenda(html, warnings);
    expect(out).toHaveLength(0);
    expect(warnings[0]).toContain('no <h3> title');
  });

  it('returns [] with no warnings when the HTML has no event tiles at all', () => {
    const warnings: string[] = [];
    const out = parseAgenda('<html><body><h1>Empty</h1></body></html>', warnings);
    expect(out).toEqual([]);
    expect(warnings).toEqual([]);
  });
});
