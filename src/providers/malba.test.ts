/**
 * Tests for the MALBA provider.
 *
 * Strategy: use captured HTML fixtures (test/fixtures/malba/*.html) so the
 * parser is exercised against the real shape of MALBA's pages without any
 * network dependency. Fixtures are real snapshots; when MALBA changes their
 * HTML structure, these tests will fail and we'll know to refresh.
 *
 * Fixture capture date: 2026-04-20. Cycle: Olivera-Aries.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractCycles, parseDetailPage } from './malba';

function fixture(name: string): string {
  return readFileSync(
    resolve(__dirname, '../../test/fixtures/malba', name),
    'utf8',
  );
}

describe('extractCycles (listing page)', () => {
  const html = fixture('cine-listing.html');

  it('pairs each <h2> with the correct /evento/SLUG/ detail URL', () => {
    const cycles = extractCycles(html);
    const byTitle = Object.fromEntries(
      cycles.map((c) => [c.title, { slug: c.slug, detailUrl: c.detailUrl }]),
    );

    expect(byTitle['Olivera-Aries Un cine para la historia']).toEqual({
      slug: 'ciclo-aries-cinematografica-argentina',
      detailUrl:
        'https://malba.org.ar/evento/ciclo-aries-cinematografica-argentina/',
    });
    expect(byTitle['David Lynch x5']?.slug).toBe('david-lynch-x5');
    expect(byTitle['Revista Caligari']?.slug).toBe('revista-caligari-2');
  });

  it('deduplicates slugs when multiple buttons link to the same detail page', () => {
    const cycles = extractCycles(html);
    const slugs = cycles.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('returns all 10 current cine cycles from the April-2026 snapshot', () => {
    const cycles = extractCycles(html);
    expect(cycles).toHaveLength(10);
  });
});

describe('parseDetailPage (Olivera-Aries cycle)', () => {
  const html = fixture('evento-olivera-aries.html');
  const cycle = {
    slug: 'ciclo-aries-cinematografica-argentina',
    title: 'Olivera-Aries Un cine para la historia',
    detailUrl:
      'https://malba.org.ar/evento/ciclo-aries-cinematografica-argentina/',
  };

  it('parses the full 2026 April+May schedule into 22 screenings', () => {
    const warnings: string[] = [];
    const screenings = parseDetailPage(html, cycle, warnings);
    // 8 thursday/friday groups × 2-3 shows = 22 total from the fixture.
    expect(screenings.length).toBe(22);
    // Sanity: no warnings on the happy path.
    expect(warnings).toEqual([]);
  });

  it('backfills April for day headers before the first "de mayo" rollover', () => {
    const screenings = parseDetailPage(html, cycle, []);
    // First fixture screening: JUEVES 2 at 19:00, April 2026.
    const first = screenings[0];
    expect(first.filmTitle).toBe('El candidato');
    expect(first.director).toBe('Fernando Ayala');
    // JUEVES 2 de abril 2026 @ 19:00 BA = 22:00 UTC (BA is UTC-3)
    expect(first.startsAtUtc.toISOString()).toBe('2026-04-02T22:00:00.000Z');
  });

  it('rolls over to May when the day header explicitly says "de mayo"', () => {
    const screenings = parseDetailPage(html, cycle, []);
    // VIERNES 1 de mayo at 22:00 BA = 2026-05-02T01:00 UTC
    const may22 = screenings.find(
      (s) => s.filmTitle === 'Primero yo' && s.director === 'Fernando Ayala',
    );
    expect(may22).toBeDefined();
    expect(may22!.startsAtUtc.toISOString()).toBe('2026-05-02T01:00:00.000Z');
  });

  it('converts hour 24 ("midnight") to 00:00 of the NEXT calendar day', () => {
    const screenings = parseDetailPage(html, cycle, []);
    // VIERNES 1 de mayo 24:00 "Hotel alojamiento" → 2026-05-02 00:00 BA = 2026-05-02T03:00 UTC
    const midnight = screenings.find(
      (s) => s.filmTitle === 'Hotel alojamiento',
    );
    expect(midnight).toBeDefined();
    expect(midnight!.startsAtUtc.toISOString()).toBe(
      '2026-05-02T03:00:00.000Z',
    );
  });

  it('attaches the cycle source URL and the "cycle" tag to every screening', () => {
    const screenings = parseDetailPage(html, cycle, []);
    for (const s of screenings) {
      expect(s.sourceUrl).toBe(cycle.detailUrl);
      expect(s.tags).toContain('cycle');
      expect(s.cinemaId).toBe('malba');
    }
  });

  it('captures the director and preserves accents in the film title', () => {
    const screenings = parseDetailPage(html, cycle, []);
    // "La patagonia rebelde, de Héctor Olivera"
    const patagonia = screenings.find((s) => s.filmTitle === 'La patagonia rebelde');
    expect(patagonia?.director).toBe('Héctor Olivera');
    // "No habrá más penas ni olvido" preserves á
    const nopenas = screenings.find((s) =>
      s.filmTitle.startsWith('No habrá'),
    );
    expect(nopenas).toBeDefined();
  });

  it('uses the JSON-LD datePublished year as the anchor', () => {
    // The Olivera-Aries detail page has datePublished 2026-03-30, so
    // April screenings should land in 2026 and the "mayo" rollover
    // should land in 2026-05, not 2025-05.
    const screenings = parseDetailPage(html, cycle, []);
    for (const s of screenings) {
      expect(s.startsAtUtc.getUTCFullYear()).toBe(2026);
    }
  });

  it('warns and returns [] when the page has no Programación block', () => {
    const htmlNoProgramacion =
      '<html><body><h1>Just a title</h1><p>No schedule here</p></body></html>';
    const warnings: string[] = [];
    const out = parseDetailPage(htmlNoProgramacion, cycle, warnings);
    expect(out).toEqual([]);
    expect(warnings[0]).toContain('no <h3>Programación</h3> block');
  });
});

// ---------------------------------------------------------------------------
// Smaller-scope unit tests for hand-crafted edge cases the real fixture
// doesn't exercise.
// ---------------------------------------------------------------------------
describe('parseDetailPage — synthetic edge cases', () => {
  const cycle = {
    slug: 'synth',
    title: 'Synthetic',
    detailUrl: 'https://malba.org.ar/evento/synth/',
  };

  it('falls back to first month in page text when Programación has no explicit month and no rollover', () => {
    // Cycle runs entirely within one month (JUEVES 2, JUEVES 9, no rollover)
    // and Programación has no "de MONTH" anywhere. The fallback should
    // scan the page text for the first month name.
    const html = `
      <html><body>
        <p>Durante todo junio, proyecciones en el auditorio.</p>
        <h3>Programación</h3>
        <p>JUEVES 4<br />
        20:00 <a href="x">Film One</a>, de Director Uno</p>
        <p>JUEVES 11<br />
        20:00 <a href="x">Film Two</a>, de Director Dos</p>
        <script type="application/ld+json">{"datePublished":"2026-05-30T00:00:00+00:00"}</script>
      </body></html>
    `;
    const warnings: string[] = [];
    const screenings = parseDetailPage(html, cycle, warnings);
    expect(screenings).toHaveLength(2);
    // Fallback picks "junio" (first month found in text) + anchor year 2026.
    expect(screenings[0].startsAtUtc.getUTCMonth()).toBe(5); // June is 5
    expect(screenings[0].startsAtUtc.getUTCFullYear()).toBe(2026);
  });

  it('rolls the year when a "de enero" rollover follows "de diciembre"', () => {
    const html = `
      <html><body>
        <h3>Programación</h3>
        <p>VIERNES 26 de diciembre<br />
        20:00 <a href="x">End of Year</a>, de Director X</p>
        <p>VIERNES 2 de enero<br />
        20:00 <a href="x">New Year</a>, de Director Y</p>
        <script type="application/ld+json">{"datePublished":"2026-11-15T00:00:00+00:00"}</script>
      </body></html>
    `;
    const screenings = parseDetailPage(html, cycle, []);
    expect(screenings).toHaveLength(2);
    const [dec, jan] = screenings;
    expect(dec.startsAtUtc.getUTCFullYear()).toBe(2026);
    expect(dec.startsAtUtc.getUTCMonth()).toBe(11); // December
    expect(jan.startsAtUtc.getUTCFullYear()).toBe(2027); // rolled
    expect(jan.startsAtUtc.getUTCMonth()).toBe(0); // January
  });

  it('skips showtime lines that do not match HH:MM Title, de Director', () => {
    const html = `
      <html><body>
        <h3>Programación</h3>
        <p>JUEVES 4 de abril<br />
        20:00 <a href="x">Valid Film</a>, de Valid Director<br />
        Nota especial: función acompañada de charla</p>
        <script type="application/ld+json">{"datePublished":"2026-03-20T00:00:00+00:00"}</script>
      </body></html>
    `;
    const warnings: string[] = [];
    const screenings = parseDetailPage(html, cycle, warnings);
    expect(screenings).toHaveLength(1);
    expect(screenings[0].filmTitle).toBe('Valid Film');
    // Unparseable line produces a warning, not a silent drop.
    expect(warnings.some((w) => w.includes('unparseable'))).toBe(true);
  });
});
