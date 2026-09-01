import { describe, it, expect } from 'vitest';
import { isNonFilmContainer } from './container';

describe('isNonFilmContainer', () => {
  it('flags shorts / programme / competition containers', () => {
    expect(isNonFilmContainer('CONVOCATORIA DE CORTOS: PROGRAMA I')).toBe(true);
    expect(isNonFilmContainer('CONVOCATORIA DE CORTOS: PROGRAMA IV')).toBe(true);
    expect(isNonFilmContainer('Cortometrajes en Competencia - 8° FINCA')).toBe(true);
    expect(isNonFilmContainer('FESTIVAL ESCENARIO: PROYECCIONES DE CORTOS')).toBe(true);
    expect(isNonFilmContainer('PROGRAMA DOBLE')).toBe(true);
  });

  it('does NOT flag a real film — including one wearing a festival prefix', () => {
    expect(isNonFilmContainer('FESTIVAL ESCENARIO: WE ARE THE SHAGS')).toBe(false);
    expect(isNonFilmContainer('Kanzo Sensei – Doctor Akagi')).toBe(false);
    expect(isNonFilmContainer('El Jockey')).toBe(false);
    // "El Programa" (a real doc) must NOT trip the PROGRAMA rule — no numeral.
    expect(isNonFilmContainer('El Programa')).toBe(false);
  });
});
