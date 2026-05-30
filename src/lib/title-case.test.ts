/**
 * Tests for displayFilmTitle — the render-layer smart-casing helper.
 *
 * Cover:
 *   - Trigger gating: only fires for unmatched / skip_tmdb rows
 *   - Already-cased titles pass through untouched
 *   - All-caps Spanish titles get sentence-cased
 *   - Diacritics survive the lower/upper round trip
 *   - Colon does NOT introduce a new capital (Spanish typography)
 *   - Period / ! / ? do introduce a new capital
 *   - Leading punctuation (« ¡ ¿ ") doesn't suppress the first capital
 *   - Acronym-only / proper-noun degradation is accepted
 *   - Short / no-letter / non-Latin titles are no-ops
 */

import { describe, it, expect } from 'vitest';
import { displayFilmTitle } from './title-case';

const matched = { matchSource: 'auto' as const, skipTmdb: false };
const unmatched = { matchSource: 'none-attempted' as const, skipTmdb: false };
const never = { matchSource: 'none' as const, skipTmdb: false };
const skipped = { matchSource: 'none' as const, skipTmdb: true };

describe('displayFilmTitle — gating', () => {
  it('returns matched titles unchanged even if they are all-caps', () => {
    expect(displayFilmTitle({ title: 'JOKER', ...matched })).toBe('JOKER');
  });

  it('re-cases titles with match_source = none-attempted', () => {
    expect(displayFilmTitle({ title: 'PELÍCULA SORPRESA', ...unmatched })).toBe(
      'Película sorpresa',
    );
  });

  it('re-cases titles with match_source = none', () => {
    expect(displayFilmTitle({ title: 'EL DESPRECIO', ...never })).toBe('El desprecio');
  });

  it('re-cases titles with skip_tmdb = true (non-film labels)', () => {
    expect(displayFilmTitle({ title: 'EL LADO MUTANTE DE LA FUERZA', ...skipped })).toBe(
      'El lado mutante de la fuerza',
    );
  });
});

describe('displayFilmTitle — sentence case', () => {
  it('keeps colons lowercase per Spanish typography', () => {
    expect(
      displayFilmTitle({
        title: 'GIOIA MIA: UN VERANO EN SICILIA',
        ...unmatched,
      }),
    ).toBe('Gioia mia: un verano en sicilia');
  });

  it('capitalizes after period, exclamation, question mark', () => {
    expect(displayFilmTitle({ title: 'PARTE I. PARTE II', ...unmatched })).toBe(
      'Parte i. Parte ii',
    );
    expect(displayFilmTitle({ title: '¿QUIÉN? ¡SÍ!', ...unmatched })).toBe(
      '¿Quién? ¡Sí!',
    );
  });

  it('preserves diacritics through the case round trip', () => {
    expect(
      displayFilmTitle({
        title: 'FUNCIÓN ESPECIAL: UN BUEN DÍA + DESPUÉS DE UN BUEN DÍA',
        ...unmatched,
      }),
    ).toBe('Función especial: un buen día + después de un buen día');
  });

  it('handles leading punctuation by capitalizing the first letter', () => {
    expect(displayFilmTitle({ title: '«PELÍCULA»', ...unmatched })).toBe('«Película»');
  });

  it('accepts proper-noun degradation', () => {
    expect(displayFilmTitle({ title: 'BLADE RUNNER', ...unmatched })).toBe(
      'Blade runner',
    );
  });
});

describe('displayFilmTitle — no-op paths', () => {
  it('leaves mixed-case titles untouched even when unmatched', () => {
    expect(displayFilmTitle({ title: 'El último capítulo', ...unmatched })).toBe(
      'El último capítulo',
    );
  });

  it('leaves single-letter and empty-ish strings untouched', () => {
    expect(displayFilmTitle({ title: '', ...unmatched })).toBe('');
    expect(displayFilmTitle({ title: 'A', ...unmatched })).toBe('A');
  });

  it('leaves no-letter strings untouched', () => {
    expect(displayFilmTitle({ title: '12 + 34', ...unmatched })).toBe('12 + 34');
  });

  it('leaves non-cased scripts untouched', () => {
    expect(displayFilmTitle({ title: 'スタンドアロン', ...unmatched })).toBe(
      'スタンドアロン',
    );
  });
});
