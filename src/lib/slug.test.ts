/**
 * Tests for slugify + buildFilmSlug.
 *
 * Cover:
 *   - ASCII titles (happy path)
 *   - Spanish accents (á, é, í, ó, ú)
 *   - Spanish ñ
 *   - Diéresis (ü)
 *   - Spanish opening punctuation (¿, ¡)
 *   - Spanish quotation marks («», "")
 *   - Em-dash / en-dash collapse
 *   - Multi-space collapse
 *   - Trailing/leading hyphen trim
 *   - Empty input
 *   - Title-only-punctuation falls back to suffix
 *   - Year suffix vs id suffix priority
 *   - withIdSuffix tiebreaker shape
 */

import { describe, it, expect } from 'vitest';
import { slugify, buildFilmSlug, withIdSuffix } from './slug';

describe('slugify', () => {
  it('lowercases ASCII title and replaces spaces with hyphens', () => {
    expect(slugify('Mulholland Drive')).toBe('mulholland-drive');
  });

  it('strips Spanish tildes — á é í ó ú', () => {
    expect(slugify('Después de la lluvia')).toBe('despues-de-la-lluvia');
    expect(slugify('Más allá')).toBe('mas-alla');
    expect(slugify('Año bisiesto')).toBe('ano-bisiesto');
  });

  it('strips Spanish ñ to n', () => {
    expect(slugify('La niña santa')).toBe('la-nina-santa');
  });

  it('strips diéresis ü to u', () => {
    expect(slugify('Pingüino')).toBe('pinguino');
  });

  it('strips Spanish opening punctuation ¿ and ¡', () => {
    expect(slugify('¿Quién teme a Virginia Woolf?')).toBe('quien-teme-a-virginia-woolf');
    expect(slugify('¡Bienvenido!')).toBe('bienvenido');
  });

  it('strips Spanish quotation marks «»', () => {
    expect(slugify('«El otro»')).toBe('el-otro');
  });

  it('collapses em-dash and en-dash to a hyphen', () => {
    expect(slugify('Olivera—Aries')).toBe('olivera-aries');
    expect(slugify('Lynch–retrospective')).toBe('lynch-retrospective');
  });

  it('collapses multiple spaces to a single hyphen', () => {
    expect(slugify('a   b    c')).toBe('a-b-c');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  Hello World  ')).toBe('hello-world');
    expect(slugify('---weirdly-spaced---')).toBe('weirdly-spaced');
  });

  it('returns empty string for empty input', () => {
    expect(slugify('')).toBe('');
  });

  it('returns empty string when input is only punctuation', () => {
    expect(slugify('¿¡«»')).toBe('');
    expect(slugify('---')).toBe('');
  });

  it('caps slug length at the max (defends against pathological long titles)', () => {
    const long = 'a'.repeat(200);
    expect(slugify(long).length).toBeLessThanOrEqual(80);
  });

  it('preserves digits in titles (year as part of title is fine)', () => {
    expect(slugify('Blade Runner 2049')).toBe('blade-runner-2049');
  });
});

describe('buildFilmSlug', () => {
  it('appends year suffix when year is provided', () => {
    expect(buildFilmSlug('Mulholland Drive', { year: 2001 })).toBe(
      'mulholland-drive-2001',
    );
  });

  it('falls back to id suffix when year is null', () => {
    expect(buildFilmSlug('Untitled Doc', { year: null, id: 1234 })).toBe(
      'untitled-doc-1234',
    );
  });

  it('prefers year over id when both are provided', () => {
    expect(buildFilmSlug('Some Film', { year: 1999, id: 42 })).toBe('some-film-1999');
  });

  it('produces just the suffix when title slugifies to empty', () => {
    expect(buildFilmSlug('¿¡«»', { year: 2020 })).toBe('2020');
    expect(buildFilmSlug('---', { year: null, id: 99 })).toBe('99');
  });

  it('returns "untitled" when title is empty AND no year/id', () => {
    expect(buildFilmSlug('', { year: null })).toBe('untitled');
  });

  it('returns just the base when no suffix sources are available', () => {
    expect(buildFilmSlug('A Real Title', { year: null })).toBe('a-real-title');
  });

  it('handles real-world Argentine cinema titles', () => {
    expect(buildFilmSlug('La historia oficial', { year: 1985 })).toBe(
      'la-historia-oficial-1985',
    );
    expect(buildFilmSlug('El secreto de sus ojos', { year: 2009 })).toBe(
      'el-secreto-de-sus-ojos-2009',
    );
    expect(buildFilmSlug('Los rubios', { year: 2003 })).toBe('los-rubios-2003');
  });
});

describe('withIdSuffix', () => {
  it('appends -<id> as a collision tiebreaker', () => {
    expect(withIdSuffix('mulholland-drive-2001', 1234)).toBe(
      'mulholland-drive-2001-1234',
    );
  });

  it('is idempotent in shape (caller controls the base)', () => {
    expect(withIdSuffix('a-b-c', 1)).toBe('a-b-c-1');
  });
});
