/**
 * Tests for the Centro Cultural Borges provider.
 *
 * Fixtures: test/fixtures/centro-cultural-borges/* — captured 2026-06-05 from the
 * Angular SPA's JSON API (centroculturalborges.gob.ar/api/public):
 *   - eventos-del-mes.json        GET /eventos-del-mes      (whole month, mixed areas)
 *   - evento-detalle-426.json     GET /evento-detalle?id=426 (WESER, duracion "85")
 *   - evento-detalle-434.json     GET /evento-detalle?id=434 (TANGO FEROZ, duracion null)
 *
 * When the API shape changes these fail and we refresh the fixtures.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseEventos,
  parseDetalle,
  toScreening,
  baLocalToUtc,
  type EventoDetalleResponse,
} from './centro-cultural-borges';

const DIR = resolve(__dirname, '../../test/fixtures/centro-cultural-borges');
const json = (name: string) =>
  JSON.parse(readFileSync(resolve(DIR, name), 'utf8')) as unknown;

describe('parseEventos', () => {
  const eventos = parseEventos(json('eventos-del-mes.json'));

  it('keeps only Cine occurrences (one row per date/time)', () => {
    expect(eventos).toHaveLength(22);
  });

  it('maps title, director, date and time from the month feed', () => {
    const weser = eventos.find((e) => e.id === 426 && e.date === '2026-06-05')!;
    expect(weser.title).toBe('WESER');
    expect(weser.director).toBe('Fernando Spiner');
    expect(weser.time).toBe('19:00');
  });

  it('strips a trailing age tag from the short synopsis', () => {
    const weser = eventos.find((e) => e.id === 426)!;
    expect(weser.synopsisShort).toContain('cuarentena por COVID');
    expect(weser.synopsisShort).not.toContain('(+13)');
  });

  it('leaves director undefined for cycle-umbrella entries (no artistaDestacado)', () => {
    const cuadro = eventos.find((e) => e.title.includes('CUADRO A CUADRO'))!;
    expect(cuadro.director).toBeUndefined();
  });

  it('returns [] for a non-array payload', () => {
    expect(parseEventos(null)).toEqual([]);
    expect(parseEventos({})).toEqual([]);
  });
});

describe('parseDetalle', () => {
  it('parses the string runtime and the fuller synopsis', () => {
    const d = parseDetalle(json('evento-detalle-426.json') as EventoDetalleResponse);
    expect(d.runtimeMin).toBe(85);
    expect(d.synopsisLong).toContain('pueblo costero');
  });

  it('omits runtime when duracion is null', () => {
    const d = parseDetalle(json('evento-detalle-434.json') as EventoDetalleResponse);
    expect(d.runtimeMin).toBeUndefined();
    expect(d.synopsisLong).toBeTruthy();
  });

  it('handles a numeric duracion too', () => {
    expect(parseDetalle({ duracion: 102 }).runtimeMin).toBe(102);
    expect(parseDetalle({ duracion: 0 }).runtimeMin).toBeUndefined();
  });
});

describe('baLocalToUtc', () => {
  it('shifts BA-local (UTC-3) to true UTC by +3h', () => {
    expect(baLocalToUtc('2026-06-05', '19:00')?.toISOString()).toBe(
      '2026-06-05T22:00:00.000Z',
    );
  });

  it('rolls a late BA hour into the next UTC day', () => {
    expect(baLocalToUtc('2026-06-05', '22:30')?.toISOString()).toBe(
      '2026-06-06T01:30:00.000Z',
    );
  });

  it('returns null on garbage', () => {
    expect(baLocalToUtc('14 JUN', '19:00')).toBeNull();
    expect(baLocalToUtc('2026-06-05', '99:99')).toBeNull();
  });
});

describe('toScreening', () => {
  const eventos = parseEventos(json('eventos-del-mes.json'));
  const weser = eventos.find((e) => e.id === 426 && e.date === '2026-06-05')!;
  const detalle = parseDetalle(json('evento-detalle-426.json') as EventoDetalleResponse);

  it('builds a screening with UTC time, director, runtime and the long synopsis', () => {
    const s = toScreening(weser, detalle)!;
    expect(s.cinemaId).toBe('centro-cultural-borges');
    expect(s.filmTitle).toBe('WESER');
    expect(s.director).toBe('Fernando Spiner');
    expect(s.runtimeMin).toBe(85);
    expect(s.startsAtUtc.toISOString()).toBe('2026-06-05T22:00:00.000Z');
    expect(s.synopsisEs).toContain('pueblo costero'); // long synopsis preferred
    expect(s.sourceUrl).toBe('https://centroculturalborges.gob.ar/evento/426');
    expect(s.tags).toEqual([]);
  });

  it('falls back to the short synopsis when no detail is available', () => {
    const s = toScreening(weser)!;
    expect(s.synopsisEs).toContain('cuarentena por COVID');
    expect(s.runtimeMin).toBeUndefined();
  });

  it('returns null when the date/time is unparseable', () => {
    expect(toScreening({ id: 1, title: 'X', date: 'bad', time: '19:00' })).toBeNull();
  });
});
