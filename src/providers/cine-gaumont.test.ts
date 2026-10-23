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

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseDay,
  baDateWindow,
  baLocalToUtc,
  normalizeTitle,
  normalizeDirector,
  cineGaumontProvider,
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
    // Extended by /ship test coverage audit.
    // Value: protects=caps names are capitalised after hyphens and apostrophes too;
    // fails_when=the [-'] separator is dropped from the capitalise regex (Jean-luc,
    // O'brien); why_new=existing rows have no hyphen or apostrophe; seam=none;
    // no_claim=none beyond protects
    expect(normalizeDirector('JEAN-LUC GODARD')).toBe('Jean-Luc Godard');
    expect(normalizeDirector("DAN O'BANNON")).toBe("Dan O'Bannon");
    expect(normalizeDirector(undefined)).toBeUndefined();
  });
});

// Generated by /ship test coverage audit.
// Value: protects=fetch() fails when every day errors or the API returns no films,
// and survives one failed day; fails_when=the daysOk/filmCount guard is dropped so a
// dead or reshaped API reports success with 0 rows; why_new=only parseDay is tested;
// seam=none; no_claim=live Cinexo behaviour (fetch stubbed with the captured fixture).
describe('cineGaumontProvider.fetch — run verdicts', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function run(respond: (url: string, i: number) => Response) {
    vi.useFakeTimers({ now: new Date('2026-10-23T12:00:00Z') });
    let i = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => respond(String(input), i++)),
    );
    const pending = cineGaumontProvider.fetch();
    await vi.runAllTimersAsync();
    return pending;
  }
  const jsonResponse = (body: unknown) => new Response(JSON.stringify(body));

  it('fails when every day request errors (success=false from the API)', async () => {
    const result = await run(() =>
      jsonResponse({ success: false, message: 'complejo inexistente' }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Every day request/);
    expect(result.warnings).toHaveLength(7);
    expect(result.warnings[0]).toMatch(/complejo inexistente/);
  });

  it('fails when the API answers but lists no films (shape changed)', async () => {
    const result = await run(() =>
      jsonResponse({ success: true, data: { peliculas: [], horarios: [] } }),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no films/);
  });

  // Value: protects=films listed with no matched showtime fails the run;
  // fails_when=the screenings.length guard is dropped (a renamed `funciones`
  // reads as success with 0 rows); why_new=the no-films case keeps `datos`
  // empty too; seam=none; no_claim=which field the real API would rename.
  it('fails when films are listed but no showtime matches them', async () => {
    const day = json('funciones-2026-10-23.json') as { data: Record<string, unknown> };
    const renamed = { ...day, data: { ...day.data, funciones: undefined, horarios: [] } };
    const result = await run(() => jsonResponse(renamed));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/listed 19 films but no showtimes matched/);
  });

  /** The captured day with showtime ids made unique per request, as the real API's are. */
  const dayN = (i: number) => {
    const day = json('funciones-2026-10-23.json') as {
      data: { funciones: Array<{ _id: string }> };
    };
    return {
      ...day,
      data: {
        ...day.data,
        funciones: day.data.funciones.map((f) => ({ ...f, _id: `${f._id}-${i}` })),
      },
    };
  };

  // Value: protects=identical showtimes on two days fail the run; fails_when=
  // the repeated-ids guard is dropped (one day's schedule copied across the
  // week); why_new=no test returned the same day twice on purpose; seam=none;
  // no_claim=how the real API would ignore fecha.
  it('fails when two days return the very same showtimes (fecha ignored)', async () => {
    const day = json('funciones-2026-10-23.json');
    const result = await run(() => jsonResponse(day));
    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'Cinexo API returned the same showtimes for 2026-10-23 and 2026-10-24 — the date parameter may be ignored.',
    );
  });

  it('keeps the good days when one day fails', async () => {
    const calls: string[] = [];
    const result = await run((url, i) => {
      calls.push(url);
      return i === 2 ? new Response('boom', { status: 500 }) : jsonResponse(dayN(i));
    });
    expect(result.success).toBe(true);
    expect(result.screenings).toHaveLength(14 * 6);
    expect(result.warnings).toEqual([expect.stringMatching(/^2026-10-25: HTTP 500/)]);
    expect(calls[0]).toContain('idComplejo=372001&fecha=23/10/2026');
  });
});
