import { describe, it, expect } from 'vitest';
import { suggestContainerPatterns, uncoveredTitles } from './container-suggest';
import { isNonFilmContainer } from '@/tmdb/container';

// The suggestion content is tested against FIXED fake predicates, never the
// live classifier: once Actor 2 lands a fix, the live classifier catches these
// titles, which would silently empty the suggestion and make the test lie.
const NONE_CAUGHT = () => false;

describe('suggestContainerPatterns', () => {
  it('suggests FESTIVAL and SORPRESA for the issue #58 title shapes', () => {
    const s = suggestContainerPatterns(
      ['FESTIVAL INTERNACIONAL DE ANIMACIÓN DE URUGUAY', '¡Película sorpresa!'],
      NONE_CAUGHT,
    );
    expect(s.map((x) => x.keyword)).toEqual(['FESTIVAL', 'SORPRESA']);
    expect(s[0].regexSource).toBe('\\bFESTIVAL\\b');
  });

  it('skips a title the caught-predicate already covers', () => {
    const caughtEverything = () => true;
    expect(suggestContainerPatterns(['FESTIVAL X'], caughtEverything)).toEqual([]);
  });

  it('dedups and returns keywords in priority order', () => {
    const s = suggestContainerPatterns(
      ['CORTOS del sur', 'FESTIVAL A', 'FESTIVAL B'],
      NONE_CAUGHT,
    );
    expect(s.map((x) => x.keyword)).toEqual(['FESTIVAL', 'CORTOS']);
  });

  it('reads the noise-stripped title the classifier sees, not the festival prefix (#64)', () => {
    // isNonFilmContainer strips "FESTIVAL X:" before matching, so a FESTIVAL
    // skip word can never fire on these. The keyword must come from what is left.
    const titles = [
      'FESTIVAL BITBANG: Retrospectiva Alberto Vázquez',
      'FESTIVAL BITBANG: LA HUELLA DE ORO (PROYECCIÓN + Q&A)',
      'CICLO CUADRO A CUADRO. LA OTRA FORMA',
    ];
    expect(suggestContainerPatterns(titles, NONE_CAUGHT).map((x) => x.keyword)).toEqual([
      'RETROSPECTIVA',
      'CICLO',
    ]);
    expect(uncoveredTitles(titles, NONE_CAUGHT)).toEqual([
      'FESTIVAL BITBANG: LA HUELLA DE ORO (PROYECCIÓN + Q&A)',
    ]);
  });

  it('reports titles no keyword covers as uncovered', () => {
    expect(uncoveredTitles(['FESTIVAL A', 'Just A Normal Film'], NONE_CAUGHT)).toEqual([
      'Just A Normal Film',
    ]);
  });

  it('integration: a title the live classifier already catches yields no suggestion', () => {
    // Uses stable CONVOCATORIA/CORTOS/PROGRAMA patterns, not the ones Actor 2 adds.
    expect(
      suggestContainerPatterns(
        ['CONVOCATORIA DE CORTOS: PROGRAMA I'],
        isNonFilmContainer,
      ),
    ).toEqual([]);
  });
});
