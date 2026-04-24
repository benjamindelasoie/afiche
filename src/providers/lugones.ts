/**
 * Sala Leopoldo Lugones provider.
 *
 * Strategy:
 *   1. Fetch the main Lugones listing page:
 *      https://complejoteatral.gob.ar/sala-leopoldo-lugones
 *   2. For each `list-item-programacion` div tagged with genre 'cine',
 *      extract the program slug and detail URL (format: /ver/{slug}).
 *   3. Fetch each detail page, parse the
 *      `div.details.roboto_condensed > div:first-child` block.
 *   4. Walk through that block as a sequence of <p> tags using a small
 *      state machine and extract day headers, time markers, film titles,
 *      and metadata.
 *   5. Emit one ScrapedScreening per (film, day, time) combination.
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
  | { kind: 'with-time'; times: number[]; film: FilmContext }
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
): ScrapedScreening[] {
  const $ = cheerio.load(html);

  const $block = $('div.details.roboto_condensed > div').first();
  if ($block.length === 0) {
    warnings.push(`program "${program.slug}": details block not found`);
    return [];
  }

  const rangeInfo = parseDateRange(program.dateRangeText);
  if (!rangeInfo) {
    warnings.push(
      `program "${program.slug}": could not parse date range "${program.dateRangeText}"`,
    );
    return [];
  }

  const screenings: ScrapedScreening[] = [];

  let currentDay: Date | null = null;
  let currentMonth = rangeInfo.startMonth;
  let currentYear = rangeInfo.startYear;
  let state: ParseState = { kind: 'idle' };

  /** Emit screenings for the current time-bound film, if any. */
  const emit = (s: ParseState) => {
    if (s.kind !== 'with-time') return;
    if (!s.film.title || !currentDay) return;
    for (const hour of s.times) {
      screenings.push({
        cinemaId: 'lugones',
        filmTitle: s.film.title,
        filmTitleOriginal: s.film.titleOriginal,
        director: s.film.director,
        year: s.film.year,
        country: s.film.country,
        runtimeMin: s.film.runtimeMin,
        startsAtUtc: buildBaLocalToUtc(currentDay, hour, 0),
        tags: inferTags(program),
        synopsisEs: s.film.synopsis,
        sourceUrl: program.detailUrl,
      });
    }
  };

  $block.children('p').each((_i, p) => {
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
    // not the cast line, not parenthesized metadata.
    const looksLikeQuote = /^["“]/.test(text) || text.startsWith('(');
    if (
      !looksLikeQuote &&
      !film.synopsis &&
      !text.startsWith('Con ') &&
      !/^Dirección:/i.test(text) &&
      text.length > 40
    ) {
      film.synopsis = text.length > 280 ? text.slice(0, 277) + '…' : text;
    }
  });

  // End of block — emit any trailing film.
  emit(state);

  if (screenings.length === 0) {
    warnings.push(
      `program "${program.slug}": 0 screenings parsed from ${$block.children('p').length} <p> tags. ` +
        'Detail page may use a non-standard layout (e.g. no per-day listings, merged day+time lines, or external schedule link).',
    );
  }

  return screenings;
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

function matchTimeMarker(text: string): number[] | null {
  const m = text.match(/^A las (\d{1,2})(?:\s+y\s+(\d{1,2}))?\s+horas?/i);
  if (!m) return null;
  const out: number[] = [parseInt(m[1], 10)];
  if (m[2]) out.push(parseInt(m[2], 10));
  return out.filter((h) => h >= 0 && h <= 23);
}

/**
 * Parse the program's date range string to determine the starting month + year.
 * Handles three forms seen in Lugones programming:
 *   1. "Del 28 de abril al 5 de mayo"     → different months
 *   2. "Del 15 al 26 de abril"            → same month
 *   3. "A partir del 7 de mayo"           → open-ended
 */
export function parseDateRange(
  text: string,
): { startMonth: number; startYear: number } | null {
  const cleaned = text.toLowerCase().replace(/[°º]/g, '').trim();

  // Each form captures [startDay, startMonth, ...]. Group 2 is always the
  // start month — the month name that goes with the START day, which is the
  // one we anchor the parser on. Form 1 has a trailing end-month group that
  // we intentionally discard.
  const forms = [
    // "del D1 de MONTH1 al D2 de MONTH2" → m[1]=D1, m[2]=MONTH1, m[3]=MONTH2
    /del\s+(\d{1,2})\s+de\s+([a-záéíóú]+)\s+al\s+\d{1,2}\s+de\s+([a-záéíóú]+)/i,
    // "del D1 al D2 de MONTH" → m[1]=D1, m[2]=MONTH
    /del\s+(\d{1,2})\s+al\s+\d{1,2}\s+de\s+([a-záéíóú]+)/i,
    // "a partir del D1 de MONTH" → m[1]=D1, m[2]=MONTH
    /a\s+partir\s+del\s+(\d{1,2})\s+de\s+([a-záéíóú]+)/i,
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
  // preferring the future but tolerating up to ~30 days in the past.
  const now = new Date();
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
