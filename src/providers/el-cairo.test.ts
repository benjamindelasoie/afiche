/**
 * Tests for the El Cairo Cine Público provider.
 *
 * Fixtures: test/fixtures/el-cairo/ — captured 2026-10-21.
 *   - events-page-1.json: the Tribe Events REST response, 20 events from
 *     21/10 to 1/11, a single page.
 *   - one event page per shape the parser handles: a single film with an
 *     original title and a "***" event note (competencia-desleal), a
 *     recurring film (los-calvos), a cycle film (recorda-esto), a double bill
 *     (micro-retro-claudio-perrin), a duel (felicidad-vs-mi-vida-es-mi-vida)
 *     and the secret-film slot (la-random).
 *   - hangar-rojo-all.html: what the bare series URL serves (a redirect to
 *     its `/all/` date listing) — kept to pin that it is NOT a film page.
 *
 * When the theme changes these tests fail and we refresh.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildScreenings,
  elCairoProvider,
  isDuel,
  isVenueUrl,
  parseDetailPage,
  parseUtc,
  seriesUrl,
  type FilmPage,
  type TribeEventsPage,
} from './el-cairo';

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, '../../test/fixtures/el-cairo', name), 'utf8');
}

const PAGE = JSON.parse(fixture('events-page-1.json')) as TribeEventsPage;
const PAGES: Record<string, string> = {
  'competencia-desleal': 'competencia-desleal.html',
  'los-calvos': 'los-calvos.html',
  'recorda-esto': 'recorda-esto.html',
  'micro-retro-claudio-perrin-solxs-el-desentierro': 'micro-retro-claudio-perrin.html',
  'felicidad-vs-mi-vida-es-mi-vida': 'felicidad-vs-mi-vida-es-mi-vida.html',
  'la-random-3': 'la-random.html',
};
const SERIES = (slug: string) =>
  `https://elcairocinepublico.gob.ar/pelicula-de-sala/${slug}/`;

function details(): Map<string, FilmPage> {
  const m = new Map<string, FilmPage>();
  for (const [slug, file] of Object.entries(PAGES)) {
    m.set(SERIES(slug), parseDetailPage(fixture(file)));
  }
  return m;
}

/** Before every event in the fixture, so they all read as upcoming. */
const BEFORE_ALL = new Date(Date.UTC(2026, 9, 21, 12)); // 21/10 09:00 BA

describe('parseUtc / seriesUrl / isDuel', () => {
  it('reads the API utc_start_date as UTC, untouched', () => {
    expect(parseUtc('2026-10-23 01:30:00')?.toISOString()).toBe(
      '2026-10-23T01:30:00.000Z',
    );
    expect(parseUtc('garbage')).toBeNull();
  });

  it('folds recurring-event URLs onto their shared series page', () => {
    expect(seriesUrl(SERIES('los-calvos') + '2026-10-22/')).toBe(SERIES('los-calvos'));
    expect(seriesUrl(SERIES('competencia-desleal'))).toBe(SERIES('competencia-desleal'));
  });

  it('accepts only https URLs on the venue host', () => {
    expect(isVenueUrl(SERIES('los-calvos') + '2026-10-22/')).toBe(true);
    expect(isVenueUrl('http://elcairocinepublico.gob.ar/x/')).toBe(false);
    expect(isVenueUrl('https://elcairocinepublico.gob.ar.evil.example/x/')).toBe(false);
    expect(isVenueUrl('https://evil.example/?u=https://elcairocinepublico.gob.ar')).toBe(
      false,
    );
    expect(isVenueUrl('not a url')).toBe(false);
    // A move to www. must not turn every event into an off-site one.
    expect(isVenueUrl('https://www.elcairocinepublico.gob.ar/x/')).toBe(true);
  });

  it('spots audience duels but not a double bill', () => {
    expect(isDuel('FELICIDAD VS. MI VIDA ES MI VIDA')).toBe(true);
    expect(isDuel('EL ODIO VS TIEMPOS VIOLENTOS')).toBe(true);
    expect(isDuel('MICRO-RETRO: CLAUDIO PERRIN (SOLXS + EL DESENTIERRO)')).toBe(false);
  });
});

describe('parseDetailPage', () => {
  it('reads the ficha técnica and the original title of a single film', () => {
    const [film] = parseDetailPage(fixture('competencia-desleal.html')).films;
    expect(film).toMatchObject({
      filmTitle: 'COMPETENCIA DESLEAL',
      filmTitleOriginal: 'Concorrenza sleale',
      director: 'Ettore Scola',
      year: 2001,
      runtimeMin: 113, // written "113’" with a typographic apostrophe
      country: 'Italia',
    });
  });

  it('stops the synopsis at the "***" event note', () => {
    const [film] = parseDetailPage(fixture('competencia-desleal.html')).films;
    expect(film.synopsisEs).toMatch(/^Umberto, el propietario/);
    expect(film.synopsisEs).toMatch(/leyes raciales contra los judíos\.$/);
    expect(film.synopsisEs).not.toMatch(/SEMANA DE LA LENGUA/);
  });

  it('finds no film on a series `/all/` listing', () => {
    // Regression: fetching the stripped series URL landed here and every
    // recurring film went out title-only, silently.
    const { films } = parseDetailPage(fixture('hangar-rojo-all.html'));
    expect(films[0]?.filmTitle ?? '').toBe('');
  });

  it('splits a double bill into its films, each with its own credits', () => {
    const { films } = parseDetailPage(fixture('micro-retro-claudio-perrin.html'));
    expect(films).toHaveLength(2);
    // Director and origin come from the shared ficha; year and runtime from
    // each film's "<em>Drama / 6’ / Argentina 2021</em>" line.
    expect(films[0]).toMatchObject({
      filmTitle: 'SOLXS',
      director: 'Claudio Perrin',
      country: 'Argentina',
      year: 2021,
      runtimeMin: 6,
    });
    expect(films[1]).toMatchObject({
      filmTitle: 'EL DESENTIERRO',
      director: 'Claudio Perrin',
      year: 2019,
      runtimeMin: 105,
    });
    // The credit line is not synopsis.
    expect(films[0].synopsisEs).not.toMatch(/Elenco|Drama \//);
  });

  it('ignores an empty <h2> used as spacing', () => {
    const html =
      '<h1 class="titulo-cine-desala">A + B</h1><div class="sinopsis-online">' +
      '<h2>&nbsp;</h2><h2>A</h2><p>Uno.</p><h2> </h2><h2>B</h2><p>Dos.</p></div>';
    expect(parseDetailPage(html).films.map((f) => f.filmTitle)).toEqual(['A', 'B']);
  });

  it('keeps a film’s block whole across a blank spacer <h2>', () => {
    const html =
      '<h1 class="titulo-cine-desala">A + B</h1><div class="sinopsis-online">' +
      '<h2>A</h2><h2>&nbsp;</h2><p>Uno.</p><p><strong>AÑO:</strong> 1999</p>' +
      '<h2>B</h2><p>Dos.</p><p><strong>AÑO:</strong> 2001</p></div>';
    const { films } = parseDetailPage(html);
    expect(films.map((f) => [f.filmTitle, f.year, f.synopsisEs])).toEqual([
      ['A', 1999, 'Uno.'],
      ['B', 2001, 'Dos.'],
    ]);
  });

  it('stops the last film of a bill at the "***" event note', () => {
    // The note's DURACIÓN is the programme's; it must not become B's runtime.
    const html =
      '<h1 class="titulo-cine-desala">A + B</h1><div class="sinopsis-online">' +
      '<h2>A</h2><p><strong>DURACIÓN:</strong> 80’</p>' +
      '<h2>B</h2><p><strong>DURACIÓN:</strong> 95’</p>' +
      '<p>***</p><p><strong>DURACIÓN:</strong> 210’</p></div>';
    const { films } = parseDetailPage(html);
    expect(films.map((f) => [f.filmTitle, f.runtimeMin])).toEqual([
      ['A', 80],
      ['B', 95],
    ]);
  });

  it('drops a credit line even when its <em> is wrapped', () => {
    const html =
      '<h1 class="titulo-cine-desala">A + B</h1><div class="sinopsis-online">' +
      '<h2>A</h2><p>Sinopsis A.</p><p><strong><em>Drama / 9’ / Chile 2020</em></strong></p>' +
      '<h2>B</h2><p>Sinopsis B.</p></div>';
    const [a] = parseDetailPage(html).films;
    expect(a.synopsisEs).toBe('Sinopsis A.');
    expect(a).toMatchObject({ runtimeMin: 9, year: 2020 });
  });

  it('keeps synopsis paragraphs that italicize a title, drops all-italic credit lines', () => {
    const html =
      '<h1 class="titulo-cine-desala">X</h1><div class="sinopsis-online">' +
      '<p>Una relectura de <em>Rashomon</em> en Rosario.</p>' +
      '<p><em>Elenco: Fulana</em><br><em>Drama / 90’ / Argentina 2020</em></p></div>';
    const [film] = parseDetailPage(html).films;
    expect(film.synopsisEs).toBe('Una relectura de Rashomon en Rosario.');
  });

  it('reads "<strong>LABEL:</strong>" credits inside a multi-film block', () => {
    const { films } = parseDetailPage(fixture('felicidad-vs-mi-vida-es-mi-vida.html'));
    expect(films.map((f) => [f.filmTitle, f.director, f.year, f.runtimeMin])).toEqual([
      ['FELICIDAD', 'Todd Solondz', 1998, 140],
      ['MI VIDA ES MI VIDA', 'Todd Solondz', 1995, 113],
    ]);
  });
});

describe('buildScreenings', () => {
  const out = buildScreenings(PAGE.events, details(), BEFORE_ALL);

  it('emits one screening per event, plus one per extra double-bill film', () => {
    expect(PAGE.events).toHaveLength(20);
    expect(out).toHaveLength(21);
    expect(out.every((s) => s.cinemaId === 'el-cairo')).toBe(true);
  });

  it('keeps BA 22:30 as the next UTC day', () => {
    const duel = out.find((s) => s.filmTitle === 'FELICIDAD VS. MI VIDA ES MI VIDA');
    expect(duel?.startsAtUtc.toISOString()).toBe('2026-10-23T01:30:00.000Z');
  });

  it('gives each date of a recurring film its own screening and back-link', () => {
    const calvos = out.filter((s) => s.filmTitle === 'LOS CALVOS');
    expect(calvos.map((s) => s.startsAtUtc.toISOString())).toEqual([
      '2026-10-22T23:30:00.000Z',
      '2026-10-23T21:00:00.000Z',
      '2026-10-25T23:30:00.000Z',
    ]);
    expect(calvos[0].sourceUrl).toBe(SERIES('los-calvos') + '2026-10-22/');
    expect(calvos[0]).toMatchObject({
      director: 'Elías Gismondi, Marcos Mossello',
      year: 2024,
    });
    expect(calvos[0].tags).toEqual(['premiere']);
  });

  it('names the cycle from the event category', () => {
    const recorda = out.find((s) => s.filmTitle === 'RECORDÁ ESTO');
    expect(recorda?.programName).toBe('Foco Documental Sep/Oct 2026');
    expect(recorda?.tags).toEqual(['cycle']);
  });

  it('lists both double-bill films at the event time under the event title', () => {
    const t = '2026-10-30T23:30:00.000Z';
    const bill = out.filter((s) => s.startsAtUtc.toISOString() === t);
    expect(bill.map((s) => s.filmTitle)).toEqual(['SOLXS', 'EL DESENTIERRO']);
    expect(bill[0].programName).toBe(
      'MICRO-RETRO: CLAUDIO PERRIN (SOLXS + EL DESENTIERRO)',
    );
    expect(bill[0].tags).toEqual(['unique']);
  });

  it('treats a Zoom / Versus event as a duel even on a one-film page', () => {
    const url = SERIES('a-vs-b');
    const page: FilmPage = {
      films: [{ filmTitle: 'A VS. B', director: 'X', year: 2000 }],
    };
    const versus = PAGE.events.find((e) => e.categories[0]?.slug === 'zoom-versus')!;
    const [s] = buildScreenings(
      [{ ...versus, title: 'A VS. B', url }],
      new Map([[url, page]]),
      BEFORE_ALL,
    );
    expect(s).toMatchObject({ filmTitle: 'A VS. B', skipTmdb: true });
    expect(s.director).toBeUndefined();
  });

  it('treats a two-film Zoom / Versus event as a duel even without "VS." in its title', () => {
    const url = SERIES('a-o-b');
    const page: FilmPage = {
      films: [
        { filmTitle: 'A', year: 2000 },
        { filmTitle: 'B', year: 2001 },
      ],
    };
    const versus = PAGE.events.find((e) => e.categories[0]?.slug === 'zoom-versus')!;
    const out = buildScreenings(
      [{ ...versus, title: 'A O B', url }],
      new Map([[url, page]]),
      BEFORE_ALL,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ filmTitle: 'A O B', skipTmdb: true });
  });

  it('keeps a single film whose own title has "VS." as a film', () => {
    // Not a duel: its page bills one film, so the ficha must survive.
    const url = SERIES('kramer-vs-kramer');
    const page: FilmPage = {
      films: [{ filmTitle: 'KRAMER VS. KRAMER', director: 'Robert Benton', year: 1979 }],
    };
    const [s] = buildScreenings(
      [{ ...PAGE.events[0], title: 'KRAMER VS. KRAMER', url, categories: [], tags: [] }],
      new Map([[url, page]]),
      BEFORE_ALL,
    );
    expect(s).toMatchObject({
      filmTitle: 'KRAMER VS. KRAMER',
      director: 'Robert Benton',
      year: 1979,
    });
  });

  it('lists a duel once, under its own title, with no film metadata', () => {
    // Only the audience's pick screens, so neither film's credits may leak
    // into TMDB matching.
    const duel = out.find((s) => s.filmTitle === 'FELICIDAD VS. MI VIDA ES MI VIDA');
    expect(duel).toMatchObject({
      programName: 'ZOOM / VERSUS',
      tags: ['cycle'],
      skipTmdb: true, // never sent to TMDB: it could match one of the two
    });
    expect(duel?.director).toBeUndefined();
    expect(duel?.year).toBeUndefined();
  });

  it('lists title-only, defensively, an event passed in without its page', () => {
    // fetch() never does this (it skips unreadable films); direct callers may.
    const rey = out.find((s) => s.filmTitle === 'EL REY DE LA COMEDIA');
    expect(rey?.director).toBeUndefined(); // its page isn't in `details()`
    expect(rey?.startsAtUtc.toISOString()).toBe('2026-10-31T01:30:00.000Z');
  });

  it('drops functions that already started', () => {
    // 21/10 18:00 BA = 21:00 UTC: Competencia desleal is the first event.
    const later = buildScreenings(
      PAGE.events,
      details(),
      new Date(Date.UTC(2026, 9, 21, 21)),
    );
    expect(later.some((s) => s.filmTitle === 'COMPETENCIA DESLEAL')).toBe(false);
    expect(later).toHaveLength(20);
  });
});

// Value: protects=one DATED detail fetch per series feeds the ficha into screenings; fails_when=fetch loop requests the bare series URL or refetches per date; why_new=fetch() had no test; seam=none; no_claim=live site shape
describe('elCairoProvider.fetch (global fetch stubbed with the fixtures)', () => {
  const API = 'https://elcairocinepublico.gob.ar/wp-json/tribe/events/v1/events';
  // Dated or bare event URL -> fixture. Venue pages with no fixture of their
  // own get a stand-in single-film page; anything else is a 404.
  const SERVED: Record<string, string> = {
    [SERIES('competencia-desleal')]: 'competencia-desleal.html',
    [SERIES('los-calvos') + '2026-10-22/']: 'los-calvos.html',
    [SERIES('recorda-esto') + '2026-10-23/']: 'recorda-esto.html',
    [SERIES('micro-retro-claudio-perrin-solxs-el-desentierro')]:
      'micro-retro-claudio-perrin.html',
    [SERIES('felicidad-vs-mi-vida-es-mi-vida')]: 'felicidad-vs-mi-vida-es-mi-vida.html',
    [SERIES('la-random-3') + '2026-10-25/']: 'la-random.html',
    // What a template change would look like: a page with no film heading.
    [SERIES('hangar-rojo') + '2026-10-22/']: 'hangar-rojo-all.html',
  };
  const PAGES_PREFIX = 'https://elcairocinepublico.gob.ar/pelicula-de-sala/';
  const STAND_IN = 'recorda-esto.html';
  // A dead page: the one series the stand-in must not cover.
  const DEAD = SERIES('el-rey-de-la-comedia');

  let requested: string[];
  let served: Record<string, string>;
  let standIn: string | undefined;
  let redirects: Record<string, string>;
  let apiPages: TribeEventsPage[];
  let apiStatus: number;

  beforeEach(() => {
    requested = [];
    served = { ...SERVED };
    standIn = STAND_IN;
    redirects = {};
    apiPages = [PAGE];
    apiStatus = 200;
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    vi.setSystemTime(BEFORE_ALL);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = String(input);
        requested.push(url);
        if (url.startsWith(API)) {
          const page = Number(new URL(url).searchParams.get('page'));
          return new Response(JSON.stringify(apiPages[page - 1]), { status: apiStatus });
        }
        const file =
          served[url] ??
          (url.startsWith(PAGES_PREFIX) && url !== DEAD ? standIn : undefined);
        if (!file) return new Response('not found', { status: 404 });
        const res = new Response(fixture(file), { status: 200 });
        // Where fetch() ended up after following redirects.
        Object.defineProperty(res, 'url', { value: redirects[url] ?? url });
        return res;
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function run() {
    const p = elCairoProvider.fetch();
    await vi.runAllTimersAsync();
    return p;
  }

  it('fetches each series once, at its first dated URL, and enriches every date', async () => {
    const result = await run();
    expect(result.success).toBe(true);

    const detail = requested.filter((u) => !u.startsWith(API));
    // Regression: the bare series URL redirects to a ficha-less `/all/` listing.
    expect(detail).toContain(SERIES('los-calvos') + '2026-10-22/');
    expect(detail).not.toContain(SERIES('los-calvos'));
    expect(new Set(detail).size).toBe(detail.length);
    expect(detail).toHaveLength(13); // 13 distinct series in the 20 events

    const calvos = result.screenings.filter((s) => s.filmTitle === 'LOS CALVOS');
    expect(calvos).toHaveLength(3);
    for (const s of calvos) expect(s.year).toBe(2024);
    expect(requested[0]).toContain('start_date=2026-10-21');
  });

  // Value: protects=a film whose page is dead or heading-less is left out of the run, with a warning, while the rest still lists; fails_when=it is listed title-only (forking a yearless film row), fails the whole run, or drops silently; why_new=fetch() untested; seam=none; no_claim=retry behavior
  it('skips, with a warning, a film whose page is dead or heading-less', async () => {
    const result = await run();
    expect(result.success).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.stringMatching(/hangar-rojo\/2026-10-22\/: no film heading/),
    );
    expect(result.warnings).toContainEqual(
      expect.stringMatching(/el-rey-de-la-comedia\/: detail fetch failed \(HTTP 404/),
    );
    // One warning per series page, not one per date it would have screened.
    expect(result.warnings.filter((w) => w.includes('hangar-rojo'))).toHaveLength(1);
    const titles = result.screenings.map((s) => s.filmTitle);
    expect(titles).not.toContain('HANGAR ROJO');
    expect(titles).not.toContain('EL REY DE LA COMEDIA');
    // Films whose page did load are unaffected and keep their ficha.
    const calvos = result.screenings.filter((s) => s.filmTitle === 'LOS CALVOS');
    expect(calvos).toHaveLength(3);
    expect(calvos.every((s) => s.year === 2024)).toBe(true);
  });

  // Value: protects=an event pointing off the venue's site is never fetched and is skipped with its own warning; fails_when=the URL is followed or the event lists; why_new=isVenueUrl had no fetch-level test; seam=none; no_claim=redirects after a venue-host fetch
  it('never fetches an off-site event URL, and skips it with a warning', async () => {
    const offSite = {
      ...PAGE.events[1],
      title: 'AJENA',
      url: 'https://evil.example/pelicula/',
    };
    apiPages = [{ ...PAGE, events: [...PAGE.events, offSite] }];
    const result = await run();
    expect(requested).not.toContain('https://evil.example/pelicula/');
    expect(result.warnings).toContainEqual(
      "AJENA: event URL is off the venue's site — skipped",
    );
    expect(result.screenings.map((s) => s.filmTitle)).not.toContain('AJENA');
  });

  // Value: protects=when most film pages are unreadable the run fails, so ingest keeps the last good schedule; fails_when=a mostly-empty schedule is published as success; why_new=the skip path only covered single pages; seam=none; no_claim=the exact threshold
  it('fails the run when most film pages are unreadable', async () => {
    served = {};
    standIn = undefined;
    const result = await run();
    expect(result).toMatchObject({ success: false, screenings: [] });
    expect(result.error).toMatch(/13 of 13 film pages unreadable/);
  });

  // Value: protects=events API failure reports success:false so ingest keeps existing rows; fails_when=error swallowed as an empty success; why_new=untested; seam=none; no_claim=run.ts exit code
  it('fails the run, with no screenings, when the events API errors', async () => {
    apiStatus = 503;
    const result = await run();
    expect(result).toMatchObject({
      success: false,
      screenings: [],
      cinemaId: 'el-cairo',
    });
    expect(result.error).toMatch(/HTTP 503/);
  });

  // Value: protects=an empty cartelera still succeeds but raises the one warning that flags it; fails_when=the zero-screenings warning is removed; why_new=untested; seam=none; no_claim=alerting downstream
  it('warns when the API has no upcoming screenings', async () => {
    apiPages = [{ events: [], total: 0, total_pages: 0 }];
    const result = await run();
    expect(result).toMatchObject({ success: true, screenings: [] });
    expect(result.warnings).toContainEqual(
      expect.stringMatching(/no upcoming screenings/),
    );
  });

  // Value: protects=late at night the API is asked for the BA date, not the UTC one; fails_when=start_date uses the UTC date, dropping tonight's late functions; why_new=other tests run at midday, where both dates agree; seam=none; no_claim=none beyond protects
  it('asks the API for the BA date, not the UTC date, late at night', async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 22, 1, 0))); // 21/10 22:00 in BA
    await run();
    expect(requested[0]).toContain('start_date=2026-10-21');
  });

  // Value: protects=a 200 with no events array fails the run with a readable error; fails_when=the body is trusted and the run dies on an opaque TypeError or passes empty; why_new=only HTTP errors were tested; seam=none; no_claim=other malformed shapes
  it('fails the run when the API answers 200 without an events array', async () => {
    apiPages = [{ code: 'rest_no_route' } as unknown as TribeEventsPage];
    const result = await run();
    expect(result).toMatchObject({ success: false, screenings: [] });
    expect(result.error).toMatch(/no events array/);
  });

  // Value: protects=one malformed API event is skipped with a warning instead of failing the venue's run; fails_when=a missing field throws and the run fails; why_new=all fixture events are well-formed; seam=none; no_claim=other malformed shapes
  it('skips a malformed API event instead of failing the run', async () => {
    const broken = {
      id: 999,
      title: 'ROTA',
    } as unknown as TribeEventsPage['events'][number];
    apiPages = [{ ...PAGE, events: [...PAGE.events, broken] }];
    const result = await run();
    expect(result.success).toBe(true);
    expect(result.warnings).toContainEqual(
      'event 999: malformed in the API response — skipped',
    );
  });

  // Value: protects=pages that keep a title but lose the ficha's year fail the run instead of forking every film year-less; fails_when=only a missing title counts as unreadable; why_new=the readable check was title-only; seam=none; no_claim=the exact share
  it('fails the run when most readable pages carry no year', async () => {
    served = {};
    standIn = 'la-random.html'; // a real page with a heading and no ficha year
    const result = await run();
    expect(result).toMatchObject({ success: false, screenings: [] });
    expect(result.error).toMatch(/carry no year/);
  });

  // Value: protects=a detail page redirected off the venue's site is not parsed; fails_when=redirects are followed and trusted; why_new=isVenueUrl only vetted the request URL; seam=none; no_claim=redirect hops on the venue host
  it('skips a film whose page redirects off the venue site', async () => {
    redirects[SERIES('los-calvos') + '2026-10-22/'] = 'https://evil.example/landing/';
    const result = await run();
    expect(result.warnings).toContainEqual(
      expect.stringMatching(/los-calvos\/2026-10-22\/ redirected off the venue's site/),
    );
    expect(result.screenings.map((s) => s.filmTitle)).not.toContain('LOS CALVOS');
  });

  // Value: protects=a page without total_pages stops after that page; fails_when=the loop runs to MAX_PAGES and an out-of-range request fails the run; why_new=total_pages was always present; seam=none; no_claim=other malformed totals
  it('stops paging when the API omits total_pages', async () => {
    apiPages = [{ events: PAGE.events, total: 20 } as unknown as TribeEventsPage];
    const result = await run();
    expect(requested.filter((u) => u.startsWith(API))).toHaveLength(1);
    expect(result.success).toBe(true);
  });

  // Value: protects=every API page is read up to total_pages; fails_when=loop stops at page 1 or ignores total_pages; why_new=fixture is single-page; seam=none; no_claim=MAX_PAGES cap
  it('follows total_pages across API pages', async () => {
    const half = PAGE.events.length / 2;
    apiPages = [
      { events: PAGE.events.slice(0, half), total: 20, total_pages: 2 },
      { events: PAGE.events.slice(half), total: 20, total_pages: 2 },
    ];
    const paged = await run();
    expect(requested.filter((u) => u.startsWith(API))).toHaveLength(2);

    // Same events on one page must give the same screenings.
    apiPages = [PAGE];
    const single = await run();
    expect(paged.screenings).toHaveLength(single.screenings.length);
    expect(paged.screenings.length).toBeGreaterThan(0);
  });
});

// Value: protects=all-day/unparseable events are skipped with warnings and HTML entities in titles decode; fails_when=a timeless event is emitted or titles keep &#8217;; why_new=fixture has neither; seam=none; no_claim=real all-day shape
describe('buildScreenings on odd API events', () => {
  it('skips all-day and unparseable events with a warning, and decodes title entities', () => {
    const base = PAGE.events[0];
    const warnings: string[] = [];
    const out = buildScreenings(
      [
        { ...base, id: 1, title: 'MUESTRA', all_day: true },
        { ...base, id: 2, title: 'SIN HORA', utc_start_date: '' },
        { ...base, id: 3, title: 'RECORD&#8217;A', url: SERIES('x') },
      ],
      new Map(),
      BEFORE_ALL,
      warnings,
    );
    expect(out.map((s) => s.filmTitle)).toEqual(['RECORD’A']);
    expect(warnings).toEqual([
      'MUESTRA: all-day event — skipped',
      'SIN HORA: unparseable utc_start_date "" — skipped',
    ]);
  });
});
