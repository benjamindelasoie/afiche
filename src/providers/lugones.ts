/**
 * Sala Leopoldo Lugones provider. The cinematheque room of the Teatro San
 * Martín, programmed by the Complejo Teatral de Buenos Aires.
 *
 * Strategy: complejoteatral.gob.ar is WordPress, but its `produccion` post
 * type is not exposed through /wp-json, so this stays an HTML scraper. The
 * homepage lists every current and upcoming production as a
 * `.list-item-programacion` card carrying a genre ("cine"), a place
 * ("Sala Leopoldo Lugones / Teatro San Martín"), a date range and a link to
 * /produccion/<slug>/. The /agenda/ page shows the same cards but only for
 * productions already running, so the homepage is the wider net. Cards are
 * filtered to genre cine AND place Lugones (the complex also runs theatre,
 * dance and exhibitions in other salas), then each production page is
 * parsed.
 *
 * A production page carries the schedule inside `div.details` in one of two
 * layouts:
 *
 *   CYCLE (e.g. Wim Wenders, Herzog-Kinski): day headers ("Jueves 15"),
 *     time markers ("A las 20.30 horas"), a <strong> film title, then
 *     metadata and prose. Older cycles put each line in its own <p>; newer
 *     ones join a whole film block into one <p> with <br>s. Both are
 *     flattened into the same line list before the state-machine walk.
 *
 *   SINGLE FILM (e.g. El joven Frankenstein): an <h1>/<h2> "Title (YEAR)",
 *     merged showtime lines ("Jueves 5, viernes 6 y sábado 7, 21 horas"),
 *     then SINOPSIS and FICHA TÉCNICA Y ARTÍSTICA sections.
 *
 * The cycle walk runs first; the single-film parser runs when it finds
 * nothing. Both anchor month and year on the page's "Funciones:" range,
 * falling back to the homepage card's date line.
 *
 * The source is free-form cinephile prose, so the parser is defensive: when
 * it can't parse a page it logs a warning and moves on rather than failing
 * the whole run.
 */

import * as cheerio from 'cheerio';
import type { ScreeningTag } from '@/db';
import { type Provider, type ProviderRunResult, type ScrapedScreening } from './types';

const CINEMA_ID = 'lugones';
const LISTING_URL = 'https://complejoteatral.gob.ar/';
const DETAIL_DELAY_MS = 300;
/** A hung government host must not stall every provider queued behind it. */
const FETCH_TIMEOUT_MS = 20_000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** How long past a run's end its dates may still be read in that year. */
const GRACE_MS = 30 * DAY_MS;
/** Assumed length of an open-ended ("A partir del…") run, for the year guess. */
const OPEN_RUN_MS = 180 * DAY_MS;
// Realistic desktop Chrome UA. complejoteatral.gob.ar 403s scraper-shaped
// agents, especially from datacenter IP ranges such as CI runners.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const MONTH_INDEX: Record<string, number> = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  setiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11,
};

const WEEKDAY =
  '(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)';

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export const lugonesProvider: Provider = {
  id: CINEMA_ID,
  name: 'Sala Leopoldo Lugones',

  async fetch(): Promise<ProviderRunResult> {
    const warnings: string[] = [];
    try {
      const listingHtml = await fetchText(LISTING_URL);
      const listing = extractPrograms(listingHtml);

      if (listing.cardCount === 0) {
        return {
          cinemaId: CINEMA_ID,
          screenings: [],
          success: false,
          warnings,
          error: 'No production cards found on the homepage — selector likely broke.',
        };
      }
      if (listing.programs.length === 0) {
        // The sala goes dark between seasons; that is not a scraper failure.
        warnings.push(
          `no cine programs at Sala Lugones among ${listing.cardCount} cards`,
        );
      }

      const screenings: ScrapedScreening[] = [];
      let detailsFailed = 0;
      for (const [i, program] of listing.programs.entries()) {
        if (i > 0) await sleep(DETAIL_DELAY_MS);
        try {
          const detailHtml = await fetchText(program.detailUrl);
          screenings.push(...parseDetailPage(detailHtml, program, warnings));
        } catch (err) {
          detailsFailed++;
          warnings.push(
            `program "${program.slug}": ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      if (detailsFailed > 0 && detailsFailed === listing.programs.length) {
        // Every detail page erroring (a 403 wall on /produccion/, say) is a
        // blocked scraper, not a quiet season: fail so the last good schedule
        // stays up and the run is reported as broken.
        return {
          cinemaId: CINEMA_ID,
          screenings: [],
          success: false,
          warnings,
          error: `All ${detailsFailed} Sala Lugones detail pages failed to load.`,
        };
      }

      return { cinemaId: CINEMA_ID, screenings, success: true, warnings };
    } catch (err) {
      return {
        cinemaId: CINEMA_ID,
        screenings: [],
        success: false,
        warnings,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Listing: homepage production cards, filtered to cine at Sala Lugones
// ---------------------------------------------------------------------------
export interface ProgramLink {
  slug: string;
  title: string;
  /** The card's date line, e.g. "Del 15 al 30 de octubre". */
  dateRangeText: string;
  detailUrl: string;
}

export function extractPrograms(html: string): {
  programs: ProgramLink[];
  cardCount: number;
} {
  const $ = cheerio.load(html);
  const programs: ProgramLink[] = [];
  const seen = new Set<string>();
  const $cards = $('.list-item-programacion');

  $cards.each((_i, el) => {
    const $el = $(el);
    const genre = clean($el.find('.category').first().text()).toLowerCase();
    const place = clean($el.find('.place').first().text());
    if (genre !== 'cine' || !/leopoldo\s+lugones/i.test(place)) return;

    const title = clean($el.find('h2').first().text());
    const href = $el.find('a[href*="/produccion/"]').first().attr('href');
    if (!title || !href) return;

    // Detail pages are fetched and published as ticket links, so a card may
    // only point at the venue's own site over https.
    const url = new URL(href, LISTING_URL);
    if (url.protocol !== 'https:' || url.hostname !== new URL(LISTING_URL).hostname)
      return;
    const detailUrl = url.toString();
    if (seen.has(detailUrl)) return;
    seen.add(detailUrl);

    programs.push({
      slug: detailUrl.replace(/\/+$/, '').replace(/^.*\/produccion\//, ''),
      title,
      dateRangeText: clean($el.find('.date').first().text()),
      detailUrl,
    });
  });

  return { programs, cardCount: $cards.length };
}

// ---------------------------------------------------------------------------
// Detail page: production page into screenings
// ---------------------------------------------------------------------------

/**
 * One visual line of the details block. A <p> joined with <br>s yields
 * several lines; `title` is set when the line reads as a film title.
 */
interface Line {
  text: string;
  title: string | null;
  isHeading: boolean;
}

type ParseState =
  | { kind: 'idle' }
  | {
      kind: 'with-time';
      times: Array<{ hour: number; minute: number }>;
      film: FilmContext;
      // True when the showtime line carried "Duración total del programa" — a
      // multi-short PROGRAM block (festival / double-bill). emit() skips these:
      // the cycle parser can't represent a shorts block as individual films.
      isProgramBlock: boolean;
    }
  | { kind: 'without-time'; film: FilmContext };

interface FilmContext {
  title: string;
  titleOriginal?: string;
  director?: string;
  year?: number;
  country?: string;
  runtimeMin?: number;
  synopsis?: string;
}

interface MonthAnchor {
  startMonth: number;
  startYear: number;
}

export function parseDetailPage(
  html: string,
  program: ProgramLink,
  warnings: string[],
  now: Date = new Date(),
): ScrapedScreening[] {
  const $ = cheerio.load(html);

  // The card's place already said Lugones; the page's own "Dónde:" line is
  // the second check, so a mislabelled card can't import a theatre play.
  const info = $('.info li')
    .toArray()
    .map((li) => clean($(li).text()));
  const where = info.find((l) => /^d[oó]nde:/i.test(l));
  if (where && !/leopoldo\s+lugones/i.test(where)) {
    warnings.push(`program "${program.slug}": not at Sala Lugones ("${where}"), skipped`);
    return [];
  }

  const $block = $('div.details > div').first();
  if ($block.length === 0) {
    warnings.push(`program "${program.slug}": details block not found`);
    return [];
  }

  const funciones = info
    .find((l) => /^funciones:/i.test(l))
    ?.replace(/^funciones:\s*/i, '');
  const anchor =
    (funciones && parseDateRange(funciones, now)) ||
    parseDateRange(program.dateRangeText, now);
  if (!anchor) {
    warnings.push(
      `program "${program.slug}": could not parse date range "${funciones ?? program.dateRangeText}"`,
    );
    return [];
  }

  const lines = blockLines($, $block);

  const cycle = parseCycle(lines, program, anchor, warnings);
  if (cycle.length > 0) return cycle;

  const single = parseSingleFilm(lines, program, anchor);
  if (single.length > 0) return single;

  warnings.push(
    `program "${program.slug}": 0 screenings parsed from ${lines.length} lines. ` +
      'Detail page may use a non-standard layout.',
  );
  return [];
}

/** Flatten the details block into lines, splitting each element on <br>. */
function blockLines(
  $: cheerio.CheerioAPI,
  $block: ReturnType<cheerio.CheerioAPI>,
): Line[] {
  const out: Line[] = [];
  for (const el of $block.children().toArray()) {
    const isHeading = /^h[1-6]$/i.test(el.tagName);
    for (const fragment of ($(el).html() ?? '').split(/<br\s*\/?>/i)) {
      const $f = cheerio.load(fragment, null, false);
      const text = clean($f.root().text());
      if (!text) continue;
      out.push({
        text,
        title: titleOf(text, clean($f('strong').first().text())),
        isHeading,
      });
    }
  }
  return out;
}

/**
 * A line is a film title when it is entirely one <strong> run, or a
 * <strong> run followed only by a year-less parenthetical — "Hasta el fin
 * del mundo (Versión del director)", where the CMS left the qualifier
 * unbolded. Returns the whole line so the title matches the fully bold
 * occurrence of the same film on another day. Style-agnostic: each cycle
 * colors its titles differently.
 */
function titleOf(text: string, strongText: string): string | null {
  // A standalone "+" separates the films of a double-bill. It's a
  // separator, never a film title.
  if (!strongText || strongText === '+') return null;
  if (text === strongText) return text;
  if (!text.startsWith(strongText)) return null;
  const rest = text.slice(strongText.length).trim();
  return /^\([^)]*\)$/.test(rest) && !/\d{4}/.test(rest) ? text : null;
}

/**
 * Cycle layout. Walks the lines with a small state machine: day headers set
 * the current date, "A las HH horas" markers set the showtime, title lines
 * name the next film, and metadata lines (original title, director, runtime,
 * synopsis prose) flow into the in-flight film until the next title. A time
 * marker may also come AFTER its film's metadata ("A las 15 horas (99′;
 * DM).") — the without-time state covers that order.
 */
function parseCycle(
  lines: Line[],
  program: ProgramLink,
  anchor: MonthAnchor,
  warnings: string[],
): ScrapedScreening[] {
  const screenings: ScrapedScreening[] = [];

  let currentDay: Date | null = null;
  let currentMonth = anchor.startMonth;
  let currentYear = anchor.startYear;
  let lastDayNum = 0;
  let state: ParseState = { kind: 'idle' };
  let skippedProgramBlocks = 0;

  const emit = (s: ParseState) => {
    if (s.kind !== 'with-time') return;
    // Multi-short program block: skip it (a summary warning is pushed at the
    // end; the operator can add the block via /admin). Normal single-film
    // days on the same page still emit.
    if (s.isProgramBlock) {
      skippedProgramBlocks++;
      return;
    }
    if (!s.film.title || !currentDay) return;
    for (const { hour, minute } of s.times) {
      screenings.push({
        cinemaId: CINEMA_ID,
        filmTitle: s.film.title,
        filmTitleOriginal: s.film.titleOriginal,
        director: s.film.director,
        year: s.film.year,
        country: s.film.country,
        runtimeMin: s.film.runtimeMin,
        startsAtUtc: baLocalToUtc(
          currentDay.getUTCFullYear(),
          currentDay.getUTCMonth(),
          currentDay.getUTCDate(),
          hour,
          minute,
        ),
        tags: inferTags(program),
        synopsisEs: s.film.synopsis || undefined,
        sourceUrl: program.detailUrl,
        // The production title is the curatorial wrapper (e.g. "En las rutas
        // de Wim Wenders"); the ingest's no-echo filter drops it when it
        // happens to equal filmTitle.
        programName: program.title,
      });
    }
  };

  for (const line of lines) {
    const { text } = line;

    const dayMatch = matchDayHeader(text);
    if (dayMatch) {
      emit(state);
      state = { kind: 'idle' };
      if (dayMatch.badMonth) {
        // An unknown month is not guessed (same stance as matchShowtimeLine):
        // the films under this header are dropped with a warning rather than
        // filed under the previous day or a rolled-over month.
        warnings.push(
          `program "${program.slug}": unknown month in "${text}" — day skipped`,
        );
        currentDay = null;
        continue;
      }
      if (dayMatch.month !== undefined) {
        if (dayMatch.month < currentMonth) currentYear += 1;
        currentMonth = dayMatch.month;
      } else if (dayMatch.day < lastDayNum) {
        // Month-less header going backwards ("Sábado 31" → "Martes 3").
        currentMonth = (currentMonth + 1) % 12;
        if (currentMonth === 0) currentYear += 1;
      }
      lastDayNum = dayMatch.day;
      currentDay = new Date(Date.UTC(currentYear, currentMonth, dayMatch.day));
      continue;
    }

    if (/^no hay funciones/i.test(text)) {
      emit(state);
      state = { kind: 'idle' };
      continue;
    }

    const times = matchTimeMarker(text);
    if (times) {
      const isProgramBlock = /duraci[oó]n total del programa/i.test(text);
      if (state.kind === 'without-time') {
        // Film already had title + metadata; now we know its times.
        state = { kind: 'with-time', times, film: state.film, isProgramBlock };
      } else {
        emit(state);
        state = { kind: 'with-time', times, film: { title: '' }, isProgramBlock };
      }
      // A trailing time marker may carry the runtime: "A las 15 horas (66’; DM)."
      const inlineRuntime = text.match(/\((\d+)\s*['’′´]\s*[;,]/);
      if (inlineRuntime && !state.film.runtimeMin) {
        state.film.runtimeMin = parseInt(inlineRuntime[1], 10);
      }
      continue;
    }

    if (line.title) {
      if (state.kind === 'idle') {
        state = { kind: 'without-time', film: { title: line.title } };
      } else if (!state.film.title) {
        state.film.title = line.title;
      } else if (isFilmComplete(state.film)) {
        // Previous film is complete; a new title means a new film.
        emit(state);
        state = { kind: 'without-time', film: { title: line.title } };
      }
      // else: title already set and the film isn't complete — a bold run
      // inside the metadata, not a new film.
      continue;
    }

    if (state.kind === 'idle') continue;
    const film = state.film;

    // Original title / country / year:
    //   "(Son of Frankenstein; EE.UU; 1939)"
    //   "(Aguirre, der Zorn Gottes; República Federal de Alemania, 1972)"
    //   "(EE.UU./Alemania/Cuba/Francia, 1999)"   (no original title)
    if (!film.year) {
      const meta = text.match(
        /^\((?:([^;()]+);\s*)?([^;()]+?)\s*[;,]\s*(\d{4})\)\s*\.?$/,
      );
      if (meta) {
        if (meta[1]) film.titleOriginal = meta[1].trim();
        film.country = meta[2].trim();
        film.year = parseInt(meta[3], 10);
        continue;
      }
    }

    if (/^Direcci[oó]n:/i.test(text)) {
      film.director ??= cleanCredit(text.replace(/^Direcci[oó]n:\s*/i, ''));
      continue;
    }

    // Runtime + format: "(99′; DM).", "(173′; DCP.)", "(94′; 35mm)."
    const runtime = text.match(/^\((\d+)\s*['’′´]\s*[;,][^)]*\)\.?$/);
    if (runtime) {
      film.runtimeMin ??= parseInt(runtime[1], 10);
      continue;
    }

    // Synopsis: the first prose line that's not a critic quote, the cast
    // line, parenthesized metadata or a screening note. Kept in full; the
    // cartelera card line-clamps with CSS. A film repeated on a later day
    // comes without synopsis — the ingest's in-memory dedup keeps the first
    // (full) occurrence.
    if (
      !film.synopsis &&
      text.length > 40 &&
      !/^["“(]/.test(text) &&
      !/^Con\s/.test(text) &&
      !/^(?:al t[ée]rmino|se exhibe|copia|presentaci[oó]n)/i.test(text)
    ) {
      film.synopsis = text;
    }
  }

  emit(state);

  if (skippedProgramBlocks > 0) {
    warnings.push(
      `program "${program.slug}": ${skippedProgramBlocks} multi-short / festival program ` +
        `block(s) ("Duración total del programa") skipped — a shorts block can't be ` +
        `represented as individual films; add via /admin if needed.`,
    );
  }

  return screenings;
}

function isFilmComplete(f: FilmContext): boolean {
  return !!f.title && (f.runtimeMin !== undefined || !!f.year);
}

// ---------------------------------------------------------------------------
// Single-film layout
// ---------------------------------------------------------------------------

/**
 * One film with its dates listed inline. The title is the first heading
 * ("El joven Frankenstein (1974)"); showtime lines sit before SINOPSIS;
 * FICHA TÉCNICA Y ARTÍSTICA carries the structured metadata.
 */
function parseSingleFilm(
  lines: Line[],
  program: ProgramLink,
  anchor: MonthAnchor,
): ScrapedScreening[] {
  const heading = lines.find((l) => l.isHeading && !matchShowtimeLine(l.text));
  const rawTitle = heading?.text ?? program.title;
  const yearSuffix = rawTitle.match(/\s*\((\d{4})\)\s*$/);
  const film: FilmContext = { title: rawTitle.replace(/\s*\(\d{4}\)\s*$/, '').trim() };
  if (yearSuffix) film.year = parseInt(yearSuffix[1], 10);

  const texts = lines.map((l) => l.text);
  const sinopsisIdx = texts.findIndex((l) => /^SINOPSIS$/i.test(l));
  const fichaIdx = texts.findIndex((l) => /^FICHA T[ÉE]CNICA/i.test(l));
  const showtimeEnd =
    sinopsisIdx >= 0 ? sinopsisIdx : fichaIdx >= 0 ? fichaIdx : texts.length;

  let currentMonth = anchor.startMonth;
  let currentYear = anchor.startYear;
  let lastDay = 0;
  const showtimes: Array<{
    y: number;
    m: number;
    d: number;
    hour: number;
    minute: number;
  }> = [];

  for (const text of texts.slice(0, showtimeEnd)) {
    const parsed = matchShowtimeLine(text);
    if (!parsed) continue;
    for (const { day, month } of parsed.days) {
      if (month !== undefined) {
        // An explicit month beats the day-decrease heuristic. Going backwards
        // (diciembre → enero) means the next year.
        if (month < currentMonth) currentYear += 1;
        currentMonth = month;
      } else if (day < lastDay) {
        currentMonth = (currentMonth + 1) % 12;
        if (currentMonth === 0) currentYear += 1;
      }
      lastDay = day;
      for (const t of parsed.times) {
        showtimes.push({ y: currentYear, m: currentMonth, d: day, ...t });
      }
    }
  }

  if (sinopsisIdx >= 0) {
    const stop = fichaIdx > sinopsisIdx ? fichaIdx : texts.length;
    const prose = texts
      .slice(sinopsisIdx + 1, stop)
      .filter((l) => !isAllCapsBanner(l))
      .join(' ')
      .trim();
    if (prose.length >= 40) film.synopsis = prose;
  }

  if (fichaIdx >= 0) {
    const ficha: string[] = [];
    for (const line of texts.slice(fichaIdx + 1)) {
      // Stop at the next section banner (e.g. "PALABRAS DEL REALIZADOR").
      if (isAllCapsBanner(line)) break;
      ficha.push(line);
    }
    parseFichaLines(ficha, film);
  }

  return showtimes.map((st) => ({
    cinemaId: CINEMA_ID,
    filmTitle: film.title,
    filmTitleOriginal: film.titleOriginal,
    director: film.director,
    year: film.year,
    country: film.country,
    runtimeMin: film.runtimeMin,
    startsAtUtc: baLocalToUtc(st.y, st.m, st.d, st.hour, st.minute),
    tags: inferTags(program),
    synopsisEs: film.synopsis,
    sourceUrl: program.detailUrl,
    // Usually equals the film title (single-film production), in which case
    // the ingest's no-echo filter drops it.
    programName: program.title,
  }));
}

/**
 * Parse a single-film showtime line into its days and times:
 *
 *   "Sábado 31 de octubre, 21 horas"
 *   "Jueves 5, viernes 6 y sábado 7, 21 horas"
 *   "Domingo 8 y jueves 12, 18 horas"
 *   "Jueves 28 y viernes 29 de mayo a las 21 horas"
 *   "Martes 12, 20.30 y 22 horas"
 *
 * A "de MONTH" on a day applies to the month-less days before it on the
 * same line ("Jueves 28 y viernes 29 de mayo"). Returns null if the line
 * isn't a showtime, or names a month that doesn't exist (better to miss
 * and warn than to silently drift the date).
 */
export function matchShowtimeLine(text: string): {
  days: Array<{ day: number; month?: number }>;
  times: Array<{ hour: number; minute: number }>;
} | null {
  const cleaned = text.toLowerCase().replace(/[°º]/g, '').trim();
  const m = cleaned.match(
    /^(.+?)(?:,|\s+a\s+las)\s+(\d{1,2}(?:[.:]\d{2})?(?:\s+y\s+\d{1,2}(?:[.:]\d{2})?)*)\s+horas?\.?$/,
  );
  if (!m) return null;

  const days: Array<{ day: number; month?: number }> = [];
  for (const part of m[1].split(/\s*,\s*|\s+y\s+/)) {
    const pm = part
      .trim()
      .match(new RegExp(`^${WEEKDAY}\\s+(\\d{1,2})(?:\\s+de\\s+([a-záéíóú]+))?$`));
    if (!pm) return null;
    let month: number | undefined;
    if (pm[2] !== undefined) {
      month = MONTH_INDEX[pm[2]];
      if (month === undefined) return null;
    }
    days.push({ day: parseInt(pm[1], 10), month });
  }
  // Back-fill an explicit month onto the month-less days preceding it.
  for (let i = days.length - 2; i >= 0; i--) {
    if (days[i].month === undefined) days[i].month = days[i + 1].month;
  }

  const times = parseTimeList(m[2]);
  return times.length > 0 ? { days, times } : null;
}

/**
 * Walk the FICHA TÉCNICA lines and populate {titleOriginal, country, year,
 * runtimeMin, director}. Shapes seen in the wild:
 *
 *   "Estados Unidos, 1974" / "Argentina – 2025"   country + year
 *   "2024" (country on the preceding line)
 *   "106 minutos" / "70 minutos – DCP 2K" / "126' – DM"
 *   "Dirección: Mel Brooks." / "Dirección y guion: …"
 */
function parseFichaLines(lines: string[], film: FilmContext): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!film.titleOriginal) {
      const m = line.match(/^Título original:\s*(.+?)\.?$/i);
      if (m) {
        film.titleOriginal = m[1].trim();
        continue;
      }
    }

    const yearAlone = line.match(/^(\d{4})$/);
    if (yearAlone) {
      film.year ??= parseInt(yearAlone[1], 10);
      const prev = lines[i - 1];
      if (!film.country && prev && !/^Título/i.test(prev) && !/:/.test(prev)) {
        film.country = prev.replace(/\.$/, '').trim();
      }
      continue;
    }
    const countryYear = line.match(/^(.+?)\s*(?:,|\s[–—-])\s*(\d{4})\.?$/);
    // The prefix mustn't contain a colon, or "Sonido: X, 2025" would match.
    if (countryYear && !/:/.test(countryYear[1])) {
      film.year ??= parseInt(countryYear[2], 10);
      film.country ??= countryYear[1].trim();
      continue;
    }

    if (!film.runtimeMin) {
      const runtime = line.match(/^(\d+)\s*(?:['’′´]|minutos?\b)/i);
      if (runtime) {
        film.runtimeMin = parseInt(runtime[1], 10);
        continue;
      }
    }

    if (!film.director) {
      // "Dirección" plus an optional whitelisted role list, so neighbouring
      // credits like "Dirección de fotografía" don't match as the director.
      const m = line.match(
        /^Direcci[oó]n(?:(?:[,\s]+|\s+y\s+)(?:guion|guión|producción|montaje))*:\s*(.+)$/i,
      );
      if (m) film.director = cleanCredit(m[1]);
    }
  }
}

/**
 * True if the line is a section banner — pure uppercase letters (with
 * Spanish accents and ampersands) plus spaces, ≥ 4 chars. Distinguishes
 * "FICHA TÉCNICA Y ARTÍSTICA" from short format lines like "B&N" or "DCP".
 */
function isAllCapsBanner(line: string): boolean {
  return line.length >= 4 && /^[A-ZÁÉÍÓÚÑ&\s]+$/.test(line);
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------
function matchDayHeader(
  text: string,
): { day: number; month?: number; badMonth?: string } | null {
  const cleaned = text.toLowerCase().replace(/[°º]/g, '').trim();
  // "martes 28" / "domingo 1 de noviembre"
  const m = cleaned.match(
    new RegExp(`^${WEEKDAY}\\s+(\\d{1,2})(?:\\s+de\\s+([a-záéíóú]+))?$`),
  );
  if (!m) return null;
  return {
    day: parseInt(m[1], 10),
    month: m[2] ? MONTH_INDEX[m[2]] : undefined,
    ...(m[2] && MONTH_INDEX[m[2]] === undefined ? { badMonth: m[2] } : {}),
  };
}

/**
 * Parse "A las HH horas", "A las HH y HH horas", "A las HH.MM horas". Lugones
 * writes minutes with a dot (14.30) — when missed, the cascade is brutal: the
 * next time marker attaches to the previous film, shifting times AND dropping
 * the last film of each day silently.
 */
function matchTimeMarker(text: string): Array<{ hour: number; minute: number }> | null {
  const m = text.match(
    /^A las (\d{1,2}(?:[.,:]\d{2})?(?:\s+y\s+\d{1,2}(?:[.,:]\d{2})?)*)\s+horas?/i,
  );
  if (!m) return null;
  const times = parseTimeList(m[1]);
  return times.length > 0 ? times : null;
}

/** "20.30 y 22" → [{20, 30}, {22, 0}]; out-of-range values are dropped. */
function parseTimeList(text: string): Array<{ hour: number; minute: number }> {
  return text
    .split(/\s+y\s+/)
    .map((t) => {
      const [h, min] = t.split(/[.,:]/);
      return { hour: parseInt(h, 10), minute: min ? parseInt(min, 10) : 0 };
    })
    .filter((t) => t.hour >= 0 && t.hour <= 23 && t.minute >= 0 && t.minute < 60);
}

/**
 * Parse a program's date range to its starting month + year. Weekday names
 * are dropped first, so these all reduce to one of four forms:
 *
 *   "Del 23 de octubre al 6 de noviembre"   different months
 *   "Del 15 al 30 de octubre"               same month
 *   "A partir del sábado 31 de octubre"     open-ended
 *   "Jueves 29 de octubre, 16.30 y 20.30 horas"   single day
 *
 * The START month is the anchor (taking the end month dated April cycles a
 * month late — the original Karloff regression). The END date picks the
 * year: a run that started months ago but is still on stays this year.
 */
export function parseDateRange(text: string, now: Date = new Date()): MonthAnchor | null {
  const cleaned = text
    .toLowerCase()
    .replace(/[°º]/g, '')
    .replace(new RegExp(`\\b${WEEKDAY}\\s+`, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();

  // Groups: start day, start month, then (when the form has one) end day and
  // end month. The open-ended form has no end, so it is given OPEN_RUN_MS.
  const forms: Array<{ re: RegExp; open?: boolean }> = [
    { re: /del (\d{1,2}) de ([a-záéíóú]+) al (\d{1,2}) de ([a-záéíóú]+)/ },
    { re: /del (\d{1,2}) al (\d{1,2}) de ([a-záéíóú]+)/ },
    { re: /(?:a partir del|desde el) (\d{1,2}) de ([a-záéíóú]+)/, open: true },
    { re: /^(\d{1,2}) de ([a-záéíóú]+)/ },
  ];

  for (const [i, form] of forms.entries()) {
    const m = cleaned.match(form.re);
    if (!m) continue;
    // The same-month form puts the shared month last: "del 12 al 25 de noviembre".
    const [startDay, startMonthName, endDay, endMonthName] =
      i === 1 ? [m[1], m[3], m[2], m[3]] : [m[1], m[2], m[3], m[4]];
    const startMonth = MONTH_INDEX[startMonthName];
    if (startMonth === undefined) return null;
    const endMonth = endMonthName ? MONTH_INDEX[endMonthName] : undefined;
    if (endMonthName && endMonth === undefined) return null;

    // Year inference: the earliest year whose run has not ended more than
    // GRACE_MS ago. Judging by the END keeps a long or open-ended run in its
    // own year once it is well under way. `now` is injectable so fixture tests
    // stay deterministic as time advances.
    const runEnd = (year: number) => {
      const startMs = Date.UTC(year, startMonth, parseInt(startDay, 10));
      if (form.open) return startMs + OPEN_RUN_MS;
      if (endMonth === undefined) return startMs;
      const endYear = endMonth < startMonth ? year + 1 : year;
      return Date.UTC(endYear, endMonth, parseInt(endDay, 10));
    };
    const thisYear = now.getUTCFullYear();
    const startYear =
      [thisYear - 1, thisYear].find((y) => runEnd(y) >= now.getTime() - GRACE_MS) ??
      thisYear + 1;
    return { startMonth, startYear };
  }
  return null;
}

/** BA-local wall time to UTC. Argentina is UTC-3 with no DST (stable since 2009). */
function baLocalToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
) {
  return new Date(Date.UTC(year, month, day, hour + 3, minute));
}

/** "Francisco D´Eufemia (CdC)." → "Francisco D´Eufemia" (guild initials, trailing period). */
function cleanCredit(text: string): string {
  return text
    .replace(/\.\s*$/, '')
    .replace(/\s*\([A-Za-z]{2,5}\)\s*$/, '')
    .trim();
}

function inferTags(program: ProgramLink): ScreeningTag[] {
  const tags: ScreeningTag[] = ['cycle'];
  const title = program.title.toLowerCase();
  if (/bafici|festival|retrospect/.test(title)) tags.push('retrospective');
  if (/restaurad|restor/.test(title)) tags.push('restored');
  return tags;
}

function clean(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'es-AR,es;q=0.9' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}
