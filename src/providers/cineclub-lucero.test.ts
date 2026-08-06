/**
 * Tests for the Cineclub Lucero provider.
 *
 * Fixtures: test/fixtures/cineclub-lucero/*.json — captured 2026-08-02 from
 * the Eventbrite organizer endpoint that backs Club Lucero's listing page:
 *   - showmore-past.json    GET /org/34315560147/showmore/?type=past&page=1
 *   - showmore-future.json  GET /org/34315560147/showmore/?type=future&page=1
 *
 * The PAST fixture is the interesting one: it's a real month of programming,
 * so it exercises the format filter, the non-feature exclusions and every
 * title shape the operator actually types. Tests pin `now` before those dates
 * so the same rows read as upcoming.
 *
 * The FUTURE fixture is deliberately kept even though it contains no films —
 * it pins the real-world case where only DJ nights are published yet, which
 * must parse to zero screenings WITHOUT looking like a failure.
 *
 * When Eventbrite changes the payload shape these tests fail and we refresh.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseEvents,
  parseEventTitle,
  nonFeatureReason,
  toUtc,
  baLocalToUtc,
  type ShowmoreResponse,
  type ApiEvent,
} from './cineclub-lucero';

function fixture(name: string): ApiEvent[] {
  const json = JSON.parse(
    readFileSync(resolve(__dirname, '../../test/fixtures/cineclub-lucero', name), 'utf8'),
  ) as ShowmoreResponse;
  return json.data?.events ?? [];
}

/** Before every screening in the past fixture, so they all read as upcoming. */
const BEFORE_ALL = new Date(Date.UTC(2026, 5, 1)); // 2026-06-01

describe('parseEventTitle', () => {
  it('uses the quoted span as the title when nothing else is left', () => {
    expect(parseEventTitle('"THE SHINING"')).toEqual({ filmTitle: 'THE SHINING' });
    expect(
      parseEventTitle('"JEANNE DIELMAN, 23 QUAI DU COMMERCE, 1080 BRUXELLES"'),
    ).toEqual({ filmTitle: 'JEANNE DIELMAN, 23 QUAI DU COMMERCE, 1080 BRUXELLES' });
  });

  it('keeps unquoted words that carry the title (franchise halves)', () => {
    // Splitting these on the colon would strip the words TMDB indexes them by.
    expect(
      parseEventTitle(
        'Mobile Suit Gundam: "Char\'s Counterattack"  Dir. Yoshiyuki Tomino',
      ),
    ).toEqual({
      filmTitle: "Mobile Suit Gundam: Char's Counterattack",
      director: 'Yoshiyuki Tomino',
    });
    expect(parseEventTitle('NIRVANNA: "The band,the show, the movie"')).toEqual({
      filmTitle: 'NIRVANNA: The band,the show, the movie',
    });
  });

  it('splits a cycle prefix only when it reads like a cycle', () => {
    expect(parseEventTitle('ESPECIAL ANIME: "YOUR NAME" (2016)')).toEqual({
      filmTitle: 'YOUR NAME',
      year: 2016,
      programName: 'ESPECIAL ANIME',
    });
    expect(
      parseEventTitle('MARATON ANTES DEL AMANECER: "ANTES DEL AMANECER" (1995)'),
    ).toEqual({
      filmTitle: 'ANTES DEL AMANECER',
      year: 1995,
      programName: 'MARATON ANTES DEL AMANECER',
    });
    expect(parseEventTitle('Ciclo OPERAS PRIMAS: SHADOWS de John Cassavets')).toEqual({
      filmTitle: 'SHADOWS',
      director: 'John Cassavets',
      programName: 'Ciclo OPERAS PRIMAS',
    });
    // Themed nights carry no keyword — the bare "X"/"POR" is the only marker.
    expect(parseEventTitle('TERROR X MUJERES: "HUESERA"')).toEqual({
      filmTitle: 'HUESERA',
      programName: 'TERROR X MUJERES',
    });
    expect(parseEventTitle('CIENCIA FICCION POR MUJERES: "THE POD GENERATION"')).toEqual({
      filmTitle: 'THE POD GENERATION',
      programName: 'CIENCIA FICCION POR MUJERES',
    });
  });

  it('splits an unknown cycle name when a quoted title follows', () => {
    // The operator invents cycle names constantly, so a keyword allowlist
    // can't keep up — the quote is the reliable signal. These four all
    // appeared within one month.
    expect(parseEventTitle('#BRINGBACK2016: "ARRIVAL"')).toEqual({
      filmTitle: 'ARRIVAL',
      programName: '#BRINGBACK2016',
    });
    expect(parseEventTitle('JOYSTICK A LA PANTALLA: "MORTAL KOMBAT"')).toEqual({
      filmTitle: 'MORTAL KOMBAT',
      programName: 'JOYSTICK A LA PANTALLA',
    });
    expect(parseEventTitle('AMORES NOVENTOSOS: "LOCO POR MARY"(1998)')).toEqual({
      filmTitle: 'LOCO POR MARY',
      year: 1998,
      programName: 'AMORES NOVENTOSOS',
    });
  });

  it('splits on the FIRST colon so a title keeps its own', () => {
    expect(
      parseEventTitle('VHS ANIMÉ PRESENTA:Dragon Ball Z: El Ataque del Dragón'),
    ).toEqual({
      filmTitle: 'Dragon Ball Z: El Ataque del Dragón',
      programName: 'VHS ANIMÉ PRESENTA',
    });
  });

  it('reads "(Director, Year)"', () => {
    expect(parseEventTitle('ERASERHEAD (David Lynch, 1977)')).toEqual({
      filmTitle: 'ERASERHEAD',
      director: 'David Lynch',
      year: 1977,
    });
    // No space after the comma, and a multi-name credit.
    expect(parseEventTitle('EL VIAJE DE CHIHIRO  (Hayao Miyazaki,2003)')).toEqual({
      filmTitle: 'EL VIAJE DE CHIHIRO',
      director: 'Hayao Miyazaki',
      year: 2003,
    });
    expect(parseEventTitle('THE MATRIX (Lana y Lilly Wachowski, 1999)')).toEqual({
      filmTitle: 'THE MATRIX',
      director: 'Lana y Lilly Wachowski',
      year: 1999,
    });
  });

  it('reads "Dir. Name" and a bare year', () => {
    expect(parseEventTitle('"SOLARIS" Dir.  ANDREI TARKOVSKY')).toEqual({
      filmTitle: 'SOLARIS',
      director: 'ANDREI TARKOVSKY',
    });
    expect(parseEventTitle('"PERSÉPOLIS" Dir. Marjane Satrapi (2007)')).toEqual({
      filmTitle: 'PERSÉPOLIS',
      director: 'Marjane Satrapi',
      year: 2007,
    });
    expect(parseEventTitle('TORSO (1973)')).toEqual({
      filmTitle: 'TORSO',
      year: 1973,
    });
  });

  it('treats lowercase "de" as a credit but uppercase "DE" as title text', () => {
    // This one distinction is what keeps PERROS DE LA CALLE intact.
    expect(parseEventTitle('PI de Darren Aronofsky (1998)')).toEqual({
      filmTitle: 'PI',
      director: 'Darren Aronofsky',
      year: 1998,
    });
    expect(parseEventTitle('PERROS DE LA CALLE')).toEqual({
      filmTitle: 'PERROS DE LA CALLE',
    });
    expect(parseEventTitle('EL VIAJE DE CHIHIRO')).toEqual({
      filmTitle: 'EL VIAJE DE CHIHIRO',
    });
  });

  it('reads an ALL-CAPS director after a dash, but not an article-y title', () => {
    expect(parseEventTitle('YOUNG FRANKESTEIN - MEL BROOKS (1974)')).toEqual({
      filmTitle: 'YOUNG FRANKESTEIN',
      director: 'MEL BROOKS',
      year: 1974,
    });
    expect(parseEventTitle('EL ECLIPSE - MICHELANGELO ANTONIONI (1962)')).toEqual({
      filmTitle: 'EL ECLIPSE',
      director: 'MICHELANGELO ANTONIONI',
      year: 1962,
    });
    // Stopwords keep a real dashed title from being eaten.
    expect(parseEventTitle('EL BUENO - EL MALO Y EL FEO')).toEqual({
      filmTitle: 'EL BUENO - EL MALO Y EL FEO',
    });
  });

  it('never reads metadata out of a quoted span', () => {
    // The dash here would otherwise look like a dash-director.
    expect(parseEventTitle('"SPIDERMAN - ACROSS THE SPIDER-VERSE"(2023)')).toEqual({
      filmTitle: 'SPIDERMAN - ACROSS THE SPIDER-VERSE',
      year: 2023,
    });
    // "76 89 23" must survive as title text, not be mistaken for a year.
    expect(parseEventTitle('"76 89 23"  EL DOCUMENTAL  - Dir. Federico Benoit')).toEqual({
      filmTitle: '76 89 23 EL DOCUMENTAL',
      director: 'Federico Benoit',
    });
  });

  it('takes a parenthetical right after a quote as the original title', () => {
    expect(
      parseEventTitle('VHS ANIME: "Battle Angel Alita" (Gunnm), de Hiroshi Fukutomi.'),
    ).toEqual({
      filmTitle: 'Battle Angel Alita',
      filmTitleOriginal: 'Gunnm',
      director: 'Hiroshi Fukutomi',
      programName: 'VHS ANIME',
    });
    // ...but an unquoted parenthetical stays part of the title.
    expect(parseEventTitle('RIÑON PELVICO (Parte Dos)')).toEqual({
      filmTitle: 'RIÑON PELVICO (Parte Dos)',
    });
  });

  it('leaves a plain title completely alone', () => {
    for (const t of ['SUSPIRIA', 'THEY LIVE', 'CLERKS', 'UNDER THE SKIN']) {
      expect(parseEventTitle(t)).toEqual({ filmTitle: t });
    }
  });
});

describe('nonFeatureReason', () => {
  it('excludes the recurring session and TV nights', () => {
    expect(nonFeatureReason('SESIONES CLUB LUCERO: EL LADO OSCURO DE OZ')).toBe(
      'DJ/visual session',
    );
    expect(nonFeatureReason('FLEABAG, EL MONÓLOGO + PILOTO DE LA SERIE')).toBe(
      'theatre monologue + TV pilot',
    );
    expect(nonFeatureReason('FLEABAG TEMPORADA 1- CAPITULOS 1 AL 3')).toBe(
      'theatre monologue + TV pilot',
    );
  });

  it('leaves features alone', () => {
    expect(nonFeatureReason('"THE SHINING"')).toBeUndefined();
    expect(nonFeatureReason('AKIRA (Katsuhiro Otomo, 1988)')).toBeUndefined();
    // "VHS ANIMÉ" is a cycle name, not a TV marker — must not be excluded.
    expect(nonFeatureReason('VHS ANIMÉ PRESENTA: SAILOR MOON')).toBeUndefined();
  });
});

/**
 * GOLDEN CORPUS — the guard rail on `parseEventTitle`.
 *
 * `filmTitle` and `year` are the immutable `(scrapedTitle, scrapedYear)` upsert
 * key in `films`, and `tmdb-overrides.json` is keyed on `scrapedTitle` too. So
 * a regex tweak that shifts an existing title doesn't just re-parse it — it
 * forks a new film row and silently un-keys any manual TMDB override written
 * against the old string. TMDB's merge pass rescues the common case, but not
 * the films that needed the manual help in the first place.
 *
 * This pins every distinct screening title the organizer has published, so any
 * such shift fails here with a readable before/after instead of landing quietly
 * in prod. When a change IS intended: update the fixture in the same commit,
 * re-key affected entries in `tmdb-overrides.json`, and UPDATE the existing
 * `films.scraped_title` rather than letting a duplicate row appear.
 *
 * Fixture: test/fixtures/cineclub-lucero/title-corpus.json — 82 distinct
 * titles captured 2026-08-04 from the full `type=past` history.
 */
describe('parseEventTitle — golden corpus', () => {
  const { entries } = JSON.parse(
    readFileSync(
      resolve(__dirname, '../../test/fixtures/cineclub-lucero/title-corpus.json'),
      'utf8',
    ),
  ) as {
    entries: Array<{
      raw: string;
      excluded?: string;
      parsed?: ReturnType<typeof parseEventTitle>;
    }>;
  };

  it('covers the whole published history', () => {
    expect(entries.length).toBe(82);
    expect(new Set(entries.map((e) => e.raw)).size).toBe(entries.length);
  });

  for (const entry of entries) {
    if (entry.excluded) {
      it(`excludes ${entry.raw}`, () => {
        expect(nonFeatureReason(entry.raw)).toBe(entry.excluded);
      });
    } else {
      it(`parses ${entry.raw}`, () => {
        expect(nonFeatureReason(entry.raw)).toBeUndefined();
        expect(parseEventTitle(entry.raw)).toEqual(entry.parsed);
      });
    }
  }

  it('never yields an empty or whitespace-only title', () => {
    for (const e of entries) {
      if (e.excluded) continue;
      expect(e.parsed!.filmTitle.trim().length).toBeGreaterThan(0);
    }
  });

  it('collapses a cycle-prefixed film onto the same key as its bare listing', () => {
    // COSMOS: "INTERSTELLAR" and "INTERSTELLAR" are the same film. If the
    // prefix survived into filmTitle they would be two rows in `films`.
    const cosmos = parseEventTitle('COSMOS: "INTERSTELLAR" (2014)');
    const bare = parseEventTitle('"INTERSTELLAR" (2014)');
    expect(cosmos.filmTitle).toBe(bare.filmTitle);
    expect(cosmos.year).toBe(bare.year);
    expect(cosmos.programName).toBe('COSMOS');
  });
});

describe('toUtc', () => {
  it('prefers the UTC instant Eventbrite already provides', () => {
    expect(
      toUtc({ utc: '2026-07-31T00:00:00Z', local: '2026-07-30T21:00:00' })?.toISOString(),
    ).toBe('2026-07-31T00:00:00.000Z');
  });

  it('falls back to shifting the BA wall-clock by +3h', () => {
    expect(toUtc({ local: '2026-07-30T21:00:00' })?.toISOString()).toBe(
      '2026-07-31T00:00:00.000Z',
    );
    expect(baLocalToUtc('2026-07-30T19:00:00')?.toISOString()).toBe(
      '2026-07-30T22:00:00.000Z',
    );
    expect(baLocalToUtc(undefined)).toBeNull();
    expect(baLocalToUtc('nope')).toBeNull();
  });
});

describe('parseEvents (real fixture)', () => {
  const events = fixture('showmore-past.json');
  const screenings = parseEvents(events, BEFORE_ALL);

  it('keeps only feature screenings out of a real month of programming', () => {
    // 30 events in, 12 features out: DJ nights and the impro course are
    // dropped by format_id, FLEABAG and SESIONES by the non-feature filter.
    expect(events.length).toBe(30);
    expect(screenings).toHaveLength(12);

    const titles = screenings.map((s) => s.filmTitle);
    expect(titles).toContain('JEANNE DIELMAN, 23 QUAI DU COMMERCE, 1080 BRUXELLES');
    expect(titles).toContain('SOLARIS');
    expect(titles.some((t) => /FLEABAG/i.test(t))).toBe(false);
    expect(titles.some((t) => /SESIONES/i.test(t))).toBe(false);
    expect(titles.some((t) => /^DJ /i.test(t))).toBe(false);
  });

  it('emits UTC instants matching the BA wall-clock', () => {
    const jeanne = screenings.find((s) => s.filmTitle.startsWith('JEANNE DIELMAN'));
    // Eventbrite local 2026-07-30 21:00 in Buenos Aires (UTC-3).
    expect(jeanne?.startsAtUtc.toISOString()).toBe('2026-07-31T00:00:00.000Z');

    for (const s of screenings) {
      expect(s.startsAtUtc.getTime()).toBeGreaterThan(BEFORE_ALL.getTime());
    }
  });

  it('carries cinemaId, a per-event sourceUrl and cycle tags', () => {
    for (const s of screenings) {
      expect(s.cinemaId).toBe('cineclub-lucero');
      expect(s.sourceUrl).toMatch(/^https:\/\/www\.eventbrite\.com(\.ar)?\/e\//);
      expect(s.tags).toEqual(s.programName ? ['cycle'] : []);
    }

    const maraton = screenings.filter(
      (s) => s.programName === 'MARATON ANTES DEL AMANECER',
    );
    expect(maraton).toHaveLength(3);
    expect(maraton.map((s) => s.year).sort()).toEqual([1995, 2004, 2013]);
  });

  it('drops events that already started', () => {
    // Same fixture, clock moved past most of it.
    const late = parseEvents(events, new Date(Date.UTC(2026, 6, 20)));
    expect(late.length).toBeLessThan(screenings.length);
    for (const s of late) {
      expect(s.startsAtUtc.getTime()).toBeGreaterThan(Date.UTC(2026, 6, 20));
    }
  });
});

describe('parseEvents (future fixture with no films published yet)', () => {
  it('returns zero screenings without treating it as an error', () => {
    const events = fixture('showmore-future.json');
    expect(events.length).toBeGreaterThan(0); // DJ nights, impro course
    expect(parseEvents(events, BEFORE_ALL)).toEqual([]);
  });
});
