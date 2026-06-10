/**
 * Tests for the Cine Gaumont provider.
 *
 * Fixtures: test/fixtures/cine-gaumont/* — captured 2026-06-05 from the live
 * "Voy al Cine" site that backs cinegaumont.ar:
 *   - home.html              GET /                       (cartelera w/ cycles)
 *   - pelicula-867.html      GET /pelicula?filmid=867    (Las Mantis, AR/ES)
 *   - pelicula-868.html      GET /pelicula?filmid=868    (El mago del Kremlin, FR)
 *   - film-867-tree.json     GET .com.ar/films/867/tree  (one 20:30 daily)
 *   - film-868-tree.json     GET .com.ar/films/868/tree  (one 17:15, 4 days)
 *
 * When the site changes shape these fail and we refresh the fixtures.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseListing,
  parseDetail,
  parseTree,
  toScreenings,
  baLocalToUtc,
  type FilmListing,
} from './cine-gaumont';

const DIR = resolve(__dirname, '../../test/fixtures/cine-gaumont');
const text = (name: string) => readFileSync(resolve(DIR, name), 'utf8');
const json = (name: string) => JSON.parse(text(name)) as unknown;

describe('parseListing', () => {
  const films = parseListing(text('home.html'));
  const byId = new Map(films.map((f) => [f.filmId, f]));

  it('collects every card across all sections, deduped by film id', () => {
    expect(films).toHaveLength(26);
  });

  it('tags the Estrenos section as premiere, with no program name', () => {
    const f = byId.get(867)!;
    expect(f.tags).toEqual(['premiere']);
    expect(f.programName).toBeUndefined();
    expect(f.listingTitle).toBe('LAS MANTIS');
  });

  it('leaves "Películas en cartel" films untagged and program-less', () => {
    const f = byId.get(837)!;
    expect(f.tags).toEqual([]);
    expect(f.programName).toBeUndefined();
  });

  it('attaches the cycle name as programName and a cycle tag', () => {
    const f = byId.get(868)!;
    expect(f.programName).toBe('Ciclo Horizontes Cinematográficos');
    expect(f.tags).toEqual(['cycle']);
  });

  it('adds the unique tag for the "Funciones Unicas" cycle', () => {
    const f = byId.get(877)!;
    expect(f.programName).toBe('Ciclo Funciones Unicas');
    expect(f.tags).toEqual(['cycle', 'unique']);
  });

  it('skips the hero swiper (no duplicate film ids)', () => {
    const ids = films.map((f) => f.filmId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('parseDetail — Las Mantis (Spanish-language)', () => {
  const meta = parseDetail(text('pelicula-867.html'));

  it('reads the proper-case title (not the ALL-CAPS card title)', () => {
    expect(meta.title).toBe('Las Mantis');
  });

  it('parses runtime from "102 minutos." (first .year, not the rating)', () => {
    expect(meta.runtimeMin).toBe(102);
  });

  it('pulls director, country and original title from the side panel', () => {
    expect(meta.director).toBe('Didac Gimeno');
    expect(meta.country).toBe('Argentina-España');
    expect(meta.titleOriginal).toBe('Las Mantis');
  });

  it('captures the synopsis', () => {
    expect(meta.synopsisEs).toContain('Aitana');
  });
});

describe('parseDetail — El mago del Kremlin (foreign original title)', () => {
  const meta = parseDetail(text('pelicula-868.html'));

  it('keeps the venue title and the differing original title', () => {
    expect(meta.title).toBe('El mago del Kremlin');
    expect(meta.titleOriginal).toBe('Le mage du Kremlin');
  });

  it('reads director, country and runtime', () => {
    expect(meta.director).toBe('Olivier Assayas');
    expect(meta.country).toBe('Francia');
    expect(meta.runtimeMin).toBe(152);
  });
});

describe('parseTree', () => {
  it('flattens every performance across the day window', () => {
    const out = parseTree(json('film-867-tree.json'));
    expect(out).toHaveLength(6);
    expect(out[0]).toEqual({ date: '2026-06-05', time: '20:30' });
  });

  it('handles a film that skips some days', () => {
    const out = parseTree(json('film-868-tree.json'));
    expect(out).toHaveLength(4);
    expect(out.every((s) => s.time === '17:15')).toBe(true);
    expect(out.map((s) => s.date)).toEqual([
      '2026-06-06',
      '2026-06-07',
      '2026-06-08',
      '2026-06-10',
    ]);
  });

  it('returns [] for an empty or malformed tree', () => {
    expect(parseTree({})).toEqual([]);
    expect(parseTree({ days: {} })).toEqual([]);
    expect(parseTree(null)).toEqual([]);
    expect(parseTree({ days: { 'not-a-date': [] } })).toEqual([]);
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

describe('toScreenings', () => {
  const cycleListing: FilmListing = {
    filmId: 868,
    listingTitle: 'EL MAGO DEL KREMLIN',
    programName: 'Ciclo Horizontes Cinematográficos',
    tags: ['cycle'],
  };
  const cycleMeta = parseDetail(text('pelicula-868.html'));
  const cycleOut = toScreenings(
    cycleListing,
    cycleMeta,
    parseTree(json('film-868-tree.json')),
  );

  it('emits one screening per showtime, in true UTC', () => {
    expect(cycleOut).toHaveLength(4);
    expect(cycleOut[0].startsAtUtc.toISOString()).toBe('2026-06-06T20:15:00.000Z');
  });

  it('uses the proper-case detail title and surfaces the differing original', () => {
    expect(cycleOut[0].filmTitle).toBe('El mago del Kremlin');
    expect(cycleOut[0].filmTitleOriginal).toBe('Le mage du Kremlin');
  });

  it('carries the cycle program name, tags, director and back-link', () => {
    expect(cycleOut[0].programName).toBe('Ciclo Horizontes Cinematográficos');
    expect(cycleOut[0].tags).toEqual(['cycle']);
    expect(cycleOut[0].director).toBe('Olivier Assayas');
    expect(cycleOut[0].sourceUrl).toBe('https://www.cinegaumont.ar/pelicula?filmid=868');
    expect(cycleOut[0].cinemaId).toBe('cine-gaumont');
  });

  it('omits filmTitleOriginal when it equals the display title', () => {
    const listing: FilmListing = {
      filmId: 867,
      listingTitle: 'LAS MANTIS',
      tags: ['premiere'],
    };
    const meta = parseDetail(text('pelicula-867.html'));
    const out = toScreenings(listing, meta, parseTree(json('film-867-tree.json')));
    expect(out[0].filmTitleOriginal).toBeUndefined();
    expect(out[0].programName).toBeUndefined();
    expect(out[0].tags).toEqual(['premiere']);
  });
});
