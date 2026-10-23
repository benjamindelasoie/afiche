/**
 * Tests for the Cine Gaumont provider.
 *
 * Fixtures: test/fixtures/cine-gaumont/* — captured 2026-10-22 from the Cinexo
 * API that backs cinegaumont.ar:
 *   - funciones-2026-10-23.json  GET PeliculasConFuncionesYHorarios
 *                                ?idComplejo=372001&fecha=23/10/2026
 *                                (19 films, 14 showtimes)
 *   - funciones-2026-10-27.json  same, fecha=27/10/2026 (12 showtimes,
 *                                incl. the 27/10 release of 6371)
 *
 * When the site changes shape these fail and we refresh the fixtures.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseDay,
  baDateWindow,
  baLocalToUtc,
  normalizeTitle,
  normalizeDirector,
} from './cine-gaumont';

const DIR = resolve(__dirname, '../../test/fixtures/cine-gaumont');
const json = (name: string) =>
  JSON.parse(readFileSync(resolve(DIR, name), 'utf8')) as unknown;

describe('parseDay — 2026-10-23', () => {
  const day = parseDay(json('funciones-2026-10-23.json'), '2026-10-23');
  const byTitle = (t: string) => day.screenings.filter((s) => s.filmTitle === t);

  it('emits one screening per showtime and counts the cartelera', () => {
    expect(day.screenings).toHaveLength(14);
    expect(day.filmCount).toBe(19);
    expect(day.warnings).toEqual([]);
  });

  it('joins showtimes to film metadata and converts BA-local to UTC', () => {
    const lo = byTitle('Lo dejamos aca');
    expect(lo.map((s) => s.startsAtUtc.toISOString())).toEqual([
      '2026-10-23T17:00:00.000Z', // 14:00 BA
      '2026-10-23T20:45:00.000Z', // 17:45 BA
      '2026-10-24T00:30:00.000Z', // 21:30 BA, next UTC day
    ]);
    expect(lo[0].director).toBe('Hernan Goldfrind');
    expect(lo[0].runtimeMin).toBe(98);
    expect(lo[0].synopsisEs).toContain('psicoanalista');
    expect(lo[0].cinemaId).toBe('cine-gaumont');
    expect(lo[0].sourceUrl).toBe(
      'https://www.cinegaumont.ar/es-AR/programacion/corp/372001/6344',
    );
  });

  it('sentence-cases caps titles and leaves mixed-case ones alone', () => {
    expect(byTitle('Desobediente')).toHaveLength(1);
    expect(byTitle('Yo, Narciso').length).toBeGreaterThan(0);
    expect(
      day.screenings.some((s) => /^[^a-z]*[A-Z]{3,}[^a-z]*$/.test(s.filmTitle)),
    ).toBe(false);
  });

  it('tags premiere only inside the release week', () => {
    // fecha_estreno 22/10 → day 2 of its release week.
    expect(byTitle('Susana rinaldi, libre')[0].tags).toEqual(['premiere']);
    // fecha_estreno 08/10 → long past.
    expect(byTitle('Lo dejamos aca')[0].tags).toEqual([]);
    // fecha_estreno 15/10 → day 8, just outside the week.
    expect(byTitle('Desobediente')[0].tags).toEqual([]);
  });
});

describe('parseDay — 2026-10-27', () => {
  const day = parseDay(json('funciones-2026-10-27.json'), '2026-10-27');

  it('tags a film released that very day as premiere', () => {
    const s = day.screenings.find(
      (x) => x.filmTitle === 'Adolescencia, sexo y muerte en campamento miasma',
    )!;
    expect(s.startsAtUtc.toISOString()).toBe('2026-10-28T01:00:00.000Z'); // 22:00 BA
    expect(s.tags).toEqual(['premiere']);
  });

  it('emits no program name or original title (API exposes neither)', () => {
    expect(day.screenings).toHaveLength(12);
    expect(day.screenings.every((s) => !s.programName && !s.filmTitleOriginal)).toBe(
      true,
    );
  });
});

describe('parseDay — malformed input', () => {
  it('returns nothing (and filmCount 0) for an empty or malformed body', () => {
    for (const body of [null, {}, { data: {} }, { data: { datos: 'x' } }]) {
      const out = parseDay(body, '2026-10-23');
      expect(out.screenings).toEqual([]);
      expect(out.filmCount).toBe(0);
    }
  });

  it('warns and skips showtimes for unknown films, bad times, other venues', () => {
    const out = parseDay(
      {
        data: {
          datos: [{ peliculas_codigo: '1', peliculas_nombre: 'X' }],
          funciones: [
            { codPelicula: '2', hora: '20:00' },
            { codPelicula: '1', hora: '99:99' },
            { codPelicula: '1', hora: '20:00', idUltracine: '999999' },
            { codPelicula: '1', hora: '20:00', idUltracine: '372001' },
          ],
        },
      },
      '2026-10-23',
    );
    expect(out.screenings).toHaveLength(1);
    expect(out.warnings).toHaveLength(2);
  });
});

describe('baDateWindow', () => {
  it('starts at the BA-local date, not the UTC one', () => {
    // 01:00 UTC on the 23rd is still 22:00 on the 22nd in BA.
    expect(baDateWindow(new Date('2026-10-23T01:00:00Z'), 3)).toEqual([
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
    ]);
  });

  it('rolls across a month boundary', () => {
    expect(baDateWindow(new Date('2026-10-31T15:00:00Z'), 2)).toEqual([
      '2026-10-31',
      '2026-11-01',
    ]);
  });
});

describe('baLocalToUtc', () => {
  it('shifts BA-local (UTC-3) to true UTC by +3h', () => {
    expect(baLocalToUtc('2026-06-05', '20:30')?.toISOString()).toBe(
      '2026-06-05T23:30:00.000Z',
    );
  });

  it('rolls a late BA hour into the next UTC day', () => {
    expect(baLocalToUtc('2026-06-05', '22:30')?.toISOString()).toBe(
      '2026-06-06T01:30:00.000Z',
    );
  });

  it('returns null on garbage', () => {
    expect(baLocalToUtc('nope', '20:30')).toBeNull();
    expect(baLocalToUtc('2026-06-05', '99:99')).toBeNull();
  });
});

describe('normalizeTitle / normalizeDirector', () => {
  it('cleans the API title the way the page renders it', () => {
    expect(normalizeTitle('XUL ')).toBe('Xul');
    expect(normalizeTitle('ADOLESCENCIA,SEXO Y MUERTE')).toBe(
      'Adolescencia, sexo y muerte',
    );
    expect(normalizeTitle('¿QUERES SER MI HIJO?')).toBe('¿Queres ser mi hijo?');
    expect(normalizeTitle('Pepita la pistolera')).toBe('Pepita la pistolera');
  });

  it('name-cases caps directors and keeps mixed-case ones verbatim', () => {
    expect(normalizeDirector('MARIA ISABEL MARCENARO')).toBe('Maria Isabel Marcenaro');
    expect(normalizeDirector('SANTIAGO DE LA FUENTE')).toBe('Santiago de la Fuente');
    expect(normalizeDirector(' Lucas Vivo García Lagos')).toBe('Lucas Vivo García Lagos');
    expect(normalizeDirector('Miguel de Zuviría')).toBe('Miguel de Zuviría');
    expect(normalizeDirector(undefined)).toBeUndefined();
  });
});
