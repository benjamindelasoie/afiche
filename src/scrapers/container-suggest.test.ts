import { describe, it, expect } from 'vitest';
import { suggestContainerPatterns, uncoveredTitles } from './container-suggest';
import { isNonFilmContainer } from '@/tmdb/container';

describe('suggestContainerPatterns', () => {
  const caught = (t: string) => isNonFilmContainer(t);

  it('suggests FESTIVAL and SORPRESA for the real issue #58 titles', () => {
    const s = suggestContainerPatterns(
      ['FESTIVAL INTERNACIONAL DE ANIMACIÓN DE URUGUAY', '¡Película sorpresa!'],
      caught,
    );
    expect(s.map((x) => x.keyword)).toEqual(['FESTIVAL', 'SORPRESA']);
    expect(s[0].regexSource).toBe('\\bFESTIVAL\\b');
  });

  it('skips titles the current classifier already catches', () => {
    // "CONVOCATORIA DE CORTOS: PROGRAMA I" is already a container.
    const s = suggestContainerPatterns(['CONVOCATORIA DE CORTOS: PROGRAMA I'], caught);
    expect(s).toEqual([]);
  });

  it('dedups and returns keywords in priority order', () => {
    const s = suggestContainerPatterns(
      ['CORTOS del sur', 'FESTIVAL A', 'FESTIVAL B'],
      () => false,
    );
    expect(s.map((x) => x.keyword)).toEqual(['FESTIVAL', 'CORTOS']);
  });

  it('reports titles no keyword covers as uncovered', () => {
    const titles = ['FESTIVAL A', 'Just A Normal Film'];
    expect(uncoveredTitles(titles, () => false)).toEqual(['Just A Normal Film']);
  });
});
