/**
 * Tests for the .ics (RFC 5545) generator.
 *
 * Cover:
 *   - escapeText: backslash, semicolon, comma, newline (all variants)
 *   - escapeText: non-ASCII passes through (Spanish accents, ñ)
 *   - formatUtcDateTime: zero-padding + Zulu suffix
 *   - buildScreeningIcs: required envelope (BEGIN/END VCALENDAR + VEVENT)
 *   - buildScreeningIcs: CRLF line endings
 *   - buildScreeningIcs: DTEND uses film.runtimeMin when present
 *   - buildScreeningIcs: DTEND falls back to +120min when runtime missing
 *   - buildScreeningIcs: comma in title is escaped (LOCATION & SUMMARY)
 *   - buildScreeningIcs: URL property points to /pelicula/<slug> when slug present
 *   - buildScreeningIcs: URL property falls back to sourceUrl when slug missing
 *   - buildScreeningIcs: DESCRIPTION includes director · year and source URL
 *   - buildScreeningIcs: UID is stable + globally unique by screening id
 */

import { describe, it, expect } from 'vitest';
import { escapeText, formatUtcDateTime, buildScreeningIcs, type IcsScreeningInput } from './ics';

describe('escapeText', () => {
  it('escapes backslash first to avoid double-escaping later escapes', () => {
    expect(escapeText('a\\b')).toBe('a\\\\b');
  });

  it('escapes semicolon', () => {
    expect(escapeText('a;b')).toBe('a\\;b');
  });

  it('escapes comma', () => {
    expect(escapeText('Buenos Aires, Argentina')).toBe('Buenos Aires\\, Argentina');
  });

  it('collapses CRLF / CR / LF to literal \\n', () => {
    expect(escapeText('line1\nline2')).toBe('line1\\nline2');
    expect(escapeText('line1\r\nline2')).toBe('line1\\nline2');
    expect(escapeText('line1\rline2')).toBe('line1\\nline2');
  });

  it('passes Spanish accents and ñ through unchanged', () => {
    expect(escapeText('Después de la lluvia')).toBe('Después de la lluvia');
    expect(escapeText('Año uña ñoqui')).toBe('Año uña ñoqui');
  });

  it('handles combined escapes in one pass', () => {
    expect(escapeText('a; b, c\nd\\e')).toBe('a\\; b\\, c\\nd\\\\e');
  });
});

describe('formatUtcDateTime', () => {
  it('formats with zero-padded fields and Z suffix', () => {
    const d = new Date(Date.UTC(2026, 0, 5, 3, 7, 9));
    expect(formatUtcDateTime(d)).toBe('20260105T030709Z');
  });

  it('formats end-of-year midnight correctly', () => {
    const d = new Date(Date.UTC(2026, 11, 31, 23, 59, 0));
    expect(formatUtcDateTime(d)).toBe('20261231T235900Z');
  });
});

function baseInput(): IcsScreeningInput {
  return {
    id: 42,
    startsAtUtc: new Date(Date.UTC(2026, 5, 15, 23, 0, 0)),
    film: {
      title: 'Mulholland Drive',
      director: 'David Lynch',
      year: 2001,
      runtimeMin: 147,
      slug: 'mulholland-drive',
    },
    cinema: {
      name: 'MALBA',
      address: 'Av. Figueroa Alcorta 3415',
    },
    sourceUrl: 'https://example.org/tickets',
  };
}

const FIXED_NOW = new Date(Date.UTC(2026, 4, 30, 12, 0, 0));

describe('buildScreeningIcs', () => {
  it('emits required VCALENDAR + VEVENT envelope', () => {
    const ics = buildScreeningIcs(baseInput(), FIXED_NOW);
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toContain('VERSION:2.0\r\n');
    expect(ics).toContain('BEGIN:VEVENT\r\n');
    expect(ics).toContain('END:VEVENT\r\n');
    expect(ics).toMatch(/END:VCALENDAR\r\n$/);
  });

  it('uses CRLF line endings throughout', () => {
    const ics = buildScreeningIcs(baseInput(), FIXED_NOW);
    // No bare LFs without a preceding CR.
    const bareLfCount = (ics.match(/(?<!\r)\n/g) ?? []).length;
    expect(bareLfCount).toBe(0);
  });

  it('writes DTSTART and DTEND using film.runtimeMin', () => {
    const ics = buildScreeningIcs(baseInput(), FIXED_NOW);
    expect(ics).toContain('DTSTART:20260615T230000Z');
    // 23:00 UTC + 147 min = 01:27 UTC next day.
    expect(ics).toContain('DTEND:20260616T012700Z');
  });

  it('falls back to a 120-minute DTEND when runtimeMin is null', () => {
    const input = baseInput();
    input.film.runtimeMin = null;
    const ics = buildScreeningIcs(input, FIXED_NOW);
    // 23:00 + 120 min = 01:00 next day.
    expect(ics).toContain('DTEND:20260616T010000Z');
  });

  it('uses the supplied `now` for DTSTAMP', () => {
    const ics = buildScreeningIcs(baseInput(), FIXED_NOW);
    expect(ics).toContain('DTSTAMP:20260530T120000Z');
  });

  it('escapes commas in SUMMARY and LOCATION', () => {
    const input = baseInput();
    input.film.title = 'Roma, ciudad abierta';
    const ics = buildScreeningIcs(input, FIXED_NOW);
    expect(ics).toContain('SUMMARY:Roma\\, ciudad abierta');
    // Cinema "MALBA, Av. Figueroa Alcorta 3415" → both commas escaped.
    expect(ics).toContain('LOCATION:MALBA\\, Av. Figueroa Alcorta 3415');
  });

  it('escapes semicolons and backslashes in title', () => {
    const input = baseInput();
    input.film.title = 'a;b\\c';
    const ics = buildScreeningIcs(input, FIXED_NOW);
    expect(ics).toContain('SUMMARY:a\\;b\\\\c');
  });

  it('URL property points to /pelicula/<slug> when slug present', () => {
    const ics = buildScreeningIcs(baseInput(), FIXED_NOW);
    expect(ics).toContain('URL:https://afiche.vercel.app/pelicula/mulholland-drive');
  });

  it('URL property falls back to sourceUrl when slug is null', () => {
    const input = baseInput();
    input.film.slug = null;
    const ics = buildScreeningIcs(input, FIXED_NOW);
    expect(ics).toContain('URL:https://example.org/tickets');
  });

  it('omits URL property entirely when both slug and sourceUrl are null', () => {
    const input = baseInput();
    input.film.slug = null;
    input.sourceUrl = null;
    const ics = buildScreeningIcs(input, FIXED_NOW);
    expect(ics).not.toContain('\r\nURL:');
  });

  it('DESCRIPTION carries director · year and the source URL', () => {
    const ics = buildScreeningIcs(baseInput(), FIXED_NOW);
    // Newlines in DESCRIPTION are escaped to literal \n.
    expect(ics).toContain('DESCRIPTION:David Lynch · 2001\\n\\nhttps://afiche.vercel.app/pelicula/mulholland-drive\\n\\nEntradas: https://example.org/tickets');
  });

  it('LOCATION omits the address suffix when cinema.address is null', () => {
    const input = baseInput();
    input.cinema.address = null;
    const ics = buildScreeningIcs(input, FIXED_NOW);
    expect(ics).toContain('LOCATION:MALBA\r\n');
  });

  it('UID is stable per screening id and globally scoped', () => {
    const ics = buildScreeningIcs(baseInput(), FIXED_NOW);
    expect(ics).toContain('UID:screening-42@afiche.vercel.app');
  });
});
