import { describe, it, expect } from 'vitest';
import {
  jaroWinkler,
  stripDiacritics,
  levenshteinAtMostOne,
  stripSearchNoise,
} from './similarity';

// ---------------------------------------------------------------------------
// stripDiacritics — NFD-decomposable accents PLUS the extended-Latin map
// for precomposed letters NFD doesn't decompose (Polish ł, Danish ø, etc.).
// Without the map, "Żuławski" survives NFD as "Zuławski" — still a mismatch
// against TMDB's anglicized "Zulawski".
// ---------------------------------------------------------------------------
describe('stripSearchNoise', () => {
  it('strips live-music and format tags that break TMDB search', () => {
    expect(stripSearchNoise('LA QUIMERA DEL ORO CON MÚSICA EN VIVO')).toBe(
      'LA QUIMERA DEL ORO',
    );
    expect(stripSearchNoise('PELÍCULA SORPRESA EN 35 MM')).toBe('PELÍCULA SORPRESA');
    expect(stripSearchNoise('Metropolis (versión restaurada)')).toBe('Metropolis');
  });

  it('leaves a clean title unchanged', () => {
    expect(stripSearchNoise('El Jockey')).toBe('El Jockey');
    expect(stripSearchNoise('Blade Runner')).toBe('Blade Runner');
  });

  it('never returns an empty string', () => {
    expect(stripSearchNoise('estreno')).toBe('estreno');
    expect(stripSearchNoise('(2007)')).toBe('(2007)');
  });

  it('strips a trailing ALL-CAPS festival/cycle tag joined by a dash', () => {
    // Venues append the competition label to every film in a cycle; TMDB has
    // the film but not the tagged form, so search returns zero candidates.
    expect(stripSearchNoise('Tierra que habla - 8° FINCA')).toBe('Tierra que habla');
    expect(stripSearchNoise('TODO PARECÍA POSIBLE - DOC BSAS')).toBe(
      'TODO PARECÍA POSIBLE',
    );
    expect(stripSearchNoise('La vida fracturada - 8° FINCA')).toBe('La vida fracturada');
    // Double-space before the dash (VLM/scrape artifact) still collapses.
    expect(stripSearchNoise('Amora  Mora - 8° FINCA')).toBe('Amora Mora');
  });

  it('does NOT strip a mixed-case subtitle after a dash', () => {
    // The uppercase-only tail class means a real lowercase subtitle can never
    // reach the anchor, so a legitimate " - Subtitle" survives untouched.
    expect(
      stripSearchNoise('Algo ha cambiado - Un viaje quijotesco al Pappo’s blues'),
    ).toBe('Algo ha cambiado - Un viaje quijotesco al Pappo’s blues');
  });

  it('strips a leading festival/cycle prefix joined by a colon', () => {
    // Venues prefix every film in a programme with the cycle name; TMDB has
    // the film but not the prefixed form. Measured on prod 2026-09-01
    // (Centro Cultural Borges FESTIVAL ESCENARIO, Cine York CONVOCATORIA).
    expect(stripSearchNoise('FESTIVAL ESCENARIO: WE ARE THE SHAGS')).toBe(
      'WE ARE THE SHAGS',
    );
    expect(stripSearchNoise('FESTIVAL ESCENARIO: THE BEST SUMMER')).toBe(
      'THE BEST SUMMER',
    );
    expect(stripSearchNoise('CONVOCATORIA DE CORTOS: PROGRAMA I')).toBe('PROGRAMA I');
  });

  it('does NOT strip a colon that is part of a real title', () => {
    // The prefix must OPEN with a known cycle keyword; a normal title that
    // merely contains a colon is left untouched so its search stays intact.
    expect(stripSearchNoise('Kill Bill: Volume 1')).toBe('Kill Bill: Volume 1');
    expect(stripSearchNoise('Blade Runner 2049')).toBe('Blade Runner 2049');
  });
});

describe('stripDiacritics', () => {
  it('returns empty string unchanged', () => {
    expect(stripDiacritics('')).toBe('');
  });

  it('passes plain ASCII through unchanged', () => {
    expect(stripDiacritics('Jim Jarmusch')).toBe('Jim Jarmusch');
  });

  it('strips NFD-decomposable accents (é → e, ó → o, etc.)', () => {
    expect(stripDiacritics('José Martínez Suárez')).toBe('Jose Martinez Suarez');
    expect(stripDiacritics('Pedro Almodóvar')).toBe('Pedro Almodovar');
  });

  it('maps Polish letters NFD does NOT decompose (ł → l, Ł → L)', () => {
    // Andrzej Żuławski: Ż decomposes via NFD, but ł is precomposed and only
    // survives via the explicit map. The whole name must end up ASCII for
    // directorsMatch's tier-1 exact comparison to fire against TMDB.
    expect(stripDiacritics('Andrzej Żuławski')).toBe('Andrzej Zulawski');
    expect(stripDiacritics('Łukasz')).toBe('Lukasz');
  });

  it('maps other precomposed Latin letters (ø, đ, ı, ß, æ)', () => {
    // Per-letter spot-checks; the map is small and audit-able.
    expect(stripDiacritics('Lars von Trier — Antichrist (Ø)')).toContain('O');
    expect(stripDiacritics('đ')).toBe('d');
    expect(stripDiacritics('İstanbul')).toBe('Istanbul');
    expect(stripDiacritics('Straße')).toBe('Strasse');
    expect(stripDiacritics('Æthelred')).toBe('AEthelred');
  });

  it('preserves case (does not lowercase)', () => {
    // stripDiacritics is the lower-level helper; normalize() adds lowercase
    // on top. Keep them separable so directorsMatch (which lowercases
    // explicitly) doesn't double-touch.
    expect(stripDiacritics('Żuławski')).toBe('Zulawski');
    expect(stripDiacritics('ŻULAWSKI')).toBe('ZULAWSKI');
  });
});

// ---------------------------------------------------------------------------
// jaroWinkler regression — the normalize() refactor (now delegating to
// stripDiacritics) must not change scores for existing accent-only cases.
// ---------------------------------------------------------------------------
describe('jaroWinkler — diacritic normalization regression', () => {
  it('case-insensitive identity scores 1.0', () => {
    expect(jaroWinkler('La Máscara', 'la mascara')).toBe(1);
  });

  it('Polish ł case now matches identically (was 1 char short of identity)', () => {
    // Before the extended-Latin map landed, jaroWinkler('Łódź', 'Lodz')
    // would score below 1 because ł survived normalize(). Locking the new
    // behavior down — both strings reduce to "lodz".
    expect(jaroWinkler('Łódź', 'Lodz')).toBe(1);
  });

  it('unrelated strings score near 0', () => {
    expect(jaroWinkler('Lawrence of Arabia', 'Star Wars')).toBeLessThan(0.6);
  });
});

// ---------------------------------------------------------------------------
// levenshteinAtMostOne — predicate that returns true iff a and b are
// within distance 1 (0 or 1 edits). Two-pointer walk, no DP matrix.
// ---------------------------------------------------------------------------
describe('levenshteinAtMostOne', () => {
  it('identical strings → true (distance 0)', () => {
    expect(levenshteinAtMostOne('Pudovkin', 'Pudovkin')).toBe(true);
  });

  it('single substitution → true (the Vsevolov/Vsevolod case)', () => {
    expect(levenshteinAtMostOne('Vsevolov Pudovkin', 'Vsevolod Pudovkin')).toBe(true);
  });

  it('single insertion → true', () => {
    expect(levenshteinAtMostOne('Pudovkin', 'Pudovkins')).toBe(true);
  });

  it('single deletion → true', () => {
    expect(levenshteinAtMostOne('Pudovkins', 'Pudovkin')).toBe(true);
  });

  it('two-char mismatch → false (early termination on second edit)', () => {
    expect(levenshteinAtMostOne('Pudovkin', 'Pudoxkim')).toBe(false);
  });

  it('length difference > 1 → false (early reject without scan)', () => {
    expect(levenshteinAtMostOne('Lee', 'Leeward')).toBe(false);
  });

  it('empty + 1-char → true (single insertion)', () => {
    expect(levenshteinAtMostOne('', 'a')).toBe(true);
  });

  it('both empty → true (distance 0)', () => {
    expect(levenshteinAtMostOne('', '')).toBe(true);
  });
});
