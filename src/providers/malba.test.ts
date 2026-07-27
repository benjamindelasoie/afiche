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
import {
  extractCycles,
  extractContinuaScreenings,
  parseDetailPage,
  parseFilmSynopsis,
  enrichFromFilmDetailPages,
} from './malba';
import type { ScrapedScreening } from './types';

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, '../../test/fixtures/malba', name), 'utf8');
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
      detailUrl: 'https://malba.org.ar/evento/ciclo-aries-cinematografica-argentina/',
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

describe('extractContinuaScreenings (listing-page "Continúa" tiles)', () => {
  const html = fixture('cine-listing.html');
  // Anchor "now" at a fixed Tuesday 2026-04-28 12:00 BA so the
  // next-weekday math is deterministic across the assertions.
  const NOW = new Date('2026-04-28T15:00:00.000Z'); // Tue 12:00 BA

  it('extracts all 5 Continúa tiles from the April-2026 snapshot', () => {
    const warnings: string[] = [];
    const out = extractContinuaScreenings(html, NOW, warnings);
    expect(out).toHaveLength(5);
    expect(warnings).toEqual([]);
  });

  it('captures title, director, sourceUrl, and a forward-dated UTC instant per tile', () => {
    const out = extractContinuaScreenings(html, NOW, []);
    const byTitle = Object.fromEntries(out.map((s) => [s.filmTitle, s]));
    const souffleur = byTitle['The Souffleur'];
    expect(souffleur).toBeDefined();
    expect(souffleur.director).toBe('Gastón Solnicki');
    expect(souffleur.sourceUrl).toBe('https://malba.org.ar/evento/the-souffleur/');
    expect(souffleur.cinemaId).toBe('malba');
    // Tue 2026-04-28 → next Saturday is 2026-05-02. 22:00 BA = 2026-05-03T01:00Z.
    expect(souffleur.startsAtUtc.toISOString()).toBe('2026-05-03T01:00:00.000Z');
  });

  it('maps each Spanish weekday name to the correct next BA-local instance', () => {
    const out = extractContinuaScreenings(html, NOW, []);
    const byTitle = Object.fromEntries(out.map((s) => [s.filmTitle, s]));
    // Anchor: Tue 2026-04-28 12:00 BA
    // Viernes 2026-05-01 18:40 BA = 21:40 UTC
    expect(byTitle['Los dias chinos'].startsAtUtc.toISOString()).toBe(
      '2026-05-01T21:40:00.000Z',
    );
    // Viernes 2026-05-01 20:00 BA = 23:00 UTC
    expect(byTitle['Pin de fartie'].startsAtUtc.toISOString()).toBe(
      '2026-05-01T23:00:00.000Z',
    );
    // Domingo 2026-05-03 18:00 BA = 21:00 UTC
    expect(byTitle['LS83'].startsAtUtc.toISOString()).toBe('2026-05-03T21:00:00.000Z');
    // Domingo 2026-05-03 20:00 BA = 23:00 UTC
    expect(byTitle['El príncipe de Nanawa'].startsAtUtc.toISOString()).toBe(
      '2026-05-03T23:00:00.000Z',
    );
  });

  it('advances by a full week when today matches the weekday but the time has passed', () => {
    // Saturday 2026-05-02 23:00 BA = 2026-05-03T02:00Z. The Souffleur is
    // "Sábados 22:00" — 22:00 BA on Saturday is 2026-05-03T01:00Z, which
    // is BEFORE now. So next instance should be 2026-05-09 22:00 BA.
    const lateSaturday = new Date('2026-05-03T02:00:00.000Z');
    const out = extractContinuaScreenings(html, lateSaturday, []);
    const souffleur = out.find((s) => s.filmTitle === 'The Souffleur');
    expect(souffleur?.startsAtUtc.toISOString()).toBe('2026-05-10T01:00:00.000Z');
  });

  it('emits a warning + skips the tile when day-time prose cannot be parsed', () => {
    const broken =
      '<p>Continúa</p><h2><a href="https://malba.org.ar/evento/x/">X</a></h2>' +
      '<div class="elementor-widget-container">prose without the expected schema</div>';
    const warnings: string[] = [];
    const out = extractContinuaScreenings(broken, NOW, warnings);
    expect(out).toHaveLength(0);
    expect(warnings.some((w) => /could not parse/.test(w))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Strategy-1 showtime-line splitting — the missing-"de" director boundary
// (TODOS.md #29). Synthetic dense-cycle HTML that reproduces the exact
// contaminated line from Semana de Cine Portugués (the source page for that
// cycle is long gone; synthetic HTML matches the grammar per the convention
// used for Strategy 2 below).
// ---------------------------------------------------------------------------
describe('parseDetailPage — Strategy 1 missing-"de" director split (TODO #29)', () => {
  const cycle = {
    slug: 'semana-de-cine-portugues',
    title: 'Semana de Cine Portugués',
    detailUrl: 'https://malba.org.ar/evento/semana-de-cine-portugues/',
  };

  // MALBA's day <p> puts the day header on its own source line (a newline
  // follows the header's <br />), which is what parseS1DenseCycle's day-header
  // detection keys on (splitFirstLine splits $p.text() on "\n").
  function denseCycleHtml(showtimeLines: string[]): string {
    const lines = showtimeLines.map((l) => `<br />\n${l}`).join('');
    return `
      <html><body><main>
        <h3>Programación</h3>
        <p>DOMINGO 31 de mayo${lines}</p>
        <script type="application/ld+json">{"datePublished":"2026-05-01T00:00:00+00:00"}</script>
      </main></body></html>
    `;
  }

  it('splits "Title, Director (NN′)" into a clean title + director when "de" is absent', () => {
    const warnings: string[] = [];
    const out = parseDetailPage(
      denseCycleHtml([
        "20:00 A Vida Luminosa, João Rosas (99'). Con presentación del director",
      ]),
      cycle,
      warnings,
    );
    expect(out).toHaveLength(1);
    expect(out[0].filmTitle).toBe('A Vida Luminosa');
    expect(out[0].director).toBe('João Rosas');
  });

  it('still splits the canonical ", de Director" form (no regression)', () => {
    const out = parseDetailPage(
      denseCycleHtml(['21:30 A Vida Luminosa, de João Rosas (99′)']),
      cycle,
      [],
    );
    expect(out[0].filmTitle).toBe('A Vida Luminosa');
    expect(out[0].director).toBe('João Rosas');
  });

  it('does NOT split a comma inside the title when no runtime marker follows', () => {
    // A bare comma is a director boundary ONLY when gated by "(NN')": without
    // it, the comma belongs to the title and the line stays whole.
    const out = parseDetailPage(denseCycleHtml(['20:00 Amar, temer, partir']), cycle, []);
    expect(out[0].filmTitle).toBe('Amar, temer, partir');
    expect(out[0].director).toBeUndefined();
  });
});

describe('parseDetailPage (Olivera-Aries cycle)', () => {
  const html = fixture('evento-olivera-aries.html');
  const cycle = {
    slug: 'ciclo-aries-cinematografica-argentina',
    title: 'Olivera-Aries Un cine para la historia',
    detailUrl: 'https://malba.org.ar/evento/ciclo-aries-cinematografica-argentina/',
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
    const midnight = screenings.find((s) => s.filmTitle === 'Hotel alojamiento');
    expect(midnight).toBeDefined();
    expect(midnight!.startsAtUtc.toISOString()).toBe('2026-05-02T03:00:00.000Z');
  });

  it('attaches the cycle source URL and the "cycle" tag to every screening', () => {
    const screenings = parseDetailPage(html, cycle, []);
    for (const s of screenings) {
      expect(s.sourceUrl).toBe(cycle.detailUrl);
      expect(s.tags).toContain('cycle');
      expect(s.cinemaId).toBe('malba');
    }
  });

  it("captures filmDetailUrl from each showtime line's <a href> when present", () => {
    const screenings = parseDetailPage(html, cycle, []);
    // Every olivera-aries showtime line has an /evento/<film>/ link, so
    // every screening should carry a filmDetailUrl distinct from sourceUrl.
    for (const s of screenings) {
      expect(s.filmDetailUrl).toMatch(
        /^https:\/\/malba\.org\.ar\/evento\/[a-z0-9-]+\/?$/,
      );
      expect(s.filmDetailUrl).not.toBe(s.sourceUrl);
    }
    // Spot-check: La nona points at its own /evento/la-nona/ page.
    const lanona = screenings.find((s) => s.filmTitle === 'La nona');
    expect(lanona?.filmDetailUrl).toBe('https://malba.org.ar/evento/la-nona/');
  });

  it('captures the director and preserves accents in the film title', () => {
    const screenings = parseDetailPage(html, cycle, []);
    // "La patagonia rebelde, de Héctor Olivera"
    const patagonia = screenings.find((s) => s.filmTitle === 'La patagonia rebelde');
    expect(patagonia?.director).toBe('Héctor Olivera');
    // "No habrá más penas ni olvido" preserves á
    const nopenas = screenings.find((s) => s.filmTitle.startsWith('No habrá'));
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

  it('warns and returns [] when neither S1 (Programación) nor S2 (prose schedule) applies', () => {
    const htmlNoSchedule =
      '<html><body><h1>Just a title</h1><p>No schedule here</p></body></html>';
    const warnings: string[] = [];
    const out = parseDetailPage(htmlNoSchedule, cycle, warnings);
    expect(out).toEqual([]);
    expect(warnings[0]).toContain('no schedule recognized');
  });
});

// ---------------------------------------------------------------------------
// Strategy 2 — single-event / grouped-times
// ---------------------------------------------------------------------------
// No captured fixture yet for single-event pages. Tests use synthetic HTML
// that matches the schedule grammar MALBA actually ships:
//     "Miércoles 29 de abril a las 17:45, 21:00 y 24:00"
// If production warnings flag new grammars, add targeted tests here.
// ---------------------------------------------------------------------------
describe('parseDetailPage — Strategy 2 (single-event, prose schedule)', () => {
  const cycle = {
    slug: 'el-diablo-viste-a-la-moda-2',
    title: 'El diablo viste a la moda 2',
    detailUrl: 'https://malba.org.ar/evento/el-diablo-viste-a-la-moda-2/',
  };

  function makeHtml(
    scheduleLine: string,
    datePublished = '2026-04-01T00:00:00+00:00',
  ): string {
    return `
      <html><body><main>
        <h1>El diablo viste a la moda 2</h1>
        <p>${scheduleLine} La Semana de la Alta Costura Argentina presenta la avant premiere.</p>
        <script type="application/ld+json">{"datePublished":"${datePublished}"}</script>
      </main></body></html>
    `;
  }

  it('parses the canonical El-Diablo shape: one date, three comma+y separated times', () => {
    const warnings: string[] = [];
    const out = parseDetailPage(
      makeHtml('Miércoles 29 de abril a las 17:45, 21:00 y 24:00'),
      cycle,
      warnings,
    );
    expect(out).toHaveLength(3);
    expect(warnings).toEqual([]);
    // Each screening uses the <h1> text as film title (not the cycle.title)
    expect(out.every((s) => s.filmTitle === 'El diablo viste a la moda 2')).toBe(true);
    // Times: 17:45, 21:00, 24:00 → UTC (BA is -3)
    const isos = out.map((s) => s.startsAtUtc.toISOString()).sort();
    expect(isos).toEqual([
      '2026-04-29T20:45:00.000Z', // 17:45 local
      '2026-04-30T00:00:00.000Z', // 21:00 local
      '2026-04-30T03:00:00.000Z', // 24:00 → 2026-04-30 00:00 local
    ]);
  });

  it('handles a single time with no separators', () => {
    const out = parseDetailPage(makeHtml('Jueves 15 de mayo a las 20:00'), cycle, []);
    expect(out).toHaveLength(1);
    expect(out[0].startsAtUtc.toISOString()).toBe('2026-05-15T23:00:00.000Z');
  });

  it('handles two times joined with just " y "', () => {
    const out = parseDetailPage(
      makeHtml('Viernes 3 de abril a las 19:00 y 22:00'),
      cycle,
      [],
    );
    expect(out).toHaveLength(2);
  });

  it('captures multiple schedule lines on the same page', () => {
    const html = `
      <html><body><main>
        <h1>A two-weekend event</h1>
        <p>Viernes 4 de abril a las 20:00</p>
        <p>Sábado 5 de abril a las 18:00, 21:00</p>
        <script type="application/ld+json">{"datePublished":"2026-03-20T00:00:00+00:00"}</script>
      </main></body></html>
    `;
    const out = parseDetailPage(html, cycle, []);
    expect(out).toHaveLength(3);
  });

  it('is case-insensitive on day and month names', () => {
    const out = parseDetailPage(makeHtml('MIÉRCOLES 29 de ABRIL a las 17:45'), cycle, []);
    expect(out).toHaveLength(1);
  });

  it('tolerates day-name accent stripping (Sabado vs Sábado)', () => {
    const out = parseDetailPage(makeHtml('Sabado 5 de julio a las 20:00'), cycle, []);
    expect(out).toHaveLength(1);
  });

  it('falls through to the final "no schedule recognized" warning when both S1 and S2 fail', () => {
    const htmlNoSchedule = `
      <html><body><main>
        <h1>Recurring thing</h1>
        <p>Sábados a las 18:00 en el mes de abril</p>
        <script type="application/ld+json">{"datePublished":"2026-03-20T00:00:00+00:00"}</script>
      </main></body></html>
    `;
    const warnings: string[] = [];
    const out = parseDetailPage(htmlNoSchedule, cycle, warnings);
    expect(out).toEqual([]);
    // Should reference both strategies having been tried
    expect(warnings[0]).toContain('no schedule recognized');
    expect(warnings[0]).toContain('dense-cycle');
    expect(warnings[0]).toContain('single-event');
  });

  it('rolls hour 24 to the next day even when it is the last item in a comma list', () => {
    const out = parseDetailPage(
      makeHtml('Miércoles 29 de abril a las 17:45, 24:00'),
      cycle,
      [],
    );
    expect(out).toHaveLength(2);
    const isos = out.map((s) => s.startsAtUtc.toISOString()).sort();
    expect(isos[1]).toBe('2026-04-30T03:00:00.000Z');
  });

  it('prefers S1 when both Programación and a prose date line exist', () => {
    // Programación (S1) + a single-event prose date that LOOKS like S2.
    // S1 should win because it returns screenings first.
    const html = `
      <html><body><main>
        <h1>Mixed-format cycle</h1>
        <p>Miércoles 29 de abril a las 20:00</p>
        <h3>Programación</h3>
        <p>JUEVES 2 de abril<br />
        19:00 <a href="x">Dense Film</a>, de Director A</p>
        <script type="application/ld+json">{"datePublished":"2026-03-20T00:00:00+00:00"}</script>
      </main></body></html>
    `;
    const out = parseDetailPage(html, cycle, []);
    // Only the dense-cycle screening. S2 grammar on "Miércoles 29 de abril"
    // is NOT emitted because S1 already produced results.
    expect(out).toHaveLength(1);
    expect(out[0].filmTitle).toBe('Dense Film');
  });
});

// ---------------------------------------------------------------------------
// Multi-week midnight-repeat regression — david-lynch-x5 cycle.
// The cycle has four Saturday entries; only the first carries "de abril".
// Ensures the month inferred on day 1 carries forward across subsequent
// SÁBADO N headers without a month suffix, AND that all four director-less
// 24:00 lines parse without warnings (the original bug from TODOS.md #8).
// ---------------------------------------------------------------------------
describe('parseDetailPage (David Lynch x5 cycle — midnight repeats)', () => {
  const html = fixture('evento-david-lynch-x5.html');
  const cycle = {
    slug: 'david-lynch-x5',
    title: 'David Lynch x5',
    detailUrl: 'https://malba.org.ar/evento/david-lynch-x5/',
  };

  it('parses all 8 screenings (4 Saturdays × 2 shows) without warnings', () => {
    const warnings: string[] = [];
    const screenings = parseDetailPage(html, cycle, warnings);
    expect(screenings).toHaveLength(8);
    expect(warnings.filter((w) => w.includes('unparseable'))).toEqual([]);
  });

  it('rolls each 24:00 line to 03:00 UTC of the following day (BA midnight)', () => {
    const screenings = parseDetailPage(html, cycle, []);
    const midnights = screenings
      .filter((s) => s.startsAtUtc.getUTCHours() === 3)
      .map((s) => s.startsAtUtc.toISOString())
      .sort();
    expect(midnights).toEqual([
      '2026-04-05T03:00:00.000Z', // SÁBADO 4 + 24:00 → SUN 5 BA 00:00
      '2026-04-12T03:00:00.000Z',
      '2026-04-19T03:00:00.000Z',
      '2026-04-26T03:00:00.000Z',
    ]);
  });

  it('emits no director on midnight repeats (cycle-all-one-director convention)', () => {
    const screenings = parseDetailPage(html, cycle, []);
    const midnights = screenings.filter((s) => s.startsAtUtc.getUTCHours() === 3);
    for (const s of midnights) {
      expect(s.director).toBeUndefined();
    }
    // The 20:00 evening shows DO carry "de David Lynch".
    const evenings = screenings.filter((s) => s.startsAtUtc.getUTCHours() === 23);
    expect(evenings).toHaveLength(4);
    for (const s of evenings) {
      expect(s.director).toBe('David Lynch');
    }
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

  it('strips MOTELX-style "(NN\')" runtime suffix and trailing prose from the director field', () => {
    // MALBA's MOTELX cycle (May 2026) appended the runtime to the director
    // inside the showtime line:
    //   "19:00 <a>A Vida Luminosa</a>, de João Rosas (99′). Con presentación
    //    y Q&A del director"
    // Without cleanup, films.director ends up as "João Rosas (99′). Con
    // presentación y Q&A del director" which never matches TMDB's credited
    // "João Rosas" via directorsMatch, so the row lands in 'none-attempted'.
    // Both the ASCII apostrophe ' and the Unicode prime ′ appear in real
    // MALBA output; cover both.
    const html = `
      <html><body>
        <h3>Programación</h3>
        <p>JUEVES 8 de mayo<br />
        18:00 <a href="x">Baía dos Tigres</a>, de Carlos Conceição (71')<br />
        20:00 <a href="x">A Vida Luminosa</a>, de João Rosas (99′). Con presentación y Q&amp;A del director<br />
        22:00 <a href="x">Entroncamento</a>, de Pedro Cabeleira (131')</p>
        <script type="application/ld+json">{"datePublished":"2026-04-30T00:00:00+00:00"}</script>
      </body></html>
    `;
    const warnings: string[] = [];
    const screenings = parseDetailPage(html, cycle, warnings);
    expect(screenings).toHaveLength(3);
    expect(screenings[0].director).toBe('Carlos Conceição');
    expect(screenings[1].director).toBe('João Rosas');
    expect(screenings[2].director).toBe('Pedro Cabeleira');
    // The title side stays clean — only the director field carried the noise.
    expect(screenings[0].filmTitle).toBe('Baía dos Tigres');
    expect(screenings[1].filmTitle).toBe('A Vida Luminosa');
    expect(screenings[2].filmTitle).toBe('Entroncamento');
  });

  it('parses midnight repeats with NO ", de Director" suffix (david-lynch-x5 pattern)', () => {
    // The David Lynch x5 cycle lists regular evening shows as
    // "20:00 Title, de David Lynch" but drops the director on the Saturday
    // 24:00 repeats: "24:00 Terciopelo azul". Four such lines surfaced as
    // "unparseable" warnings before the fix.
    const html = `
      <html><body>
        <h3>Programación</h3>
        <p>SÁBADO 4 de abril<br />
        20:00 <a href="x">Terciopelo azul</a>, de David Lynch<br />
        24:00 Terciopelo azul</p>
        <script type="application/ld+json">{"datePublished":"2026-03-20T00:00:00+00:00"}</script>
      </body></html>
    `;
    const warnings: string[] = [];
    const screenings = parseDetailPage(html, cycle, warnings);
    expect(screenings).toHaveLength(2);
    expect(warnings.filter((w) => w.includes('unparseable'))).toEqual([]);

    const midnight = screenings.find(
      (s) => s.startsAtUtc.toISOString() === '2026-04-05T03:00:00.000Z',
    );
    expect(midnight).toBeDefined();
    expect(midnight!.filmTitle).toBe('Terciopelo azul');
    // No director is emitted for the midnight repeat.
    expect(midnight!.director).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Per-film synopsis enrichment (parseFilmSynopsis + enrichFromFilmDetailPages)
//
// MALBA aggressively rate-limits per-film fetches, so the test suite uses
// synthetic HTML matching the Elementor structure confirmed in the real
// olivera-aries cycle fixture (.elementor-widget-text-editor wrappers).
// When a real per-film fixture is captured, swap the synthetic HTML below
// for fixture('evento-<film>.html') and add an end-to-end assertion that
// the synopsis text matches the one MALBA actually publishes.
// ---------------------------------------------------------------------------
describe('parseFilmSynopsis (Elementor text-editor pattern)', () => {
  function makeFilmPage(blocks: string[]): string {
    return `
      <html><body>${blocks
        .map(
          (text) => `
        <div class="elementor-widget elementor-widget-text-editor">
          <div class="elementor-widget-container">${text}</div>
        </div>`,
        )
        .join('')}</body></html>
    `;
  }

  it('returns the longest text-editor body and ignores short metadata blocks', () => {
    const html = makeFilmPage([
      'Durante todo abril', // short metadata, skipped
      'Auditorio', // short metadata, skipped
      'Lynch definió Terciopelo azul como un sueño de extraños deseos atrapado dentro de una historia de suspenso. En el pasaje del adolescente al adulto, una experiencia perturbadora reordena el mundo del protagonista.',
    ]);
    const synopsis = parseFilmSynopsis(html);
    expect(synopsis).toBeDefined();
    expect(synopsis!.startsWith('Lynch definió Terciopelo azul')).toBe(true);
    expect(synopsis).not.toContain('Durante todo abril');
    expect(synopsis).not.toContain('Auditorio');
  });

  it('strips a trailing "Texto de NAME" attribution', () => {
    const html = makeFilmPage([
      'Lynch reorganiza el suburbio americano como un escenario de pesadilla. Un oído cercenado en el pasto inicia el descenso. Ningún plano es lo que parece. Texto de Diego Trerotola.',
    ]);
    const synopsis = parseFilmSynopsis(html);
    expect(synopsis).toBeDefined();
    expect(synopsis).not.toContain('Texto de');
    expect(synopsis).not.toContain('Diego Trerotola');
    expect(synopsis!.trimEnd().endsWith('Ningún plano es lo que parece.')).toBe(true);
  });

  it('also strips "Texto: NAME" colon-style attribution', () => {
    const html = makeFilmPage([
      'Una historia sencilla cierra la trayectoria de Lynch con una serenidad que sorprende. Una larga ruta cruzando llanuras americanas, encuentros que parecen casuales pero acumulan sentido. Texto: Marcela Gamberini.',
    ]);
    const synopsis = parseFilmSynopsis(html);
    expect(synopsis).toBeDefined();
    expect(synopsis).not.toContain('Texto:');
    expect(synopsis).not.toContain('Marcela Gamberini');
  });

  it('returns undefined when no Elementor block has substantive prose (>=60 chars)', () => {
    const html = makeFilmPage(['Auditorio', 'Durante abril', '120 min']);
    expect(parseFilmSynopsis(html)).toBeUndefined();
  });

  it('returns undefined for a page with no text-editor widgets at all', () => {
    expect(
      parseFilmSynopsis('<html><body><h1>No widgets here</h1></body></html>'),
    ).toBeUndefined();
  });

  it('extracts the synopsis from real MALBA HTML (olivera-aries cycle fixture)', () => {
    // The olivera-aries page is a cycle page, not a per-film page, but the
    // Elementor widget structure is identical site-wide. This pins the
    // selector against MALBA's real markup so a theme refresh that drops
    // .elementor-widget-text-editor surfaces here. Replace with a real
    // per-film fixture (e.g. evento-una-historia-sencilla.html) once we
    // capture one — the rate limit was active when this code shipped.
    const realHtml = readFileSync(
      resolve(__dirname, '../../test/fixtures/malba/evento-olivera-aries.html'),
      'utf8',
    );
    const synopsis = parseFilmSynopsis(realHtml);
    expect(synopsis).toBeDefined();
    expect(synopsis!.startsWith('El 5 de abril cumple 95 años')).toBe(true);
    expect(synopsis!.length).toBeGreaterThan(400);
  });
});

describe('enrichFromFilmDetailPages — dedup, write-through, error tolerance', () => {
  function makeScreening(
    filmDetailUrl: string | undefined,
    overrides: Partial<ScrapedScreening> = {},
  ): ScrapedScreening {
    return {
      cinemaId: 'malba',
      filmTitle: 'Some film',
      startsAtUtc: new Date('2026-04-25T23:00:00Z'),
      tags: ['cycle'],
      sourceUrl: 'https://malba.org.ar/evento/some-cycle/',
      ...(filmDetailUrl ? { filmDetailUrl } : {}),
      ...overrides,
    };
  }

  // Synopsis-bearing HTML used by the fake fetcher.
  const filmHtml = (synopsis: string) => `
    <html><body>
      <div class="elementor-widget elementor-widget-text-editor">
        <div class="elementor-widget-container">${synopsis}</div>
      </div>
    </body></html>
  `;

  it('fetches each unique filmDetailUrl exactly once even with multiple showtimes', async () => {
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      return filmHtml(
        'Lynch reordena el suburbio. Un oído en el pasto inicia el descenso. Ningún plano es lo que parece, todo se reescribe en el segundo acto.',
      );
    };
    const url = 'https://malba.org.ar/evento/terciopelo-azul/';
    const screenings = [makeScreening(url), makeScreening(url), makeScreening(url)];

    await enrichFromFilmDetailPages(screenings, [], fetcher, 0);

    expect(calls).toEqual([url]);
    for (const s of screenings) {
      expect(s.synopsisEs!.startsWith('Lynch reordena')).toBe(true);
    }
  });

  it('skips screenings without filmDetailUrl (S2 prose-style cycles)', async () => {
    const calls: string[] = [];
    const fetcher = async (url: string) => {
      calls.push(url);
      return filmHtml('should not be reached');
    };
    const screenings = [makeScreening(undefined)];

    await enrichFromFilmDetailPages(screenings, [], fetcher, 0);

    expect(calls).toEqual([]);
    expect(screenings[0].synopsisEs).toBeUndefined();
  });

  it('records a warning and continues when a single film page fails', async () => {
    const fetcher = async (url: string) => {
      if (url.includes('broken')) throw new Error('HTTP 503');
      return filmHtml(
        'A working synopsis with enough characters to pass the 60-char threshold imposed by parseFilmSynopsis.',
      );
    };
    const warnings: string[] = [];
    const screenings = [
      makeScreening('https://malba.org.ar/evento/working/', { filmTitle: 'Working' }),
      makeScreening('https://malba.org.ar/evento/broken/', { filmTitle: 'Broken' }),
    ];

    await enrichFromFilmDetailPages(screenings, warnings, fetcher, 0);

    expect(screenings.find((s) => s.filmTitle === 'Working')!.synopsisEs).toBeDefined();
    expect(screenings.find((s) => s.filmTitle === 'Broken')!.synopsisEs).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/HTTP 503/);
    expect(warnings[0]).toContain('https://malba.org.ar/evento/broken/');
  });

  it('does not overwrite a synopsisEs already set on the screening', async () => {
    const fetcher = async () =>
      filmHtml(
        'Detail-page synopsis that should NOT replace agenda-provided text — provider fields win.',
      );
    const url = 'https://malba.org.ar/evento/some-film/';
    const screenings = [
      makeScreening(url, { synopsisEs: 'Pre-set synopsis (verbatim).' }),
    ];

    await enrichFromFilmDetailPages(screenings, [], fetcher, 0);

    expect(screenings[0].synopsisEs).toBe('Pre-set synopsis (verbatim).');
  });
});
