/**
 * Tests for FilmLinks' pure view-model. Covers all four identifier
 * combinations and both URL shapes.
 *
 * The empty case is the one worth guarding hardest: 27 of 113 live films carry
 * neither identifier today, and most of them are rows that are not films at
 * all (festival umbrella programs, "¡Película sorpresa!"). Those must render
 * nothing — not a label, not a separator, not an empty rule.
 */

import { describe, it, expect } from 'vitest';
import { buildFilmLinks } from './film-links-model';

describe('buildFilmLinks', () => {
  it('builds both links when the film carries both identifiers', () => {
    const links = buildFilmLinks('Mulholland Drive', 1018, 'tt0166924');

    expect(links).toEqual([
      {
        source: 'letterboxd',
        label: 'Letterboxd',
        href: 'https://letterboxd.com/tmdb/1018/',
        ariaLabel: 'Ver «Mulholland Drive» en Letterboxd',
      },
      {
        source: 'imdb',
        label: 'IMDb',
        href: 'https://www.imdb.com/title/tt0166924/',
        ariaLabel: 'Ver «Mulholland Drive» en IMDb',
      },
    ]);
  });

  it('builds only the Letterboxd link when there is no IMDb id', () => {
    const links = buildFilmLinks('El príncipe de Nanawa', 1063242, null);

    expect(links).toHaveLength(1);
    expect(links[0].label).toBe('Letterboxd');
    expect(links[0].href).toBe('https://letterboxd.com/tmdb/1063242/');
  });

  it('builds only the IMDb link when there is no TMDB id', () => {
    const links = buildFilmLinks('Hijo mayor', null, 'tt31852930');

    expect(links).toHaveLength(1);
    expect(links[0].label).toBe('IMDb');
    expect(links[0].href).toBe('https://www.imdb.com/title/tt31852930/');
  });

  it('returns nothing when the film carries neither identifier', () => {
    // The unmatched tail: festival umbrella programs, "¡Película sorpresa!",
    // CONVOCATORIA DE CORTOS. The row must vanish entirely, not render empty.
    expect(buildFilmLinks('¡Película sorpresa!', null, null)).toEqual([]);
  });

  it('orders Letterboxd before IMDb', () => {
    // Deliberate: Letterboxd is the cinephile register and the deeper source on
    // this catalog's long tail. Pinning the order so a refactor cannot silently
    // reverse the visual hierarchy.
    const links = buildFilmLinks('Aliens', 679, 'tt0090605');
    expect(links.map((l) => l.label)).toEqual(['Letterboxd', 'IMDb']);
  });

  it('keeps the Spanish quotation marks in the aria-label', () => {
    // DESIGN.md's voice rule: «...», not "...". Screen-reader copy is UI copy.
    const [link] = buildFilmLinks('Carretera perdida', 187, null);
    expect(link.ariaLabel).toBe('Ver «Carretera perdida» en Letterboxd');
  });

  it('handles a tmdb id of 0 as a real id, not as absent', () => {
    // Guard against a truthiness check creeping in where a null check belongs.
    // TMDB has no id 0 today, but `if (tmdbId)` would also drop it — and the
    // same slip on rating_count is what this project's design docs warn about.
    const links = buildFilmLinks('Zero', 0, null);
    expect(links).toHaveLength(1);
    expect(links[0].href).toBe('https://letterboxd.com/tmdb/0/');
  });
});
