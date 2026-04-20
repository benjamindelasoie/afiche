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
 *   4. Walk through that block as a sequence of <p> tags and extract
 *      day headers, time markers, film titles, and metadata.
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
const USER_AGENT =
  'Mozilla/5.0 (compatible; AficheScraper/0.1; +https://afiche.ar)';

// Spanish weekday → weekday index (0 = Sunday, 6 = Saturday)
const WEEKDAY_INDEX: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miércoles: 3,
  miercoles: 3, // tolerate missing accent
  jueves: 4,
  viernes: 5,
  sábado: 6,
  sabado: 6,
};

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
interface ProgramLink {
  slug: string;           // URL slug, e.g. 'Boris-Karloff:-el-hombre-y-la-bestia - Parte 2'
  title: string;          // program title as shown ('Boris Karloff: el hombre y la bestia - Parte 2')
  dateRangeText: string;  // 'Del 28 de abril al 5 de mayo'
  detailUrl: string;
}

function extractPrograms(html: string): ProgramLink[] {
  const $ = cheerio.load(html);
  const out: ProgramLink[] = [];

  $('.list-item-programacion').each((_i, el) => {
    const $el = $(el);

    // Filter to the 'cine' genre — each list-item has an embedded JSON blob
    // describing its genre. We check for "nombre":"cine" in the rendered text.
    const genreJson = $el.find('div[style*="display:none"]').first().text();
    if (!genreJson.includes('"nombre":"cine"')) return;

    const title = $el.find('h2').first().text().trim();
    const dateRangeText = $el.find('.date').first().text().trim().replace(/\s+/g, ' ');

    // Detail link: first "+ info" anchor that points at /ver/...
    const href = $el
      .find('a[href*="/ver/"]')
      .first()
      .attr('href');

    if (!title || !href) return;

    // The slug is the part of the URL after /ver/. It's URL-encoded (e.g. %20).
    // We keep the ENCODED form as the slug (for our refetches) but decode for display.
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
function parseDetailPage(
  html: string,
  program: ProgramLink,
  warnings: string[],
): ScrapedScreening[] {
  const $ = cheerio.load(html);

  // The details block contains one giant prose column with day headers,
  // time markers, and film metadata all as <p> tags.
  const $block = $('div.details.roboto_condensed > div').first();
  if ($block.length === 0) {
    warnings.push(`program "${program.slug}": details block not found`);
    return [];
  }

  // Resolve the program's starting month/year from the date range text.
  // "Del 28 de abril al 5 de mayo" → startMonth = April (3), year inferred.
  const rangeInfo = parseDateRange(program.dateRangeText);
  if (!rangeInfo) {
    warnings.push(
      `program "${program.slug}": could not parse date range "${program.dateRangeText}"`,
    );
    return [];
  }

  // Walk through <p> tags in order. Track the current day and current times.
  const screenings: ScrapedScreening[] = [];

  let currentDay: Date | null = null; // the current day's calendar date (BA midnight)
  let currentMonth = rangeInfo.startMonth;
  let currentYear = rangeInfo.startYear;
  let pendingTimes: number[] = []; // e.g. [15, 21] awaiting a film title
  let pendingContext: FilmContext | null = null; // accumulator for film metadata

  const flushPending = () => {
    if (pendingContext && pendingTimes.length > 0 && currentDay) {
      for (const hour of pendingTimes) {
        const startsAtUtc = buildBaLocalToUtc(currentDay, hour, 0);
        screenings.push({
          cinemaId: 'lugones',
          filmTitle: pendingContext.title,
          filmTitleOriginal: pendingContext.titleOriginal,
          director: pendingContext.director,
          year: pendingContext.year,
          country: pendingContext.country,
          runtimeMin: pendingContext.runtimeMin,
          startsAtUtc,
          tags: inferTags(program),
          synopsisEs: pendingContext.synopsis,
          sourceUrl: program.detailUrl,
        });
      }
    }
    pendingContext = null;
    pendingTimes = [];
  };

  $block.children('p').each((_i, p) => {
    const text = $(p).text().trim().replace(/\s+/g, ' ');
    if (!text || text === '\u00a0') return; // skip empty / &nbsp;

    // --- Day header? "Martes 28" or "Viernes 1° de mayo" ---
    const dayMatch = matchDayHeader(text);
    if (dayMatch) {
      flushPending();
      if (dayMatch.monthName) {
        const m = MONTH_INDEX[dayMatch.monthName.toLowerCase()];
        if (m !== undefined) {
          // Month rolled forward within the program range (e.g. April → May)
          if (m < currentMonth) currentYear += 1;
          currentMonth = m;
        }
      }
      currentDay = new Date(Date.UTC(currentYear, currentMonth, dayMatch.day));
      return;
    }

    // --- "No hay funciones" — day header already set but no screenings ---
    if (/^no hay funciones/i.test(text)) {
      flushPending();
      return;
    }

    // --- Time marker? "A las 15 y 21 horas" or "A las 18 horas" ---
    const times = matchTimeMarker(text);
    if (times) {
      // Flush the previous film before starting a new one (if any)
      if (pendingContext) flushPending();
      pendingTimes = times;
      pendingContext = { title: '', synopsis: '' };
      return;
    }

    if (!pendingContext) {
      // Not inside a film block — ignore (could be intro prose).
      return;
    }

    // --- Film title: green-colored strong text (the first one) ---
    const $p = $(p);
    const $greenStrong = $p.find('span[style*="#008000"] strong').first();
    if ($greenStrong.length > 0 && !pendingContext.title) {
      pendingContext.title = $greenStrong.text().trim();
      return;
    }

    // --- Original title / country / year line ---
    // Pattern: "(<em>Son of Frankenstein</em>; EE.UU; 1939)"
    if (!pendingContext.titleOriginal) {
      const $em = $p.find('em').first();
      const metaMatch = text.match(/^\(([^;]+);\s*([^;]+);\s*(\d{4})\)$/);
      if (metaMatch && $em.length > 0) {
        pendingContext.titleOriginal = $em.text().trim();
        pendingContext.country = metaMatch[2].trim();
        pendingContext.year = parseInt(metaMatch[3], 10);
        return;
      }
    }

    // --- Director line ---
    if (/^Dirección:/i.test(text) && !pendingContext.director) {
      pendingContext.director = text.replace(/^Dirección:\s*/i, '').replace(/\.$/, '').trim();
      return;
    }

    // --- Runtime + format line: "(99'; DM)." or "(A las 18 horas) (73'; DM)." ---
    const runtimeMatch = text.match(/\((\d+)\s*[′']\s*;\s*[A-Z]+\)/);
    if (runtimeMatch && !pendingContext.runtimeMin) {
      pendingContext.runtimeMin = parseInt(runtimeMatch[1], 10);
      // Don't return — the paragraph might have other content too.
    }

    // --- Synopsis accumulation (optional; keep only the first non-quote paragraph) ---
    const looksLikeQuote = /^["“]/.test(text) || text.startsWith('(');
    if (
      !looksLikeQuote &&
      pendingContext.title &&
      !pendingContext.synopsis &&
      !text.startsWith('Con ') &&
      !/^Dirección:/i.test(text) &&
      text.length > 40
    ) {
      pendingContext.synopsis = text.length > 280 ? text.slice(0, 277) + '…' : text;
    }
  });

  flushPending();
  return screenings;
}

interface FilmContext {
  title: string;
  titleOriginal?: string;
  director?: string;
  year?: number;
  country?: string;
  runtimeMin?: number;
  synopsis?: string;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Matches "Martes 28", "Viernes 1° de mayo", "Sábado 2", etc.
 * Returns { day: number, monthName?: string } or null.
 */
function matchDayHeader(text: string): { day: number; monthName?: string } | null {
  const cleaned = text.toLowerCase().replace(/[°º]/g, '').trim();
  // "viernes 1 de mayo"
  const withMonth = cleaned.match(/^(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\s+(\d{1,2})\s+de\s+([a-záéíóú]+)$/i);
  if (withMonth) {
    return { day: parseInt(withMonth[2], 10), monthName: withMonth[3] };
  }
  // "martes 28"
  const withoutMonth = cleaned.match(/^(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\s+(\d{1,2})$/i);
  if (withoutMonth) {
    return { day: parseInt(withoutMonth[2], 10) };
  }
  return null;
}

/**
 * Matches "A las 15 horas", "A las 15 y 21 horas", "A las 18 horas (73'; DM)"
 * Returns array of hours or null.
 */
function matchTimeMarker(text: string): number[] | null {
  const m = text.match(/^A las (\d{1,2})(?:\s+y\s+(\d{1,2}))?\s+horas?/i);
  if (!m) return null;
  const out: number[] = [parseInt(m[1], 10)];
  if (m[2]) out.push(parseInt(m[2], 10));
  return out.filter((h) => h >= 0 && h <= 23);
}

/**
 * Parse "Del 28 de abril al 5 de mayo" → { startMonth, startYear }.
 * Year is inferred as "the next occurrence from now" (always in the future or very recent past).
 */
function parseDateRange(
  text: string,
): { startMonth: number; startYear: number } | null {
  const m = text
    .toLowerCase()
    .replace(/[°º]/g, '')
    .match(/del\s+(\d{1,2})\s+de\s+([a-záéíóú]+)(?:\s+al\s+\d{1,2}\s+de\s+([a-záéíóú]+))?/i);
  if (!m) return null;
  const startMonth = MONTH_INDEX[m[2]];
  if (startMonth === undefined) return null;

  // Guess year by proximity to today: pick the year such that the start date
  // is closest to now (prefer future, tolerate up to ~30 days in the past).
  const now = new Date();
  const thisYear = now.getUTCFullYear();
  const candidateThis = new Date(Date.UTC(thisYear, startMonth, parseInt(m[1], 10)));
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const startYear =
    candidateThis.getTime() < now.getTime() - thirtyDays ? thisYear + 1 : thisYear;

  return { startMonth, startYear };
}

/**
 * Convert (BA-local date + hour + minute) to a UTC Date.
 * BA is UTC-3 with no DST, so BA-local time + 3h = UTC.
 * (Argentina doesn't observe DST; been stable since 2009.)
 */
function buildBaLocalToUtc(
  dayUtcMidnight: Date,
  hourBa: number,
  minuteBa: number,
): Date {
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

/** Mark Lugones screenings with cycle/retrospective tags when appropriate. */
function inferTags(program: ProgramLink): ScreeningTag[] {
  const tags: ScreeningTag[] = [];
  const titleLower = program.title.toLowerCase();

  // Most Lugones programming is ciclo-style; flag it so the UI can surface it.
  tags.push('cycle');

  if (/bafici|festival/i.test(titleLower)) {
    // BAFICI entries are festival screenings — treat as retrospective visually.
    tags.push('retrospective');
  }
  if (/retrospect/i.test(titleLower)) tags.push('retrospective');
  if (/restaurad|restor/i.test(titleLower)) tags.push('restored');

  return Array.from(new Set(tags));
}

// ---------------------------------------------------------------------------
// Networking
// ---------------------------------------------------------------------------
async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'es-AR,es;q=0.9' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.text();
}
