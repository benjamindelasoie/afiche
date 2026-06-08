/**
 * Tests for src/lib/json-ld.ts + src/lib/json-ld.tsx (<JsonLd>).
 *
 * Covers per eng-review test plan (2026-05-17):
 *   - Atomic builders (buildMovie, buildMovieTheater, buildScreeningEvent)
 *     with happy path + each nullable field omission case
 *   - Top-level wrappers (buildHomepageJsonLd, buildFilmPageJsonLd)
 *   - serialize() — CRITICAL </script> escape (XSS prevention), empty
 *     payload, non-ASCII passthrough, U+2028 / U+2029 escape
 *   - <JsonLd> component renders <script type="application/ld+json">
 *     with the serialized payload and the </script> escape round-trips
 *     correctly to the final HTML
 *
 * Vitest's environment is 'node' (no jsdom). The component test uses
 * react-dom/server's renderToString + React.createElement (so this stays
 * a .ts file matched by the existing src/**\/*.test.ts glob).
 */
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import {
  buildMovie,
  buildMovieTheater,
  buildScreeningEvent,
  buildHomepageJsonLd,
  buildFilmPageJsonLd,
  serialize,
} from './json-ld';
import { JsonLd } from './json-ld';
import type { ScreeningRow } from '@/db/queries';

// ---------------------------------------------------------------------------
// Fixture builders. Match ScreeningRow shape; override fields per test.
// ---------------------------------------------------------------------------

function makeFilm(overrides: Partial<ScreeningRow['film']> = {}): ScreeningRow['film'] {
  return {
    id: 1,
    title: 'Mulholland Drive',
    titleOriginal: null,
    director: 'David Lynch',
    year: 2001,
    country: 'US',
    runtimeMin: 147,
    synopsisEs:
      'Una rubia amnésica vaga por las calles de Los Ángeles tras un accidente.',
    posterUrl: 'https://image.tmdb.org/t/p/w500/abc.jpg',
    backdropUrl: null,
    slug: 'mulholland-drive',
    cast: null,
    genres: null,
    popularity: null,
    voteAverage: null,
    voteCount: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeCinema(
  overrides: Partial<ScreeningRow['cinema']> = {},
): ScreeningRow['cinema'] {
  return {
    id: 'lorca',
    name: 'Cine Lorca',
    neighborhood: 'San Nicolás',
    address: 'Avenida Corrientes 1428',
    type: 'indie',
    ...overrides,
  };
}

function makeScreening(overrides: Partial<ScreeningRow> = {}): ScreeningRow {
  // 2026-05-20T23:00:00Z = 2026-05-20T20:00:00-03:00 (BA evening)
  return {
    id: 1001,
    startsAtUtc: new Date('2026-05-20T23:00:00Z'),
    tags: [],
    sourceUrl: null,
    programName: null,
    film: makeFilm(),
    cinema: makeCinema(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildMovie
// ---------------------------------------------------------------------------

describe('buildMovie', () => {
  it('emits all fields when the film has full TMDB metadata', () => {
    const m = buildMovie(makeFilm());
    expect(m['@type']).toBe('Movie');
    expect(m['@id']).toBe('urn:afiche:film:mulholland-drive');
    expect(m.name).toBe('Mulholland Drive');
    expect(m.image).toBe('https://image.tmdb.org/t/p/w500/abc.jpg');
    expect(m.description).toContain('rubia amnésica');
    expect(m.director).toEqual({ '@type': 'Person', name: 'David Lynch' });
    expect(m.datePublished).toBe('2001');
    expect(m.duration).toBe('PT147M');
  });

  it('omits @id when slug is null (legacy rows pre-backfill)', () => {
    const m = buildMovie(makeFilm({ slug: null }));
    expect(m['@id']).toBeUndefined();
    expect(m.name).toBe('Mulholland Drive');
  });

  it('omits director when null', () => {
    const m = buildMovie(makeFilm({ director: null }));
    expect(m.director).toBeUndefined();
    // Required field still present.
    expect(m.name).toBe('Mulholland Drive');
  });

  it('omits datePublished when year is null', () => {
    const m = buildMovie(makeFilm({ year: null }));
    expect(m.datePublished).toBeUndefined();
  });

  it('omits duration when runtimeMin is null', () => {
    const m = buildMovie(makeFilm({ runtimeMin: null }));
    expect(m.duration).toBeUndefined();
  });

  it('omits description when synopsisEs is null', () => {
    const m = buildMovie(makeFilm({ synopsisEs: null }));
    expect(m.description).toBeUndefined();
  });

  it('falls back to the branded no-poster SVG when posterUrl is null', () => {
    // Unenriched films must still emit an `image` field — Google's Event
    // rich-result eligibility requires it, and the fallback matches the
    // branded UI fallback in homepage + /pelicula. See public/no-poster.svg.
    const m = buildMovie(makeFilm({ posterUrl: null }));
    expect(m.image).toBe('https://afiche.ar/no-poster.svg');
  });

  it('uses the real TMDB poster when present, not the fallback', () => {
    const m = buildMovie(makeFilm());
    expect(m.image).toBe('https://image.tmdb.org/t/p/w500/abc.jpg');
    expect(m.image).not.toContain('no-poster');
  });
});

// ---------------------------------------------------------------------------
// buildMovieTheater
// ---------------------------------------------------------------------------

describe('buildMovieTheater', () => {
  it('always emits an @id URN + PostalAddress with addressLocality + addressCountry', () => {
    const t = buildMovieTheater(makeCinema());
    expect(t['@type']).toBe('MovieTheater');
    expect(t['@id']).toBe('urn:afiche:cine:lorca');
    expect(t.name).toBe('Cine Lorca');
    expect(t.address['@type']).toBe('PostalAddress');
    expect(t.address.addressLocality).toBe('Buenos Aires');
    expect(t.address.addressCountry).toBe('AR');
  });

  it('emits the same @id across multiple calls for the same cinema (dedup signal)', () => {
    const t1 = buildMovieTheater(makeCinema());
    const t2 = buildMovieTheater(makeCinema());
    expect(t1['@id']).toBe(t2['@id']);
  });

  it('emits streetAddress when cinema.address is present', () => {
    const t = buildMovieTheater(makeCinema());
    expect(t.address.streetAddress).toBe('Avenida Corrientes 1428');
  });

  it('omits streetAddress when cinema.address is null (PostalAddress stays valid)', () => {
    const t = buildMovieTheater(makeCinema({ address: null }));
    expect(t.address.streetAddress).toBeUndefined();
    // Required PostalAddress fields stay present even without streetAddress.
    expect(t.address.addressLocality).toBe('Buenos Aires');
    expect(t.address.addressCountry).toBe('AR');
  });

  it('drops the cinema neighborhood from JSON-LD (no clean Schema.org slot)', () => {
    const t = buildMovieTheater(makeCinema({ neighborhood: 'Palermo' }));
    // Neighborhood does not surface anywhere on the address — Schema.org
    // has no sub-locality property; PostalAddress.addressLocality is "city".
    const json = JSON.stringify(t);
    expect(json).not.toContain('Palermo');
    expect(json).not.toContain('San Nicolás');
  });
});

// ---------------------------------------------------------------------------
// buildScreeningEvent
// ---------------------------------------------------------------------------

describe('buildScreeningEvent', () => {
  it('emits required Schema.org fields + eventStatus + eventAttendanceMode', () => {
    const e = buildScreeningEvent(makeScreening());
    expect(e['@type']).toBe('ScreeningEvent');
    expect(e.name).toContain('Mulholland Drive');
    expect(e.name).toContain('Cine Lorca');
    expect(e.eventStatus).toBe('https://schema.org/EventScheduled');
    expect(e.eventAttendanceMode).toBe('https://schema.org/OfflineEventAttendanceMode');
    expect(e.location['@type']).toBe('MovieTheater');
    expect(e.workPresented['@type']).toBe('Movie');
  });

  it('startDate emits BA-local ISO 8601 with -03:00 offset (not UTC Z)', () => {
    const e = buildScreeningEvent(makeScreening());
    // 2026-05-20T23:00:00Z UTC == 2026-05-20T20:00:00-03:00 BA
    expect(e.startDate).toBe('2026-05-20T20:00:00-03:00');
    expect(e.startDate).not.toMatch(/Z$/);
  });

  it('computes endDate as startDate + runtime when runtime is known', () => {
    const e = buildScreeningEvent(makeScreening()); // runtimeMin: 147
    // 20:00 + 147 min = 22:27
    expect(e.endDate).toBe('2026-05-20T22:27:00-03:00');
  });

  it('omits endDate when runtimeMin is null', () => {
    const e = buildScreeningEvent(
      makeScreening({ film: makeFilm({ runtimeMin: null }) }),
    );
    expect(e.endDate).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildHomepageJsonLd
// ---------------------------------------------------------------------------

describe('buildHomepageJsonLd', () => {
  it('returns empty array for empty screening list', () => {
    const out = buildHomepageJsonLd([]);
    expect(out).toEqual([]);
  });

  it('includes screenings within the 7-day window', () => {
    const now = new Date('2026-05-20T00:00:00Z');
    const in3days = makeScreening({
      startsAtUtc: new Date('2026-05-23T22:00:00Z'),
    });
    const out = buildHomepageJsonLd([in3days], { now });
    expect(out).toHaveLength(1);
  });

  it('excludes screenings beyond the 7-day window', () => {
    const now = new Date('2026-05-20T00:00:00Z');
    const in10days = makeScreening({
      startsAtUtc: new Date('2026-05-30T22:00:00Z'),
    });
    const out = buildHomepageJsonLd([in10days], { now });
    expect(out).toEqual([]);
  });

  it('emits each in-window screening as a typed ScreeningEvent with its own @context', () => {
    const now = new Date('2026-05-20T00:00:00Z');
    const a = makeScreening({ startsAtUtc: new Date('2026-05-20T22:00:00Z') });
    const b = makeScreening({ id: 1002, startsAtUtc: new Date('2026-05-21T22:00:00Z') });
    const out = buildHomepageJsonLd([a, b], { now });
    expect(out).toHaveLength(2);
    expect(out[0]['@context']).toBe('https://schema.org');
    expect(out[0]['@type']).toBe('ScreeningEvent');
    expect(out[1]['@context']).toBe('https://schema.org');
    expect(out[1]['@type']).toBe('ScreeningEvent');
  });

  it('no `@graph` wrapper anywhere in the output (Google validator trips on typeless roots)', () => {
    const now = new Date('2026-05-20T00:00:00Z');
    const a = makeScreening({ startsAtUtc: new Date('2026-05-20T22:00:00Z') });
    const out = buildHomepageJsonLd([a], { now });
    const json = JSON.stringify(out);
    expect(json).not.toContain('@graph');
  });

  it('two screenings of the same film at the same cinema share embedded @ids (Schema.org dedup signal)', () => {
    const now = new Date('2026-05-20T00:00:00Z');
    const a = makeScreening({ startsAtUtc: new Date('2026-05-20T22:00:00Z') });
    const b = makeScreening({ id: 1002, startsAtUtc: new Date('2026-05-21T22:00:00Z') });
    const out = buildHomepageJsonLd([a, b], { now });
    expect(out).toHaveLength(2);
    expect(out[0].location['@id']).toBe(out[1].location['@id']);
    expect(out[0].workPresented['@id']).toBe(out[1].workPresented['@id']);
    // And the @ids carry the URN prefix.
    expect(out[0].location['@id']).toMatch(/^urn:afiche:cine:/);
    expect(out[0].workPresented['@id']).toMatch(/^urn:afiche:film:/);
  });
});

// ---------------------------------------------------------------------------
// buildFilmPageJsonLd
// ---------------------------------------------------------------------------

describe('buildFilmPageJsonLd', () => {
  it('returns Movie at root + subjectOf.itemListElement with screenings', () => {
    const film = makeFilm();
    const out = buildFilmPageJsonLd(film, [makeScreening()]);
    expect(out['@context']).toBe('https://schema.org');
    expect(out['@type']).toBe('Movie');
    expect(out.name).toBe('Mulholland Drive');
    expect(out.subjectOf['@type']).toBe('ItemList');
    expect(out.subjectOf.itemListElement).toHaveLength(1);
    expect(out.subjectOf.itemListElement[0]['@type']).toBe('ScreeningEvent');
  });

  it('preserves screening order from the input array', () => {
    const film = makeFilm();
    const a = makeScreening({ startsAtUtc: new Date('2026-05-20T22:00:00Z') });
    const b = makeScreening({ id: 1002, startsAtUtc: new Date('2026-05-21T22:00:00Z') });
    const out = buildFilmPageJsonLd(film, [a, b]);
    expect(out.subjectOf.itemListElement[0].startDate).toBe('2026-05-20T19:00:00-03:00');
    expect(out.subjectOf.itemListElement[1].startDate).toBe('2026-05-21T19:00:00-03:00');
  });
});

// ---------------------------------------------------------------------------
// serialize — CRITICAL XSS escape + JSON encoding edges
// ---------------------------------------------------------------------------

describe('serialize', () => {
  it('[CRITICAL] escapes </ sequences to <\\/ (script-tag breakout prevention)', () => {
    const out = serialize({ description: 'Spoiler: </script>alert(1)</script>' });
    // After escape, the dangerous </script> closing-tag sequence cannot
    // appear literally in the output.
    expect(out).not.toContain('</script>');
    expect(out).toContain('<\\/script>');
  });

  it('returns "{}" for an empty object payload', () => {
    expect(serialize({})).toBe('{}');
  });

  it('passes through Spanish accents unchanged (Después, Ángeles, ñ)', () => {
    const out = serialize({ name: 'Después de la lluvia', country: 'Argentinañ' });
    expect(out).toContain('Después de la lluvia');
    expect(out).toContain('Argentinañ');
  });

  it('escapes U+2028 line separator to \\u2028', () => {
    const out = serialize({ description: 'before after' });
    expect(out).toContain('\\u2028');
    expect(out).not.toContain(String.fromCharCode(0x2028));
  });

  it('escapes U+2029 paragraph separator to \\u2029', () => {
    const out = serialize({ description: 'before after' });
    expect(out).toContain('\\u2029');
    expect(out).not.toContain(String.fromCharCode(0x2029));
  });
});

// ---------------------------------------------------------------------------
// <JsonLd> component — renderToString round-trip
// ---------------------------------------------------------------------------

describe('<JsonLd> component', () => {
  it('renders a <script type="application/ld+json"> with the serialized payload', () => {
    const html = renderToString(
      createElement(JsonLd, { payload: { '@type': 'Movie', name: 'Mulholland Drive' } }),
    );
    expect(html).toContain('<script type="application/ld+json">');
    expect(html).toContain('"@type":"Movie"');
    expect(html).toContain('"name":"Mulholland Drive"');
    // Exactly one closing tag (the script's own).
    const closingTagCount = (html.match(/<\/script>/g) ?? []).length;
    expect(closingTagCount).toBe(1);
  });

  it('round-trip: </script> in payload renders as <\\/script> in output (XSS protection)', () => {
    const html = renderToString(
      createElement(JsonLd, {
        payload: { description: 'Trailer link: </script>alert(1)' },
      }),
    );
    // The script tag itself ends with </script>; the escaped <\/script>
    // appears inside the JSON. Verify EXACTLY one literal </script>
    // (the tag close) and that the payload's dangerous sequence is
    // present in the safe escaped form.
    const closingTagCount = (html.match(/<\/script>/g) ?? []).length;
    expect(closingTagCount).toBe(1);
    expect(html).toContain('<\\/script>');
  });
});
