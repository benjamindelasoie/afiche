/**
 * Tests for displayFilmTitle — the render-layer title resolver.
 *
 * Cover:
 *   - Gating: matched rows take TMDB's title only when the venue agrees
 *   - Venue-title honoring (Option B): a genuinely different venue title wins
 *   - Casing drift (case/accent/punctuation) counts as "same" → TMDB casing
 *   - Already-cased titles pass through untouched
 *   - All-caps Spanish titles get sentence-cased
 *   - Diacritics survive the lower/upper round trip
 *   - Colon does NOT introduce a new capital (Spanish typography)
 *   - Period / ! / ? do introduce a new capital
 *   - Leading punctuation (« ¡ ¿ ") doesn't suppress the first capital
 *   - Acronym-only / proper-noun degradation is accepted
 *   - Short / no-letter / non-Latin titles are no-ops
 *
 * For unmatched rows, films.title === scraped_title by construction (TMDB
 * never wrote), so those cases pass scrapedTitle equal to title.
 */

import { describe, it, expect } from 'vitest';
import { displayFilmTitle } from './title-case';

const matched = { matchSource: 'auto' as const, skipTmdb: false };
const unmatched = { matchSource: 'none-attempted' as const, skipTmdb: false };
const never = { matchSource: 'none' as const, skipTmdb: false };
const skipped = { matchSource: 'none' as const, skipTmdb: true };

describe('displayFilmTitle — gating', () => {
  it('returns the TMDB title verbatim when the venue agrees (even if all-caps)', () => {
    expect(displayFilmTitle({ title: 'JOKER', scrapedTitle: 'JOKER', ...matched })).toBe(
      'JOKER',
    );
  });

  it('re-cases titles with match_source = none-attempted', () => {
    expect(
      displayFilmTitle({
        title: 'PELÍCULA SORPRESA',
        scrapedTitle: 'PELÍCULA SORPRESA',
        ...unmatched,
      }),
    ).toBe('Película sorpresa');
  });

  it('re-cases titles with match_source = none', () => {
    expect(
      displayFilmTitle({ title: 'EL DESPRECIO', scrapedTitle: 'EL DESPRECIO', ...never }),
    ).toBe('El desprecio');
  });

  it('re-cases titles with skip_tmdb = true (non-film labels)', () => {
    expect(
      displayFilmTitle({
        title: 'EL LADO MUTANTE DE LA FUERZA',
        scrapedTitle: 'EL LADO MUTANTE DE LA FUERZA',
        ...skipped,
      }),
    ).toBe('El lado mutante de la fuerza');
  });
});

describe('displayFilmTitle — venue title (Option B)', () => {
  it('uses TMDB clean casing when the venue title matches modulo case', () => {
    // Cine Lorca all-caps "EL CONFORMISTA" → matched to TMDB "El conformista".
    expect(
      displayFilmTitle({ title: 'El conformista', scrapedTitle: 'EL CONFORMISTA', ...matched }),
    ).toBe('El conformista');
  });

  it('keeps TMDB proper-noun casing on a same-title match (not "La reina margot")', () => {
    expect(
      displayFilmTitle({ title: 'La reina Margot', scrapedTitle: 'LA REINA MARGOT', ...matched }),
    ).toBe('La reina Margot');
  });

  it('treats accent/punctuation drift as the same title (TMDB wins)', () => {
    expect(
      displayFilmTitle({ title: 'Amélie', scrapedTitle: 'AMELIE', ...matched }),
    ).toBe('Amélie');
  });

  it('honors the venue title when it genuinely differs from TMDB', () => {
    // Cine Lorca shows "El gran arco"; TMDB canonical is "El arquitecto"
    // (L'inconnu de la Grande Arche). The marquee says "El gran arco".
    expect(
      displayFilmTitle({ title: 'El arquitecto', scrapedTitle: 'EL GRAN ARCO', ...matched }),
    ).toBe('El gran arco');
  });

  it('honors an already-cased differing venue title verbatim', () => {
    expect(
      displayFilmTitle({ title: 'El arquitecto', scrapedTitle: 'El gran arco', ...matched }),
    ).toBe('El gran arco');
  });

  it('accepts proper-noun lowercasing on a differing all-caps venue title', () => {
    // Documented residual: when the venue invented a different all-caps title
    // containing a proper noun, sentence-casing lowercases it. Rare; Lorca's
    // vision prompt mitigates this upstream by emitting natural casing.
    expect(
      displayFilmTitle({
        title: 'Last Tango in Paris',
        scrapedTitle: 'EL ÚLTIMO TANGO EN PARÍS',
        ...matched,
      }),
    ).toBe('El último tango en parís');
  });
});

describe('displayFilmTitle — sentence case', () => {
  it('keeps colons lowercase per Spanish typography', () => {
    expect(
      displayFilmTitle({
        title: 'GIOIA MIA: UN VERANO EN SICILIA',
        scrapedTitle: 'GIOIA MIA: UN VERANO EN SICILIA',
        ...unmatched,
      }),
    ).toBe('Gioia mia: un verano en sicilia');
  });

  it('capitalizes after period, exclamation, question mark', () => {
    expect(
      displayFilmTitle({ title: 'PARTE I. PARTE II', scrapedTitle: 'PARTE I. PARTE II', ...unmatched }),
    ).toBe('Parte i. Parte ii');
    expect(
      displayFilmTitle({ title: '¿QUIÉN? ¡SÍ!', scrapedTitle: '¿QUIÉN? ¡SÍ!', ...unmatched }),
    ).toBe('¿Quién? ¡Sí!');
  });

  it('preserves diacritics through the case round trip', () => {
    expect(
      displayFilmTitle({
        title: 'FUNCIÓN ESPECIAL: UN BUEN DÍA + DESPUÉS DE UN BUEN DÍA',
        scrapedTitle: 'FUNCIÓN ESPECIAL: UN BUEN DÍA + DESPUÉS DE UN BUEN DÍA',
        ...unmatched,
      }),
    ).toBe('Función especial: un buen día + después de un buen día');
  });

  it('handles leading punctuation by capitalizing the first letter', () => {
    expect(
      displayFilmTitle({ title: '«PELÍCULA»', scrapedTitle: '«PELÍCULA»', ...unmatched }),
    ).toBe('«Película»');
  });

  it('accepts proper-noun degradation', () => {
    expect(
      displayFilmTitle({ title: 'BLADE RUNNER', scrapedTitle: 'BLADE RUNNER', ...unmatched }),
    ).toBe('Blade runner');
  });
});

describe('displayFilmTitle — no-op paths', () => {
  it('leaves mixed-case titles untouched even when unmatched', () => {
    expect(
      displayFilmTitle({
        title: 'El último capítulo',
        scrapedTitle: 'El último capítulo',
        ...unmatched,
      }),
    ).toBe('El último capítulo');
  });

  it('leaves single-letter and empty-ish strings untouched', () => {
    expect(displayFilmTitle({ title: '', scrapedTitle: '', ...unmatched })).toBe('');
    expect(displayFilmTitle({ title: 'A', scrapedTitle: 'A', ...unmatched })).toBe('A');
  });

  it('leaves no-letter strings untouched', () => {
    expect(displayFilmTitle({ title: '12 + 34', scrapedTitle: '12 + 34', ...unmatched })).toBe(
      '12 + 34',
    );
  });

  it('leaves non-cased scripts untouched', () => {
    expect(
      displayFilmTitle({ title: 'スタンドアロン', scrapedTitle: 'スタンドアロン', ...unmatched }),
    ).toBe('スタンドアロン');
  });
});
