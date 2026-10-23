/**
 * Tests for the Cineclub Lucero provider.
 *
 * Fixtures: test/fixtures/cineclub-lucero/*.json — captured 2026-10-22 from
 * the two Eventbrite endpoints the provider reads:
 *   - org-events.json          GET /organizer-profile/api/organizers/34315560147/events/?page=1&pageSize=50
 *   - destination-future.json  GET /api/v3/destination/events/?event_ids=<the 23 ids above>&page_size=50
 *   - destination-past.json    same endpoint, for the 50 ids of the organizer's
 *                              past-events listing (2026-09-02 .. 2026-10-21)
 *
 * The PAST fixture is the interesting one for the filter: a real seven weeks
 * of programming, so it exercises the format filter, the non-feature
 * exclusions and the title shapes the operator actually types. Tests pin
 * `now` before those dates so the same rows read as upcoming.
 *
 * The FUTURE pair drives the whole fetch() path through a stubbed `fetch`,
 * including a festival of shorts blocks that are filed as Screenings.
 *
 * When Eventbrite changes the payload shape these tests fail and we refresh.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  cineclubLuceroProvider,
  parseEvents,
  parseEventTitle,
  nonFeatureReason,
  formatId,
  toUtc,
  baLocalToUtc,
  type DestinationResponse,
  type OrgEventsResponse,
  type ApiEvent,
} from './cineclub-lucero';

function readJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(resolve(__dirname, '../../test/fixtures/cineclub-lucero', name), 'utf8'),
  ) as T;
}

function fixture(name: string): ApiEvent[] {
  return readJson<DestinationResponse>(name).events ?? [];
}

/** Before every screening in the past fixture, so they all read as upcoming. */
const BEFORE_ALL = new Date(Date.UTC(2026, 8, 1)); // 2026-09-01

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

  it('splits the "Dir. Name · País · Año" credit into director and year', () => {
    expect(parseEventTitle('MISERY Dir. Rob Reiner · Estados Unidos · 1990')).toEqual({
      filmTitle: 'MISERY',
      director: 'Rob Reiner',
      year: 1990,
    });
    expect(
      parseEventTitle('THE HUNGER / EL ANSIA Dir. Tony Scott · 1983 · 97 min'),
    ).toEqual({
      filmTitle: 'THE HUNGER / EL ANSIA',
      director: 'Tony Scott',
      year: 1983,
    });
    expect(parseEventTitle('PET SEMATARY Dir. Mary Lambert · Estados Unidos ·')).toEqual({
      filmTitle: 'PET SEMATARY',
      director: 'Mary Lambert',
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
    expect(nonFeatureReason('FESTIVAL BITBANG! CORTOS INTERNACIONALES IV')).toBe(
      'shorts programme',
    );
  });

  it('leaves features alone', () => {
    expect(nonFeatureReason('"THE SHINING"')).toBeUndefined();
    expect(nonFeatureReason('AKIRA (Katsuhiro Otomo, 1988)')).toBeUndefined();
    // "VHS ANIMÉ" is a cycle name, not a TV marker — must not be excluded.
    expect(nonFeatureReason('VHS ANIMÉ PRESENTA: SAILOR MOON')).toBeUndefined();
    // Singular CORTO is a title word; only the plural marks a shorts block.
    expect(nonFeatureReason('CORTO MALTÉS: LA PELÍCULA')).toBeUndefined();
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
 * titles captured 2026-08-04 from the full `type=past` history, plus 12 in the
 * "Dir. X · País · Año" credit form (2026-09/10 destination fixtures).
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
    expect(entries.length).toBe(94);
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
  it('shifts the BA wall-clock by +3h', () => {
    expect(toUtc({ start_date: '2026-10-22', start_time: '21:00' })?.toISOString()).toBe(
      '2026-10-23T00:00:00.000Z',
    );
    expect(baLocalToUtc('2026-07-30T19:00:00')?.toISOString()).toBe(
      '2026-07-30T22:00:00.000Z',
    );
    expect(toUtc({ start_date: '2026-10-22' })).toBeNull();
    expect(baLocalToUtc(undefined)).toBeNull();
    expect(baLocalToUtc('nope')).toBeNull();
  });
});

describe('formatId', () => {
  it('reads the EventbriteFormat tag', () => {
    const [misery] = fixture('destination-future.json').filter((e) =>
      e.name?.startsWith('MISERY'),
    );
    expect(formatId(misery)).toBe('7');
    expect(
      formatId({ tags: [{ prefix: 'EventbriteFormat', tag: 'EventbriteFormat/6' }] }),
    ).toBe('6');
    expect(formatId({ tags: [] })).toBeUndefined();
    expect(formatId({})).toBeUndefined();
  });
});

describe('parseEvents (real past fixture)', () => {
  const events = fixture('destination-past.json');
  const screenings = parseEvents(events, BEFORE_ALL);

  it('keeps only feature screenings out of a real stretch of programming', () => {
    // 50 events in, 33 out: 14 DJ nights (formats 6 and 11) and the impro
    // course (format 9) are dropped by format, FLEABAG and SESIONES by the
    // non-feature filter.
    expect(events.length).toBe(50);
    expect(screenings).toHaveLength(33);

    const titles = screenings.map((s) => s.filmTitle);
    expect(titles).toContain('ONIBABA');
    expect(titles).toContain('DIRTY DANCING');
    expect(titles.some((t) => /FLEABAG/i.test(t))).toBe(false);
    expect(titles.some((t) => /SESIONES/i.test(t))).toBe(false);
    expect(titles.some((t) => /^DJ /i.test(t))).toBe(false);
    expect(titles.some((t) => /IMPRO/i.test(t))).toBe(false);
  });

  it('emits UTC instants matching the BA wall-clock', () => {
    const dirty = screenings.find((s) => s.filmTitle === 'DIRTY DANCING');
    // Eventbrite local 2026-09-09 23:00 in Buenos Aires (UTC-3).
    expect(dirty?.startsAtUtc.toISOString()).toBe('2026-09-10T02:00:00.000Z');

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
    const late = parseEvents(events, new Date(Date.UTC(2026, 9, 10)));
    expect(late.length).toBeLessThan(screenings.length);
    for (const s of late) {
      expect(s.startsAtUtc.getTime()).toBeGreaterThan(Date.UTC(2026, 9, 10));
    }
  });

  it('skips an event outside Argentina rather than mis-timing it', () => {
    const [onibaba] = events.filter((e) => e.name?.startsWith('ONIBABA'));
    const warnings: string[] = [];
    const out = parseEvents(
      [{ ...onibaba, timezone: 'Europe/Madrid' }],
      BEFORE_ALL,
      warnings,
    );
    expect(out).toEqual([]);
    expect(warnings[0]).toMatch(/unexpected timezone Europe\/Madrid/);
  });

  it('reads an event with no timezone as BA wall-clock', () => {
    const [onibaba] = events.filter((e) => e.name?.startsWith('ONIBABA'));
    const withZone = parseEvents([onibaba], BEFORE_ALL);
    const out = parseEvents([{ ...onibaba, timezone: undefined }], BEFORE_ALL);
    expect(out).toHaveLength(1);
    expect(out[0].startsAtUtc).toEqual(withZone[0].startsAtUtc);
  });
});

describe('fetch (stubbed network, real future fixtures)', () => {
  /** Live capture time: 2026-10-22 20:45 BA, after PET SEMATARY's 19:00 start. */
  const CAPTURED = new Date('2026-10-22T23:45:00Z');

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function stubNetwork(): string[] {
    const calls: string[] = [];
    const orgEvents = readJson<OrgEventsResponse>('org-events.json');
    const destination = readJson<DestinationResponse>('destination-future.json');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        calls.push(url);
        const json = (body: unknown) =>
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        if (url.includes('/organizer-profile/api/organizers/34315560147/events/')) {
          return json(orgEvents);
        }
        if (url.includes('/api/v3/destination/events/')) {
          const ids = new Set(new URL(url).searchParams.get('event_ids')!.split(','));
          return json({ events: destination.events!.filter((e) => ids.has(e.id!)) });
        }
        // Everything else — notably the retired /org/<id>/showmore/ — is what
        // Eventbrite's CloudFront answers today.
        return new Response('<H1>403 ERROR</H1>', { status: 403 });
      }),
    );
    return calls;
  }

  it('lists the organizer, then asks the destination API for those ids', async () => {
    vi.useFakeTimers({ now: CAPTURED, toFake: ['Date'] });
    const calls = stubNetwork();

    const result = await cineclubLuceroProvider.fetch();

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('event_ids=2003213221671,');

    // 23 upcoming events: 4 DJ nights dropped by format, 15 BITBANG! shorts
    // blocks by the non-feature filter, PET SEMATARY because it already
    // started. Four features remain.
    expect(
      result.screenings.map((s) => [s.filmTitle, s.startsAtUtc.toISOString()]),
    ).toEqual([
      ['MISERY', '2026-10-23T00:00:00.000Z'],
      ['CARRIE', '2026-10-23T02:00:00.000Z'],
      ['NANI: CICLO DE ANIMÉ × SAME Y AILÍN', '2026-10-29T03:00:00.000Z'],
      ['ESPECIAL HALLOWEN "LA VIRGEN DE LA TOSQUERA', '2026-10-31T23:00:00.000Z'],
    ]);
  });

  it('reports a quiet week (no films yet) as success with a warning', async () => {
    vi.useFakeTimers({ now: CAPTURED, toFake: ['Date'] });
    const onlyDjs = readJson<DestinationResponse>(
      'destination-future.json',
    ).events!.filter((e) => formatId(e) !== '7');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input);
        const body = url.includes('/destination/')
          ? { events: onlyDjs }
          : readJson<OrgEventsResponse>('org-events.json');
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );

    const result = await cineclubLuceroProvider.fetch();
    expect(result.success).toBe(true);
    expect(result.screenings).toEqual([]);
    expect(result.warnings.join('\n')).toMatch(/no feature screenings/);
  });

  // Generated by /ship test coverage audit.
  // Value: protects=listing follows hasMore pages, drops cancelled ids, and warns on
  // a destination shortfall; fails_when=is_cancelled is ignored, paging stops at page
  // 1, or the shortfall goes silent; why_new=fixtures have one page, no cancellations;
  // seam=none; no_claim=real Eventbrite paging semantics (fetch stubbed, fixture ids).
  it('pages through hasMore, skips cancelled events and reports a shortfall', async () => {
    vi.useFakeTimers({ now: CAPTURED, toFake: ['Date'] });
    const destination = readJson<DestinationResponse>('destination-future.json');
    const misery = destination.events!.find((e) => e.name?.startsWith('MISERY'))!;
    const carrie = destination.events!.find((e) => e.name?.startsWith('CARRIE'))!;
    const destinationCalls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        const body = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
        if (url.pathname.includes('/organizer-profile/')) {
          const page = url.searchParams.get('page');
          if (page === '1') {
            return body({
              events: [{ id: misery.id }, { id: 'cancelled-1', is_cancelled: true }],
              hasMore: true,
            });
          }
          return body({ events: [{ id: carrie.id }, { id: 'gone-1' }], hasMore: false });
        }
        destinationCalls.push(url.searchParams.get('event_ids')!);
        // 'gone-1' never comes back from the destination API.
        return body({ events: [misery, carrie] });
      }),
    );

    const result = await cineclubLuceroProvider.fetch();

    expect(result.success).toBe(true);
    expect(destinationCalls).toEqual([`${misery.id},${carrie.id},gone-1`]);
    expect(result.screenings.map((s) => s.filmTitle)).toEqual(['MISERY', 'CARRIE']);
    expect(result.warnings).toEqual(['destination API returned 2 of 3 listed events']);
  });

  it('fails loudly when the organizer lists nothing at all', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ events: [], hasMore: false }))),
    );
    const result = await cineclubLuceroProvider.fetch();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no events at all/);
  });
});
