import { describe, it, expect } from 'vitest';
import { classifyMiss, groupMisses, PATTERN_MIN_FILMS, type Miss } from './heal-patterns';

function miss(over: Partial<Miss> = {}): Miss {
  return { id: 1, scrapedTitle: 'A Film', scrapedYear: null, director: null, ...over };
}

describe('classifyMiss', () => {
  it('flags container/placeholder shapes (festival, cortos, surprise film)', () => {
    expect(
      classifyMiss(miss({ scrapedTitle: 'FESTIVAL INTERNACIONAL DE ANIMACIÓN' })),
    ).toBe('container-or-placeholder');
    expect(classifyMiss(miss({ scrapedTitle: 'SMOF 2026 — CORTOS GANADORES' }))).toBe(
      'container-or-placeholder',
    );
    expect(classifyMiss(miss({ scrapedTitle: '¡Película sorpresa!' }))).toBe(
      'container-or-placeholder',
    );
  });

  it('a container with a director is still a container', () => {
    expect(
      classifyMiss(miss({ scrapedTitle: 'CICLO IMAMURA', director: 'Shohei Imamura' })),
    ).toBe('container-or-placeholder');
  });

  it('a real film with a director but no candidate is a localized-title miss', () => {
    expect(
      classifyMiss(
        miss({ scrapedTitle: 'El expreso de Shangái', director: 'Josef von Sternberg' }),
      ),
    ).toBe('localized-title-miss');
  });

  it('a bare title with no director and no container shape is unfixable', () => {
    expect(classifyMiss(miss({ scrapedTitle: 'Cuatro Lagunas' }))).toBe('unfixable');
  });
});

describe('groupMisses', () => {
  it('drops causes below the film threshold and drops unfixable', () => {
    const groups = groupMisses([
      miss({ id: 1, scrapedTitle: 'FESTIVAL X' }), // container, but only 1
      miss({ id: 2, scrapedTitle: 'Bare Title' }), // unfixable
    ]);
    expect(groups).toEqual([]);
    expect(PATTERN_MIN_FILMS).toBe(2);
  });

  it('groups >= 2 container films into one ready-for-agent issue', () => {
    const groups = groupMisses([
      miss({ id: 1, scrapedTitle: 'FESTIVAL INTERNACIONAL DE ANIMACIÓN' }),
      miss({ id: 2, scrapedTitle: '¡Película sorpresa!' }),
      miss({ id: 3, scrapedTitle: 'Real Film', director: 'A Dir' }), // localized, only 1
    ]);
    expect(groups).toHaveLength(1);
    const g = groups[0];
    expect(g.cause).toBe('container-or-placeholder');
    expect(g.films).toHaveLength(2);
    expect(g.labels).toContain('matcher-pattern');
    expect(g.labels).toContain('ready-for-agent');
    expect(g.body).toContain('afiche-pattern-sig: container-or-placeholder');
    expect(g.body).toContain('- 1 — FESTIVAL INTERNACIONAL DE ANIMACIÓN');
  });

  it('groups >= 2 localized-title misses into one ready-for-human issue', () => {
    const groups = groupMisses([
      miss({
        id: 10,
        scrapedTitle: 'El expreso de Shangái',
        director: 'Josef von Sternberg',
      }),
      miss({
        id: 11,
        scrapedTitle: 'La niña que salta en el tiempo',
        director: 'Mamoru Hosoda',
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].cause).toBe('localized-title-miss');
    expect(groups[0].labels).toContain('ready-for-human');
    expect(groups[0].signature).toBe('localized-title-miss');
  });

  it('returns container groups before localized groups (stable order)', () => {
    const groups = groupMisses([
      miss({ id: 1, scrapedTitle: 'FESTIVAL A' }),
      miss({ id: 2, scrapedTitle: 'MUESTRA B' }),
      miss({ id: 3, scrapedTitle: 'Film C', director: 'X' }),
      miss({ id: 4, scrapedTitle: 'Film D', director: 'Y' }),
    ]);
    expect(groups.map((g) => g.cause)).toEqual([
      'container-or-placeholder',
      'localized-title-miss',
    ]);
  });
});
