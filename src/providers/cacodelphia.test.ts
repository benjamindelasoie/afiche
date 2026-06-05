/**
 * Tests for the CineArte Cacodelphia provider.
 *
 * Fixtures: test/fixtures/cacodelphia/*.json — captured 2026-06-05 from the
 * adro.studio JSON API (apiv2.gaf.adro.studio) that backs the site's SPA:
 *   - nowPlaying.json            GET /nowPlaying/86
 *   - movie-backrooms.json       GET /movie/86/<pref>  (estreno, subtitulada)
 *   - movie-encuentro-coleman.json                     (no estreno, castellano)
 *
 * When adro.studio changes the API shape these tests fail and we refresh the
 * fixtures.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseMovie, baWallClockToUtc, type MovieResponse } from './cacodelphia';

function fixture(name: string): MovieResponse {
  return JSON.parse(
    readFileSync(resolve(__dirname, '../../test/fixtures/cacodelphia', name), 'utf8'),
  ) as MovieResponse;
}

describe('baWallClockToUtc', () => {
  it('reads the BA wall-clock (the API mislabels it UTC) and shifts +3h', () => {
    // The site renders this showtime as 21:00 on Sat 06; true UTC is +3h.
    expect(baWallClockToUtc('2026-06-06 21:00:00.000000')?.toISOString()).toBe(
      '2026-06-07T00:00:00.000Z',
    );
  });

  it('rolls a late BA hour into the next UTC day', () => {
    expect(baWallClockToUtc('2026-06-05 21:10:00.000000')?.toISOString()).toBe(
      '2026-06-06T00:10:00.000Z',
    );
  });

  it('returns null on garbage or missing input', () => {
    expect(baWallClockToUtc('not-a-date')).toBeNull();
    expect(baWallClockToUtc(undefined)).toBeNull();
  });
});

describe('parseMovie — BACKROOMS (estreno, subtitulada)', () => {
  const out = parseMovie(fixture('movie-backrooms.json'), {
    pref: 'c7d256b88ddc967cdb84ffac22bc76b2',
    nombre: 'BACKROOMS',
    release: 1,
  });

  it('emits one screening per showtime', () => {
    expect(out).toHaveLength(4);
  });

  it('preserves the all-caps title verbatim (displayFilmTitle title-cases at render)', () => {
    expect(out[0].filmTitle).toBe('BACKROOMS');
  });

  it('converts the BA wall-clock to true UTC (+3h)', () => {
    expect(out[0].startsAtUtc.toISOString()).toBe('2026-06-07T00:00:00.000Z');
  });

  it('tags premiere (release=1) and no language tag (VOS is universal-noise here)', () => {
    expect(out[0].tags).toEqual(['premiere']);
  });

  it('carries runtime and synopsis from the movie record', () => {
    expect(out[0].runtimeMin).toBe(111);
    expect(out[0].synopsisEs).toContain('leyenda urbana');
  });

  it('points sourceUrl at the film detail page', () => {
    expect(out[0].sourceUrl).toBe(
      'https://cineartecacodelphia.com.ar/pelicula/86/c7d256b88ddc967cdb84ffac22bc76b2',
    );
  });

  it('stamps cinemaId on every screening', () => {
    for (const s of out) expect(s.cinemaId).toBe('cacodelphia');
  });
});

describe('parseMovie — ENCUENTRO COLEMAN (no estreno, castellano)', () => {
  const out = parseMovie(fixture('movie-encuentro-coleman.json'), {
    pref: '0900264aa83b34803bd06f1e6444f551',
    nombre: 'ENCUENTRO COLEMAN',
    release: 0,
  });

  it('emits 2 screenings', () => {
    expect(out).toHaveLength(2);
  });

  it('tags nothing (release=0; no language tag)', () => {
    expect(out[0].tags).toEqual([]);
  });

  it('handles the 21:10 BA → next-UTC-day rollover', () => {
    expect(out[0].startsAtUtc.toISOString()).toBe('2026-06-06T00:10:00.000Z');
  });

  it('carries runtime 80', () => {
    expect(out[0].runtimeMin).toBe(80);
  });
});

describe('parseMovie — defensive', () => {
  it('returns [] when the response has no data', () => {
    expect(parseMovie({ status: 'ok' }, { pref: 'x', nombre: 'X' })).toEqual([]);
  });

  it('skips a hidden showtime (mostrar="0")', () => {
    const resp: MovieResponse = {
      status: 'ok',
      data: {
        movie: { nombre: 'X', Duracion: '90' },
        showtimes: [
          {
            mostrar: '0',
            lenguaje: 'Subt',
            fechaHora: { date: '2026-06-06 20:00:00.000000' },
          },
        ],
      },
    };
    expect(parseMovie(resp, { pref: 'x', nombre: 'X' })).toEqual([]);
  });

  it('warns and skips an unparseable showtime', () => {
    const warnings: string[] = [];
    const resp: MovieResponse = {
      status: 'ok',
      data: {
        movie: { nombre: 'X' },
        showtimes: [{ lenguaje: 'Subt', fechaHora: { date: 'broken' } }],
      },
    };
    expect(parseMovie(resp, { pref: 'x', nombre: 'X' }, warnings)).toEqual([]);
    expect(warnings[0]).toContain('unparseable');
  });
});
