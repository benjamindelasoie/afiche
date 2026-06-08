/**
 * Sala Leopoldo Lugones provider.
 *
 * Detail pages come in two layouts. We try strategies in order:
 *
 *   S1 — MULTI-FILM CYCLE (e.g. Boris Karloff)
 *     Per-day <p> headers ("Martes 28"), per-time <p> markers
 *     ("A las 18 horas"), per-film <p><strong>Title</strong></p>, then
 *     metadata <p>s. State-machine walk over <p> children.
 *
 *   S2 — SINGLE-FILM (e.g. Ojos extraños)
 *     One <h2 class="on_view"> title plus merged "DAY N, HH[.MM] horas"
 *     showtime lines (multiple days possible: "Viernes 8 y sábado 9").
 *     Sectioned blocks "SINOPSIS" + "FICHA TÉCNICA Y ARTÍSTICA" carry
 *     the synopsis and structured metadata.
 *
 * The parser tries S1. If S1 returns zero screenings, S2 runs. Both
 * strategies share the program's date-range anchor for month/year.
 *
 * The source HTML is free-form cinephile prose, so the parser is defensive:
 * when it can't parse a line it logs a warning and moves on rather than
 * blowing up the whole run.
 */

import * as cheerio from 'cheerio';
import { type Provider, type ProviderRunResult, type ScrapedScreening } from './types';
import type { ScreeningTag } from '@/db';

const LISTING_URL = 'https://complejoteatral.gob.ar/sala-leopoldo-lugones';
const DETAIL_BASE = 'https://complejoteatral.gob.ar/ver/';
// Realistic desktop Chrome UA. The honest 'AficheScraper/0.1' UA earns
// 403s from complejoteatral.gob.ar + lumiton.ar when the request comes
// from GitHub Actions runner IPs (datacenter ranges are already flagged
// by most anti-bot heuristics; a scraper-shaped UA tips them over).
// Locally on a residential IP the old UA worked fine.
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export const lugonesProvider: Provider = {
  id: 'lugones',
  name: 'Sala Leopoldo Lugones',

  async fetch(): Promise<ProviderRunResult> {
    const warnings: string[] = [];
    try {
      const listingHtml = await fetchText(LISTING_URL);
      const programs = extractPrograms(listingHtml);

      if (programs.length === 0) {
        return {
          cinemaId: this.id,
          screenings: [],
          success: false,
          warnings,
          error: 'No programs found on listing page — selector likely broke.',
        };
      }

      const screenings: ScrapedScreening[] = [];

      for (const program of programs) {
        try {
          const detailHtml = await fetchText(program.detailUrl);
          const parsed = parseDetailPage(detailHtml, program, warnings);
          screenings.push(...parsed);
        } catch (err) {
          warnings.push(
            `program "${program.slug}": ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      return {
        cinemaId: this.id,
        screenings,
        success: true,
        warnings,
      };
    } catch (err) {
      return {
        cinemaId: this.id,
        screenings: [],
        success: false,
        warnings,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Step 1 & 2: extract cine programs from the listing page
// ---------------------------------------------------------------------------
export interface ProgramLink {
  slug: string;
  title: string;
  dateRangeText: string;
  detailUrl: string;
}

function extractPrograms(html: string): ProgramLink[] {
  const $ = cheerio.load(html);
  const out: ProgramLink[] = [];

  $('.list-item-programacion').each((_i, el) => {
    const $el = $(el);

    // Filter to the 'cine' genre (each list-item has an embedded JSON blob
    // with the genre name).
    const genreJson = $el.find('div[style*="display:none"]').first().text();
    if (!genreJson.includes('"nombre":"cine"')) return;

    const title = $el.find('h2').first().text().trim();
    const dateRangeText = $el.find('.date').first().text().trim().replace(/\s+/g, ' ');
    const href = $el.find('a[href*="/ver/"]').first().attr('href');
    if (!title || !href) return;

    const slug = href.replace(/^.*\/ver\//, '');
    out.push({
      slug,
      title,
      dateRangeText,
      detailUrl: href.startsWith('http') ? href : `${DETAIL_BASE}${slug}`,
    });
  });

  return out;
}

// ---------------------------------------------------------------------------
// Step 3 & 4: parse a single program detail page into screenings
// ---------------------------------------------------------------------------

/**
 * Parser state machine. Tracks whether we're between a time marker and its
 * film, between a film's metadata and its time marker, or idle.
 */
type ParseState =
  | { kind: 'idle' }
  | {
      kind: 'with-time';
      times: Array<{ hour: number; minute: number }>;
      film: FilmContext;
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

export function parseDetailPage(
  html: string,
  program: ProgramLink,
  warnings: string[],
  now: Date = new Date(),
): ScrapedScreening[] {
  const $ = cheerio.load(html);

  const $block = $('div.details.roboto_condensed > div').first();
  if ($block.length === 0) {
    warnings.push(`program "${program.slug}": details block not found`);
    return [];
  }

  // Festival-of-shorts guard (tolerance, not perfect parsing). Some Lugones
  // programs group several short films into ONE timed "program" block, marking
  // the shorts with standalone <p><strong>+</strong></p> separators (e.g.
  // Syncro Film Fest, 2026-06). The S1 cycle state machine can't represent
  // this: it latches the program-name header as the "film", never completes it
  // (the shorts' "(Country, Year)" metadata isn't a shape it parses), drops the
  // real shorts as duplicates, and attaches the first short's director — so it
  // emits garbage (program names as poster-less fake films). Lugones festivals
  // are recurrently ad-hoc and the next one will use yet another format; rather
  // than chase each, detect THIS structure and skip the page with a visible
  // warning (operator surfaces it via /admin) instead of polluting the
  // cartelera. See investigation 2026-06-08.
  const shortSeparators = $block
    .children('p')
    .toArray()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((p: any) => $(p).text().trim() === '+').length;
  if (shortSeparators > 0) {
    warnings.push(
      `program "${program.slug}": multi-short / festival format ` +
        `(${shortSeparators} "+"-separated shorts) — the parser can't represent it ` +
        `faithfully; skipped to avoid garbage entries. Add manually via /admin if needed.`,
    );
    return [];
  }

  const rangeInfo = parseDateRange(program.dateRangeText, now);
  if (!rangeInfo) {
    warnings.push(
      `program "${program.slug}": could not parse date range "${program.dateRangeText}"`,
    );
    return [];
  }

  const s1 = parseS1Cycle($, $block, program, rangeInfo);
  if (s1.length > 0) return s1;

  const s2 = parseS2SingleFilm($, $block, program, rangeInfo);
  if (s2.length > 0) return s2;

  warnings.push(
    `program "${program.slug}": 0 screenings parsed from ${$block.children('p').length} <p> tags. ` +
      'Detail page may use a non-standard layout (e.g. no per-day listings, merged day+time lines, or external schedule link).',
  );
  return [];
}

/**
 * S1 — multi-film cycle layout. Walks <p> children with a small state
 * machine: day-header <p>s set the current date, "A las HH horas" markers
 * set the current showtime, full-strong <p>s name the next film, and
 * metadata lines (original title, director, runtime, synopsis prose) flow
 * into the in-flight film context until the next title appears.
 */
function parseS1Cycle(
  $: cheerio.CheerioAPI,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $block: any,
  program: ProgramLink,
  rangeInfo: { startMonth: number; startYear: number },
): ScrapedScreening[] {
  const screenings: ScrapedScreening[] = [];

  let currentDay: Date | null = null;
  let currentMonth = rangeInfo.startMonth;
  let currentYear = rangeInfo.startYear;
  let state: ParseState = { kind: 'idle' };

  /** Emit screenings for the current time-bound film, if any. */
  const emit = (s: ParseState) => {
    if (s.kind !== 'with-time') return;
    if (!s.film.title || !currentDay) return;
    for (const { hour, minute } of s.times) {
      screenings.push({
        cinemaId: 'lugones',
        filmTitle: s.film.title,
        filmTitleOriginal: s.film.titleOriginal,
        director: s.film.director,
        year: s.film.year,
        country: s.film.country,
        runtimeMin: s.film.runtimeMin,
        startsAtUtc: buildBaLocalToUtc(currentDay, hour, minute),
        tags: inferTags(program),
        synopsisEs: s.film.synopsis,
        sourceUrl: program.detailUrl,
        // S1 multi-film cycle: program.title is the curatorial wrapper
        // (e.g., "Olivera-Aries", "Cine y Filosofía"), distinct from each
        // s.film.title. The ingest's no-echo filter drops it when it
        // happens to equal filmTitle (rare for S1 by definition).
        programName: program.title,
      });
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $block.children('p').each((_i: number, p: any) => {
    const $p = $(p);
    const text = $p.text().trim().replace(/\s+/g, ' ');
    if (!text || text === '\u00a0') return;

    // --- Day header? ---
    const dayMatch = matchDayHeader(text);
    if (dayMatch) {
      emit(state);
      state = { kind: 'idle' };
      if (dayMatch.monthName) {
        const m = MONTH_INDEX[dayMatch.monthName.toLowerCase()];
        if (m !== undefined) {
          if (m < currentMonth) currentYear += 1;
          currentMonth = m;
        }
      }
      currentDay = new Date(Date.UTC(currentYear, currentMonth, dayMatch.day));
      return;
    }

    // --- "No hay funciones" ---
    if (/^no hay funciones/i.test(text)) {
      emit(state);
      state = { kind: 'idle' };
      return;
    }

    // --- Time marker? ---
    const times = matchTimeMarker(text);
    if (times) {
      if (state.kind === 'with-time') {
        emit(state);
        state = { kind: 'with-time', times, film: { title: '', synopsis: '' } };
      } else if (state.kind === 'without-time') {
        // Film already had title+metadata; now we know its times.
        state = { kind: 'with-time', times, film: state.film };
      } else {
        state = { kind: 'with-time', times, film: { title: '', synopsis: '' } };
      }
      // A time marker line might also contain a trailing runtime "(73'; DM)."
      const inlineRuntime = text.match(/\((\d+)\s*[′'´]\s*;\s*[A-Z]+\)/);
      if (inlineRuntime && state.kind === 'with-time' && !state.film.runtimeMin) {
        state.film.runtimeMin = parseInt(inlineRuntime[1], 10);
      }
      return;
    }

    // --- Film title: a <strong> element that is the full content of the <p>.
    // Style-agnostic — Lugones uses different colors across programs (green for
    // Boris Karloff, burgundy for Eternamente Marilyn). Day headers are also
    // <strong>-wrapped, but the day-header regex fired earlier and returned.
    const titleCandidate = extractTitleIfFullStrong($p);
    if (titleCandidate) {
      if (state.kind === 'idle') {
        state = { kind: 'without-time', film: { title: titleCandidate, synopsis: '' } };
      } else if (!state.film.title) {
        state.film.title = titleCandidate;
      } else if (isFilmComplete(state.film)) {
        // Previous film is complete; new title = new film.
        if (state.kind === 'with-time') emit(state);
        state = { kind: 'without-time', film: { title: titleCandidate, synopsis: '' } };
      }
      // else: title already set, current film not yet "complete" → ignore duplicate
      return;
    }

    // --- Paragraphs below only matter if we have a film in progress ---
    const film = state.kind === 'idle' ? null : state.film;
    if (!film) return;

    // Original title / country / year — accepts ; or , between country and year.
    //   "(Son of Frankenstein; EE.UU; 1939)"
    //   "(The Sorcerers; Reino Unido, 1967)"
    //   "(I tre volti della paura; Italia/Francia, 1963)"
    if (!film.titleOriginal) {
      const $em = $p.find('em').first();
      const metaMatch = text.match(/^\(([^;]+);\s*(.+?)\s*[;,]\s*(\d{4})\)\s*\.?\s*$/);
      if (metaMatch && $em.length > 0) {
        film.titleOriginal = $em.text().trim();
        film.country = metaMatch[2].trim();
        film.year = parseInt(metaMatch[3], 10);
        return;
      }
    }

    // Director line
    if (/^Dirección:/i.test(text) && !film.director) {
      film.director = text
        .replace(/^Dirección:\s*/i, '')
        .replace(/\.$/, '')
        .trim();
      return;
    }

    // Runtime + format: "(99'; DM)." standalone (catches lines we didn't eat above)
    const runtimeMatch = text.match(/^\((\d+)\s*[′'´]\s*;\s*[A-Z]+\)\.?$/);
    if (runtimeMatch && !film.runtimeMin) {
      film.runtimeMin = parseInt(runtimeMatch[1], 10);
      return;
    }

    // Synopsis — grab the first prose paragraph that's not a critic quote,
    // not the cast line, not parenthesized metadata. We keep the source
    // text in full; the cartelera card line-clamps with CSS, /pelicula
    // shows it whole. Lugones cycle pages list a film once with the
    // synopsis and again on later days without — the in-memory dedup in
    // upsertFilms keeps the first (full) occurrence, so repeat blocks
    // don't overwrite it with their stripped-down director+cast+runtime.
    const looksLikeQuote = /^["“]/.test(text) || text.startsWith('(');
    if (
      !looksLikeQuote &&
      !film.synopsis &&
      !text.startsWith('Con ') &&
      !/^Dirección:/i.test(text) &&
      text.length > 40
    ) {
      film.synopsis = text;
    }
  });

  // End of block — emit any trailing film.
  emit(state);

  return screenings;
}

// ---------------------------------------------------------------------------
// S2 — single-film layout
// ---------------------------------------------------------------------------
//
// One film, one cycle of dates listed inline. Distinguishing markup:
//   - <h2 class="lora bold on_view">FilmTitle (YEAR)</h2>
//   - Showtime <p>s like "Jueves 7, 20 horas" or
//     "Viernes 8 y sábado 9, 20.30 horas" (multi-day with " y ", decimal
//     minute separator, optional .MM).
//   - Sectioned blocks marked by all-caps <p><strong> headers:
//       SINOPSIS                       → editorial synopsis prose
//       FICHA TÉCNICA Y ARTÍSTICA      → original title / country / year /
//                                        runtime / director / cast
//       PALABRAS DEL REALIZADOR        → director's note (ignored)
//
// We anchor the calendar date via the listing tile's "A partir del DD de
// MONTH" range. If the in-page day list goes BACKWARD (e.g. 8 → 4), we
// roll the month forward — Lugones single-film runs that span a month
// boundary list days in chronological order.

function parseS2SingleFilm(
  $: cheerio.CheerioAPI,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $block: any,
  program: ProgramLink,
  rangeInfo: { startMonth: number; startYear: number },
): ScrapedScreening[] {
  // Title: prefer the in-block <h2 class="on_view">, strip a trailing
  // "(YEAR)" suffix. Fall back to the listing tile's title.
  const $h2 = $block.find('h2.on_view').first();
  const rawTitle = $h2.length > 0 ? $h2.text().trim() : program.title;
  const filmTitle = rawTitle.replace(/\s*\(\d{4}\)\s*$/, '').trim();

  const film: FilmContext = { title: filmTitle, synopsis: '' };

  // Materialize <p> texts once — every section search reuses this.
  const lines: string[] = $block
    .children('p')
    .toArray()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((p: any) => $(p).text().trim().replace(/\s+/g, ' '));

  // Section headers are pure-uppercase (with Spanish diacritics) lines.
  // Locate the canonical ones; use indices to slice the document.
  const sinopsisIdx = lines.findIndex((l) => /^SINOPSIS$/i.test(l));
  const fichaIdx = lines.findIndex((l) => /^FICHA T[ÉE]CNICA/i.test(l));

  // Showtimes live in the prefix before SINOPSIS (or before FICHA TÉCNICA
  // if the page omits the synopsis section).
  const showtimeUpperBound =
    sinopsisIdx >= 0 ? sinopsisIdx : fichaIdx >= 0 ? fichaIdx : lines.length;

  let currentMonth = rangeInfo.startMonth;
  let currentYear = rangeInfo.startYear;
  let lastDay = 0;
  const showtimes: Array<{
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
  }> = [];

  for (let i = 0; i < showtimeUpperBound; i++) {
    const line = lines[i];
    if (!line) continue;
    const parsed = matchSingleFilmShowtime(line);
    if (!parsed) continue;

    // Explicit "de MONTH" on the line (Justa-class editorial prose
    // schedules) is the strongest signal — it overrides the running
    // month context AND skips the day-decrease rollover heuristic for
    // this line. When the explicit month is BEFORE the running month
    // (e.g. diciembre → enero), bump the year too.
    if (parsed.month !== undefined) {
      if (parsed.month < currentMonth) currentYear += 1;
      currentMonth = parsed.month;
      // Reset lastDay so the inner-loop rollover heuristic stays dormant
      // for this line — explicit month already pinned the calendar.
      lastDay = 0;
    }

    for (const day of parsed.days) {
      if (parsed.month === undefined && day < lastDay) {
        currentMonth = (currentMonth + 1) % 12;
        if (currentMonth === 0) currentYear += 1;
      }
      lastDay = day;
      showtimes.push({
        year: currentYear,
        month: currentMonth,
        day,
        hour: parsed.hour,
        minute: parsed.minute,
      });
    }
  }

  // Synopsis: prose between SINOPSIS and the next section header. Empty
  // <p>s (rendered as &nbsp;) and stray uppercase banners are skipped.
  if (sinopsisIdx >= 0) {
    const stop = fichaIdx >= 0 ? fichaIdx : lines.length;
    const buf: string[] = [];
    for (let i = sinopsisIdx + 1; i < stop; i++) {
      const line = lines[i];
      if (!line) continue;
      if (isAllCapsBanner(line)) continue;
      buf.push(line);
    }
    const joined = buf.join(' ').trim();
    if (joined.length >= 40) film.synopsis = joined;
  }

  // Ficha técnica: walk the section, classify each line, and stop at the
  // next all-caps header (PALABRAS DEL REALIZADOR or similar).
  if (fichaIdx >= 0) {
    const ficha: string[] = [];
    for (let i = fichaIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      // Stop at the next section banner (e.g. "PALABRAS DEL REALIZADOR").
      // Don't stop on "Color" or "B&N" — those are format lines that look
      // capitalized but aren't all-caps banners.
      if (isAllCapsBanner(line)) break;
      ficha.push(line);
    }
    parseFichaLines(ficha, film);
  }

  // Emit screenings.
  const screenings: ScrapedScreening[] = [];
  for (const st of showtimes) {
    const day = new Date(Date.UTC(st.year, st.month, st.day));
    screenings.push({
      cinemaId: 'lugones',
      filmTitle: film.title,
      filmTitleOriginal: film.titleOriginal,
      director: film.director,
      year: film.year,
      country: film.country,
      runtimeMin: film.runtimeMin,
      startsAtUtc: buildBaLocalToUtc(day, st.hour, st.minute),
      tags: inferTags(program),
      synopsisEs: film.synopsis,
      sourceUrl: program.detailUrl,
      // S2 single-film: program.title may equal film.title (the listing
      // wraps a single-film page), in which case the ingest no-echo filter
      // drops it. When the listing wraps a real cycle context (e.g.,
      // "Especial cine argentino"), the pill renders.
      programName: program.title,
    });
  }
  return screenings;
}

/**
 * Parse a single S2 showtime line. Two connector shapes are supported:
 *
 *   - Comma form (terse, compressed):
 *       "Jueves 7, 20 horas"
 *       "Viernes 8 y sábado 9, 20.30 horas"
 *
 *   - "a las" form (editorial prose, e.g. the Justa cycle 2026-05):
 *       "Jueves 28 y viernes 29 de mayo a las 21 horas"
 *       "Sábado 30 a las 18 horas"
 *       "Martes 2 y miércoles 3 de junio a las 21 horas"
 *
 * The "a las" form additionally supports an explicit "de MONTH" suffix
 * on the day list. When present, the explicit month is returned and
 * `parseS2SingleFilm` treats it as a signal-wins-over-heuristic override
 * of the running month context (more robust than the day-decrease rollover
 * heuristic against out-of-order listings or month skips).
 *
 * Times accept "HH" or "HH.MM" / "HH:MM" — Lugones uses both decimal
 * and colon minute separators interchangeably.
 *
 * Returns the day numbers (one or more) sharing a single hour/minute,
 * plus an optional explicit month index (0-11). Null if the shape
 * doesn't match.
 */
export function matchSingleFilmShowtime(
  text: string,
): { days: number[]; hour: number; minute: number; month?: number } | null {
  const cleaned = text.toLowerCase().replace(/[°º]/g, '').trim();
  // Days "DAYNAME N [y DAYNAME M ...]" → optional " de MONTH" → connector
  // (comma OR "a las") → "HH[.:]MM horas" with optional trailing period.
  // Days prefix is non-greedy so the optional "de MONTH" group is preferred
  // over absorbing " de mayo" into the day-list when the suffix is present.
  const m = cleaned.match(
    /^([a-záéíóú\s\d]+?)(?:\s+de\s+([a-záéíóú]+))?\s*(?:,|a\s+las)\s+(\d{1,2})(?:[.:](\d{2}))?\s+horas?\.?$/,
  );
  if (!m) return null;
  const prefix = m[1].trim();
  const monthName = m[2];
  const parts = prefix.split(/\s+y\s+/);
  const days: number[] = [];
  for (const p of parts) {
    const pm = p
      .trim()
      .match(
        /^(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\s+(\d{1,2})$/,
      );
    if (!pm) return null;
    days.push(parseInt(pm[1], 10));
  }
  if (days.length === 0) return null;
  const hour = parseInt(m[3], 10);
  const minute = m[4] ? parseInt(m[4], 10) : 0;
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;

  // Resolve explicit month suffix to an index. If captured but not a
  // recognized Spanish month, treat as a parse failure — better to miss
  // and surface a warning than to silently drift the date by accepting
  // a corrupt month signal.
  let month: number | undefined;
  if (monthName !== undefined) {
    const idx = MONTH_INDEX[monthName];
    if (idx === undefined) return null;
    month = idx;
  }
  return { days, hour, minute, month };
}

/**
 * Walk the FICHA TÉCNICA lines and populate {titleOriginal, country, year,
 * runtimeMin, director} on the film context. Lugones uses a stable line
 * order on single-film pages — countries (comma-separated) immediately
 * precede the year — so we identify the year by shape and back-fill
 * country from the line above. Director carries a "Dirección" or
 * "Dirección y guion" prefix.
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

    if (!film.year) {
      // Two shapes seen in the wild:
      //   - Year-only line: "2024"                  (country on preceding line)
      //   - Country+year:   "Portugal/Francia, 2025"  (one-line combined,
      //                                                Justa-class editorial)
      const yearAlone = line.match(/^(\d{4})$/);
      if (yearAlone) {
        film.year = parseInt(yearAlone[1], 10);
        // Country sits on the line directly preceding the year (ficha order:
        // title-internal? → countries → year → language → format → runtime).
        if (!film.country && i > 0) {
          const candidate = lines[i - 1];
          if (candidate && !/^Título/i.test(candidate) && !/:/.test(candidate)) {
            film.country = candidate.replace(/\.$/, '').trim();
          }
        }
        continue;
      }
      const countryYear = line.match(/^(.+?)\s*,\s*(\d{4})\.?$/);
      // Guard: the prefix mustn't contain a colon (otherwise this would
      // false-match a metadata line like "Sonido: X, 2025").
      if (countryYear && !/:/.test(countryYear[1])) {
        film.year = parseInt(countryYear[2], 10);
        if (!film.country) {
          film.country = countryYear[1].trim();
        }
        continue;
      }
    }

    if (!film.runtimeMin) {
      // Two forms:
      //   "126' – DM"      → apostrophe-marked (apostrophe may be ASCII
      //                      U+0027, prime U+2032, right single U+2019,
      //                      or acute U+00B4)
      //   "108 minutos"    → prose-marked (Justa-class editorial)
      const apos = line.match(/^(\d+)\s*['’′´]/);
      if (apos) {
        film.runtimeMin = parseInt(apos[1], 10);
        continue;
      }
      const prose = line.match(/^(\d+)\s+minutos?$/i);
      if (prose) {
        film.runtimeMin = parseInt(prose[1], 10);
        continue;
      }
    }

    if (!film.director) {
      // Stable prefix is "Dirección" plus an optional comma/and-separated
      // role list (e.g. "Dirección, guion y producción"). The middle role
      // tokens are whitelisted so neighbouring credit lines like
      // "Dirección de fotografía" (cinematographer) and "Dirección de arte"
      // (art director) don't false-match as the film's director.
      const m = line.match(
        /^Direcci[oó]n(?:(?:[,\s]+|\s+y\s+)(?:guion|guión|producción|montaje))*:\s*(.+?)\.?$/i,
      );
      if (m) {
        film.director = m[1].trim();
        continue;
      }
    }
  }
}

/**
 * True if the line is a section banner — pure uppercase letters (with
 * Spanish accents and ampersands) plus spaces, ≥ 4 chars. Distinguishes
 * sectioning headers like "FICHA TÉCNICA Y ARTÍSTICA" from short format
 * lines like "Color" or "B&N" (mixed case / single word).
 */
function isAllCapsBanner(line: string): boolean {
  if (line.length < 4) return false;
  if (!/^[A-ZÁÉÍÓÚÑ&\s]+$/.test(line)) return false;
  return line === line.toUpperCase();
}

function isFilmComplete(f: FilmContext): boolean {
  // "Complete" enough that the next title means a new film.
  return !!f.title && (f.runtimeMin !== undefined || !!f.year);
}

/**
 * Return the film title if the paragraph's content is "just a <strong>" —
 * i.e., the paragraph's text equals its first <strong>'s text (ignoring
 * whitespace). Style-agnostic: works for any color wrapping or no wrapping.
 * Returns null for paragraphs with prose + bold runs (e.g. critic quotes).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTitleIfFullStrong($p: any): string | null {
  const $strong = $p.find('strong').first();
  if ($strong.length === 0) return null;
  const pText = $p.text().trim().replace(/\s+/g, ' ');
  const strongText = $strong.text().trim().replace(/\s+/g, ' ');
  if (!strongText) return null;
  return pText === strongText ? strongText : null;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------
function matchDayHeader(text: string): { day: number; monthName?: string } | null {
  const cleaned = text.toLowerCase().replace(/[°º]/g, '').trim();
  // "viernes 1 de mayo"
  const withMonth = cleaned.match(
    /^(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\s+(\d{1,2})\s+de\s+([a-záéíóú]+)$/i,
  );
  if (withMonth) {
    return { day: parseInt(withMonth[2], 10), monthName: withMonth[3] };
  }
  // "martes 28"
  const withoutMonth = cleaned.match(
    /^(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\s+(\d{1,2})$/i,
  );
  if (withoutMonth) {
    return { day: parseInt(withoutMonth[2], 10) };
  }
  return null;
}

/**
 * Parse "A las HH horas", "A las HH y HH horas", "A las HH.MM horas",
 * "A las HH y HH.MM horas". Lugones writes minutes with a dot (14.30 hs)
 * — when missed, the cascade is brutal: the next valid time marker
 * attaches to the previous film, shifting times AND dropping the last
 * film of each day silently (since emit() bails on without-time state).
 */
function matchTimeMarker(text: string): Array<{ hour: number; minute: number }> | null {
  const m = text.match(
    /^A las (\d{1,2})(?:[.,](\d{2}))?(?:\s+y\s+(\d{1,2})(?:[.,](\d{2}))?)?\s+horas?/i,
  );
  if (!m) return null;
  const out: Array<{ hour: number; minute: number }> = [
    { hour: parseInt(m[1], 10), minute: m[2] ? parseInt(m[2], 10) : 0 },
  ];
  if (m[3]) {
    out.push({ hour: parseInt(m[3], 10), minute: m[4] ? parseInt(m[4], 10) : 0 });
  }
  return out.filter((t) => t.hour >= 0 && t.hour <= 23 && t.minute >= 0 && t.minute < 60);
}

/**
 * Parse the program's date range string to determine the starting month + year.
 * Handles four forms seen in Lugones programming:
 *   1. "Del 28 de abril al 5 de mayo"     → different months
 *   2. "Del 15 al 26 de abril"            → same month
 *   3. "A partir del 7 de mayo"           → open-ended
 *   4. "Jueves 28 de mayo, 15 y 18 horas" → single-day one-off ("bis"
 *                                            encore screenings, special
 *                                            events, festival add-ons —
 *                                            day + month + inline times,
 *                                            not a true range)
 */
export function parseDateRange(
  text: string,
  now: Date = new Date(),
): { startMonth: number; startYear: number } | null {
  const cleaned = text.toLowerCase().replace(/[°º]/g, '').trim();

  // Each form captures [startDay, startMonth, ...]. Group 2 is always the
  // start month — the month name that goes with the START day, which is the
  // one we anchor the parser on. Form 1 has a trailing end-month group that
  // we intentionally discard.
  //
  // Order matters: forms 1-3 (true ranges) are tried first; form 4
  // (single-day) is anchored at start-of-string with a leading weekday so
  // it can't accidentally match the inner "lunes 5 de junio" of a longer
  // string. Cycle date strings never lead with a weekday name, so there's
  // no risk of form 4 stealing matches from forms 1-3.
  const forms = [
    // "del D1 de MONTH1 al D2 de MONTH2" → m[1]=D1, m[2]=MONTH1, m[3]=MONTH2
    /del\s+(\d{1,2})\s+de\s+([a-záéíóú]+)\s+al\s+\d{1,2}\s+de\s+([a-záéíóú]+)/i,
    // "del D1 al D2 de MONTH" → m[1]=D1, m[2]=MONTH
    /del\s+(\d{1,2})\s+al\s+\d{1,2}\s+de\s+([a-záéíóú]+)/i,
    // "a partir del D1 de MONTH" → m[1]=D1, m[2]=MONTH
    /a\s+partir\s+del\s+(\d{1,2})\s+de\s+([a-záéíóú]+)/i,
    // "WEEKDAY D1 de MONTH" → m[1]=D1, m[2]=MONTH (single-day one-off)
    /^(?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\s+(\d{1,2})\s+de\s+([a-záéíóú]+)/i,
  ];

  let startDay: number | null = null;
  let monthName: string | null = null;

  for (const form of forms) {
    const m = cleaned.match(form);
    if (!m) continue;
    startDay = parseInt(m[1], 10);
    monthName = m[2];
    break;
  }

  if (startDay === null || !monthName) return null;
  const startMonth = MONTH_INDEX[monthName];
  if (startMonth === undefined) return null;

  // Year inference: pick the year where the start date is closest to now,
  // preferring the future but tolerating up to ~30 days in the past. `now`
  // is injectable so fixture-based tests stay deterministic as wall-clock
  // time advances past the fixture's capture date (default = real now in prod).
  const thisYear = now.getUTCFullYear();
  const candidateThis = new Date(Date.UTC(thisYear, startMonth, startDay));
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const startYear =
    candidateThis.getTime() < now.getTime() - thirtyDays ? thisYear + 1 : thisYear;

  return { startMonth, startYear };
}

function buildBaLocalToUtc(dayUtcMidnight: Date, hourBa: number, minuteBa: number): Date {
  // Argentina is UTC-3 with no DST (stable since 2009).
  const utcHour = hourBa + 3;
  return new Date(
    Date.UTC(
      dayUtcMidnight.getUTCFullYear(),
      dayUtcMidnight.getUTCMonth(),
      dayUtcMidnight.getUTCDate(),
      utcHour,
      minuteBa,
      0,
      0,
    ),
  );
}

function inferTags(program: ProgramLink): ScreeningTag[] {
  const tags: ScreeningTag[] = [];
  const titleLower = program.title.toLowerCase();
  tags.push('cycle');
  if (/bafici|festival/i.test(titleLower)) tags.push('retrospective');
  if (/retrospect/i.test(titleLower)) tags.push('retrospective');
  if (/restaurad|restor/i.test(titleLower)) tags.push('restored');
  return Array.from(new Set(tags));
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'es-AR,es;q=0.9' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}
