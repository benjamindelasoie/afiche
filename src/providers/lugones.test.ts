/**
 * Tests for the Sala Leopoldo Lugones provider.
 *
 * Fixtures were captured 2026-10-22 from the redesigned complejoteatral.gob.ar
 * (homepage + /produccion/<slug>/ pages), except syncro-film-fest.html and
 * tres-tardes-con-gardel.html, captured 2026-06-08 from the previous site.
 * Those two keep guarding the multi-short program-block skip; the detail
 * block markup they use is the same one the new site renders.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  extractPrograms,
  parseDetailPage,
  parseDateRange,
  matchShowtimeLine,
  type ProgramLink,
} from './lugones';
import type { ScrapedScreening } from './types';

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, '../../test/fixtures/lugones', name), 'utf8');
}

// Fixed reference "now" for fixture parses: the parser's year inference keys
// off `now`, so without a fixed anchor these tests would silently mis-date to
// the following year once wall-clock time passes ~30 days after each
// program's start. October 1 2026 sits before every new fixture's start.
const FIXED_NOW = new Date(Date.UTC(2026, 9, 1));

function program(slug: string, title: string, dateRangeText = ''): ProgramLink {
  return {
    slug,
    title,
    dateRangeText,
    detailUrl: `https://complejoteatral.gob.ar/produccion/${slug}/`,
  };
}

/** "MM-DD HH:MM Title" in BA local time (UTC-3, no DST), sorted. */
function baSchedule(screenings: ScrapedScreening[]): string[] {
  return screenings
    .map((s) => {
      const ba = new Date(s.startsAtUtc.getTime() - 3 * 3600 * 1000);
      const p = (n: number) => String(n).padStart(2, '0');
      return `${p(ba.getUTCMonth() + 1)}-${p(ba.getUTCDate())} ${p(ba.getUTCHours())}:${p(ba.getUTCMinutes())} ${s.filmTitle}`;
    })
    .sort();
}

describe('extractPrograms (homepage fixture)', () => {
  const { programs, cardCount } = extractPrograms(fixture('home.html'));

  it('keeps only cine productions at Sala Lugones', () => {
    expect(cardCount).toBe(30);
    expect(programs.map((p) => p.slug)).toEqual([
      'seis-tardes-con-mae-west',
      'en-las-rutas-de-wim-wenders',
      'frank-borzage-un-romantico-en-hollywood-parte-2',
      'las-furias-y-lo-que-le-paso-a-reynoso',
      'shohei-imamura-bis',
      'el-joven-frankenstein',
      'museo-de-la-subversion',
      'herzog-kinski-enemigo-mio',
    ]);
  });

  it('drops theatre, dance and exhibitions in other salas', () => {
    const slugs = programs.map((p) => p.slug);
    // Theatre in Sala Cunill Cabanellas, dance in Sala Martín Coronado, an
    // exhibition in the Teatro San Martín building.
    expect(slugs).not.toContain('oxitocina');
    expect(slugs).not.toContain('paraiso-perdido');
    expect(slugs).not.toContain('jorge-lavelli-el-gesto-inconformista');
  });

  it('drops a non-cine production even when it is in Sala Lugones', () => {
    const card = (genre: string, slug: string) => `
      <div class="list-item list-item-programacion">
        <span class="category">${genre}</span><h2>${slug}</h2>
        <span class="date">Lunes 2 de noviembre</span>
        <span class="place">Sala Leopoldo Lugones / Teatro San Martín</span>
        <a href="https://complejoteatral.gob.ar/produccion/${slug}/">+ info</a>
      </div>`;
    const html = card('actividades especiales', 'charla') + card('cine', 'film');
    expect(extractPrograms(html).programs.map((p) => p.slug)).toEqual(['film']);
  });

  it('carries title, date range and absolute detail URL from the card', () => {
    expect(programs[2]).toEqual({
      slug: 'frank-borzage-un-romantico-en-hollywood-parte-2',
      title: 'Frank Borzage, un romántico en Hollywood – Parte 2',
      dateRangeText: 'Del 23 de octubre al 6 de noviembre',
      detailUrl:
        'https://complejoteatral.gob.ar/produccion/frank-borzage-un-romantico-en-hollywood-parte-2/',
    });
  });
});

describe('parseDateRange', () => {
  it('anchors on the START month when the range spans two months', () => {
    // The original Karloff regression: anchoring on the end month dated a
    // whole cycle a month late.
    expect(parseDateRange('Del 23 de octubre al 6 de noviembre', FIXED_NOW)).toEqual({
      startMonth: 9,
      startYear: 2026,
    });
  });

  it('anchors on the shared month of a same-month range', () => {
    expect(parseDateRange('Del 12 al 25 de noviembre', FIXED_NOW)).toMatchObject({
      startMonth: 10,
    });
  });

  it('accepts a weekday inside "A partir del"', () => {
    expect(parseDateRange('A partir del sábado 31 de octubre', FIXED_NOW)).toMatchObject({
      startMonth: 9,
    });
    expect(parseDateRange('A partir del 5 de noviembre', FIXED_NOW)).toMatchObject({
      startMonth: 10,
    });
  });

  it('anchors a single-day one-off with inline times', () => {
    expect(
      parseDateRange('Jueves 29 de octubre, 16.30 y 20.30 horas', FIXED_NOW),
    ).toMatchObject({ startMonth: 9 });
  });

  it('rolls to next year when the start is well in the past', () => {
    expect(parseDateRange('Del 5 al 9 de enero', FIXED_NOW)).toEqual({
      startMonth: 0,
      startYear: 2027,
    });
  });

  it('returns null for unparseable text', () => {
    expect(parseDateRange('Marzo a noviembre')).toBeNull();
    expect(parseDateRange('próximamente')).toBeNull();
  });
});

describe('matchShowtimeLine', () => {
  it('splits a comma + "y" day list sharing one time', () => {
    expect(matchShowtimeLine('Jueves 5, viernes 6 y sábado 7, 21 horas')).toEqual({
      days: [{ day: 5 }, { day: 6 }, { day: 7 }],
      times: [{ hour: 21, minute: 0 }],
    });
  });

  it('reads a per-day month, including "1°"', () => {
    expect(matchShowtimeLine('Domingo 1° de noviembre, 18 horas')).toEqual({
      days: [{ day: 1, month: 10 }],
      times: [{ hour: 18, minute: 0 }],
    });
  });

  it('back-fills a trailing month onto earlier days ("a las" form)', () => {
    expect(matchShowtimeLine('Jueves 28 y viernes 29 de mayo a las 21 horas')).toEqual({
      days: [
        { day: 28, month: 4 },
        { day: 29, month: 4 },
      ],
      times: [{ hour: 21, minute: 0 }],
    });
  });

  it('parses dotted minutes and several times', () => {
    expect(matchShowtimeLine('Martes 12, 20.30 y 22 horas')).toEqual({
      days: [{ day: 12 }],
      times: [
        { hour: 20, minute: 30 },
        { hour: 22, minute: 0 },
      ],
    });
  });

  it('returns null for non-showtimes and unknown months', () => {
    expect(matchShowtimeLine('A las 20 horas')).toBeNull();
    expect(matchShowtimeLine('Dirección: Mel Brooks.')).toBeNull();
    expect(matchShowtimeLine('Sábado 30 de mesnoexistente, 18 horas')).toBeNull();
  });
});

describe('parseDetailPage — cycle, one <p> per line (Wim Wenders fixture)', () => {
  const p = program('en-las-rutas-de-wim-wenders', 'En las rutas de Wim Wenders');
  const screenings = parseDetailPage(fixture('wenders.html'), p, [], FIXED_NOW);

  it('emits every function of the cycle at its BA-local time, no warnings', () => {
    const warnings: string[] = [];
    parseDetailPage(fixture('wenders.html'), p, warnings, FIXED_NOW);
    expect(warnings).toEqual([]);
    expect(baSchedule(screenings)).toEqual([
      '10-15 20:30 Las alas del deseo',
      '10-16 18:00 El miedo del arquero al tiro penal',
      '10-16 20:30 El amigo americano',
      '10-17 14:30 Hasta el fin del mundo (Versión del director)',
      '10-17 20:30 Paris, Texas',
      '10-18 21:00 Buena Vista Social Club',
      '10-20 18:00 Buena Vista Social Club',
      '10-20 21:00 Alicia en las ciudades',
      '10-21 17:30 El estado de las cosas',
      '10-21 21:00 El miedo del arquero al tiro penal',
      '10-22 17:00 El amigo americano',
      '10-22 20:00 En el curso del tiempo',
      '10-23 17:30 Alicia en las ciudades',
      '10-23 21:00 Tokyo-Ga',
      '10-24 17:00 Las alas del deseo',
      '10-24 20:00 En el curso del tiempo',
      '10-25 15:00 Tokyo-Ga',
      '10-25 17:30 Paris, Texas',
      '10-25 21:00 El estado de las cosas',
      '10-30 18:00 Hasta el fin del mundo (Versión del director)',
    ]);
  });

  it('converts BA-local to UTC (+3h), rolling late shows into the next UTC day', () => {
    const alas = screenings.find((s) => s.filmTitle === 'Las alas del deseo')!;
    expect(alas.startsAtUtc.toISOString()).toBe('2026-10-15T23:30:00.000Z');
    const bvsc = screenings.find((s) => s.filmTitle === 'Buena Vista Social Club')!;
    expect(bvsc.startsAtUtc.toISOString()).toBe('2026-10-19T00:00:00.000Z');
  });

  it('extracts original title, country, year, director and runtime', () => {
    const alas = screenings.find((s) => s.filmTitle === 'Las alas del deseo')!;
    expect(alas).toMatchObject({
      cinemaId: 'lugones',
      filmTitleOriginal: 'Der Himmel über Berlin',
      country: 'República Federal de Alemania/Reino Unido/Francia',
      year: 1987,
      director: 'Wim Wenders',
      runtimeMin: 127,
      programName: 'En las rutas de Wim Wenders',
      sourceUrl: 'https://complejoteatral.gob.ar/produccion/en-las-rutas-de-wim-wenders/',
      tags: ['cycle'],
    });
    expect(alas.synopsisEs).toMatch(/^Dos ángeles sobrevuelan Berlín/);
  });

  it('reads country + year when there is no original title', () => {
    const paris = screenings.find((s) => s.filmTitle === 'Paris, Texas')!;
    expect(paris.filmTitleOriginal).toBeUndefined();
    expect(paris.year).toBe(1984);
    expect(paris.runtimeMin).toBe(148);
  });

  it('does not take a screening note as the synopsis', () => {
    const alicia = screenings.filter((s) => s.filmTitle === 'Alicia en las ciudades');
    // The second listing has only "Al término de la proyección…" prose.
    expect(alicia[1].synopsisEs).toBeUndefined();
  });
});

describe('parseDetailPage — cycle, <br>-joined film blocks (Borzage fixture)', () => {
  const p = program(
    'frank-borzage-un-romantico-en-hollywood-parte-2',
    'Frank Borzage, un romántico en Hollywood – Parte 2',
    'Del 23 de octubre al 6 de noviembre',
  );
  const screenings = parseDetailPage(fixture('borzage-parte-2.html'), p, [], FIXED_NOW);

  it('emits all 18 functions across the October → November boundary', () => {
    expect(baSchedule(screenings)).toEqual([
      '10-23 15:00 El ángel de la calle',
      '10-24 14:30 Una chica mala',
      '10-28 15:00 Fueros humanos',
      '10-29 14:00 La hora fatal',
      '10-30 15:00 Siempre te he querido',
      '10-31 15:00 El ángel de la calle',
      '10-31 18:00 Fueros humanos',
      '11-01 15:00 Tigre de la China',
      '11-01 21:00 Tigre de la China',
      // Martes 3 gives this film's time AFTER its metadata ("A las 15 horas (99′; DM).").
      '11-03 15:00 Tigre de la China',
      '11-03 18:00 Siempre te he querido',
      '11-03 21:00 Fueros humanos',
      '11-04 15:00 Siempre te he querido',
      '11-04 18:00 La hora fatal',
      '11-04 21:00 Una chica mala',
      '11-05 15:00 La hora fatal',
      '11-05 18:00 El ángel de la calle',
      '11-06 18:00 Una chica mala',
    ]);
  });

  it('splits one <br>-joined <p> into title, metadata and synopsis', () => {
    const angel = screenings[0];
    expect(angel).toMatchObject({
      filmTitle: 'El ángel de la calle',
      filmTitleOriginal: 'Street Angel',
      country: 'EE.UU',
      year: 1928,
      director: 'Frank Borzage',
      runtimeMin: 102,
    });
    expect(angel.synopsisEs).toMatch(/^Angela es una humilde muchacha/);
  });

  it('reads the runtime off a trailing time marker', () => {
    const tigre = screenings.filter((s) => s.filmTitle === 'Tigre de la China');
    expect(tigre.map((s) => s.runtimeMin)).toEqual([99, 99, 99]);
  });
});

describe('parseDetailPage — single-day cycle (Shohei Imamura bis fixture)', () => {
  it("anchors on the page's own Funciones line and converts 16.30 / 20.30", () => {
    // Empty card date: the page's "Funciones: Jueves 29 de octubre, …" must
    // be enough on its own.
    const warnings: string[] = [];
    const screenings = parseDetailPage(
      fixture('imamura-bis.html'),
      program('shohei-imamura-bis', 'Shohei Imamura bis'),
      warnings,
      FIXED_NOW,
    );
    expect(warnings).toEqual([]);
    expect(screenings.map((s) => [s.filmTitle, s.startsAtUtc.toISOString()])).toEqual([
      ['El profundo deseo de los dioses', '2026-10-29T19:30:00.000Z'],
      ['La balada de Narayama', '2026-10-29T23:30:00.000Z'],
    ]);
    expect(screenings[0]).toMatchObject({
      filmTitleOriginal: 'Kamigami no fukaki yokubo',
      country: 'Japón',
      year: 1968,
      director: 'Shohei Imamura',
      runtimeMin: 173,
    });
  });
});

describe('parseDetailPage — single film', () => {
  it('reads comma-separated day lists (Museo de la subversión)', () => {
    const warnings: string[] = [];
    const screenings = parseDetailPage(
      fixture('museo-de-la-subversion.html'),
      program(
        'museo-de-la-subversion',
        'Museo de la subversión',
        'A partir del 5 de noviembre',
      ),
      warnings,
      FIXED_NOW,
    );
    expect(warnings).toEqual([]);
    expect(baSchedule(screenings)).toEqual([
      '11-05 21:00 Museo de la subversión',
      '11-06 21:00 Museo de la subversión',
      '11-07 21:00 Museo de la subversión',
      '11-08 18:00 Museo de la subversión',
      '11-12 18:00 Museo de la subversión',
      '11-13 15:00 Museo de la subversión',
      '11-17 21:00 Museo de la subversión',
    ]);
    expect(screenings[0]).toMatchObject({
      year: 2025,
      country: 'Argentina',
      runtimeMin: 70,
      director: 'Francisco D´Eufemia',
    });
    expect(screenings[0].synopsisEs).toMatch(/^Las palabras museo y subversión/);
    expect(screenings[0].synopsisEs).not.toMatch(/FICHA/);
  });

  it('reads per-line explicit months from an <h4> (El joven Frankenstein)', () => {
    const screenings = parseDetailPage(
      fixture('el-joven-frankenstein.html'),
      program('el-joven-frankenstein', 'El joven Frankenstein'),
      [],
      FIXED_NOW,
    );
    expect(baSchedule(screenings)).toEqual([
      '10-31 21:00 El joven Frankenstein',
      '11-01 18:00 El joven Frankenstein',
      '11-07 18:00 El joven Frankenstein',
      '11-08 21:00 El joven Frankenstein',
    ]);
    expect(screenings[0]).toMatchObject({
      year: 1974,
      country: 'Estados Unidos',
      runtimeMin: 106,
      director: 'Mel Brooks',
    });
  });
});

describe('parseDetailPage — sala guard (Oxitocina fixture)', () => {
  it('emits nothing for a production whose page is not at Sala Lugones', () => {
    const warnings: string[] = [];
    const screenings = parseDetailPage(
      fixture('oxitocina.html'),
      program('oxitocina', 'OXITOCINA', 'Desde el 17/10 hasta el 1°/11'),
      warnings,
      FIXED_NOW,
    );
    expect(screenings).toEqual([]);
    expect(warnings.some((w) => /not at Sala Lugones/.test(w))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Multi-short program blocks (previous-site fixtures, same detail markup)
// ---------------------------------------------------------------------------
const JUNE_NOW = new Date(Date.UTC(2026, 3, 1));

describe('parseDetailPage festival-of-shorts guard (Syncro Film Fest fixture)', () => {
  // Syncro Film Fest groups short films into timed "program" blocks marked by
  // "Duración total del programa". Emitting them produced garbage "films"
  // titled by the program names, so they are skipped with a warning.
  const p = program('Syncro-Film-Fest', 'Syncro Film Fest', 'Del 25 al 29 de junio');

  it('emits 0 screenings and a multi-short warning', () => {
    const warnings: string[] = [];
    const screenings = parseDetailPage(
      fixture('syncro-film-fest.html'),
      p,
      warnings,
      JUNE_NOW,
    );
    expect(screenings).toHaveLength(0);
    expect(warnings.some((w) => /multi-short|festival/i.test(w))).toBe(true);
  });
});

describe('parseDetailPage mixed cycle + program block (Tres tardes con Gardel fixture)', () => {
  // A normal cycle with ONE double-bill day: keep the two single-film days,
  // skip only the program block.
  const p = program(
    'Tres-tardes-con-Gardel',
    'Tres tardes con Gardel',
    'Del 17 al 19 de junio',
  );

  it('keeps the 2 single-film days and warns about the skipped block', () => {
    const warnings: string[] = [];
    const screenings = parseDetailPage(
      fixture('tres-tardes-con-gardel.html'),
      p,
      warnings,
      JUNE_NOW,
    );
    expect(baSchedule(screenings).map((l) => l.slice(12))).toEqual([
      'El día que me quieras',
      'Tango Bar',
    ]);
    expect(warnings.some((w) => /program block/i.test(w))).toBe(true);
  });
});
