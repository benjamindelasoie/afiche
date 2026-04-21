/**
 * MALBA provider.
 *
 * Strategy:
 *   1. Fetch the cartelera listing page:
 *      https://malba.org.ar/cine/
 *   2. Extract cycle tiles by pairing each <h2>TITLE</h2> with the first
 *      /evento/SLUG/ link that follows it (within the next <h2>'s window).
 *   3. For each cycle, fetch the detail page and parse the
 *      <h3>Programación</h3> block when present.
 *   4. Walk the <p> blocks: each <p> is one day. The first line is the day
 *      header ("JUEVES 2" or "VIERNES 1 de mayo"), the rest are showtime
 *      lines ("HH:MM <a>Title</a>, de Director").
 *   5. Emit one ScrapedScreening per (film × day × time).
 *
 * MALBA's format is more regular than Lugones — no state machine needed.
 * Quirks handled:
 *   - Year anchor comes from JSON-LD datePublished on the detail page.
 *     If missing, fall back to the current year.
 *   - Month is explicit on rollover only; otherwise inherit the previous
 *     day's month. No implicit rollovers (MALBA always writes "de MAYO"
 *     when crossing from April to May).
 *   - "24:00" is a valid start time meaning "midnight, end of this day".
 *     We emit it as 00:00 of the NEXT calendar day, in line with how users
 *     think about "Saturday night at midnight" screenings.
 *   - Cycles without a <h3>Programación</h3> block (recurring-schedule
 *     cycles, one-off dated events) are skipped with a warning.
 *
 * Politeness: MALBA rate-limits aggressively (429s on burst). We sleep
 * between detail-page fetches.
 */

import * as cheerio from 'cheerio';
import { type Provider, type ProviderRunResult, type ScrapedScreening } from './types';
import type { ScreeningTag } from '@/db';

const LISTING_URL = 'https://malba.org.ar/cine/';
const DETAIL_BASE = 'https://malba.org.ar/evento/';
const USER_AGENT =
  'Mozilla/5.0 (compatible; AficheScraper/0.1; +https://afiche.ar)';
const DETAIL_DELAY_MS = 500;

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

const DAY_NAMES = [
  'lunes',
  'martes',
  'miércoles',
  'miercoles',
  'jueves',
  'viernes',
  'sábado',
  'sabado',
  'domingo',
];

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export const malbaProvider: Provider = {
  id: 'malba',
  name: 'MALBA',

  async fetch(): Promise<ProviderRunResult> {
    const warnings: string[] = [];
    try {
      const listingHtml = await fetchText(LISTING_URL);
      const cycles = extractCycles(listingHtml);

      if (cycles.length === 0) {
        return {
          cinemaId: this.id,
          screenings: [],
          success: false,
          warnings,
          error: 'No cycles found on listing page — selector likely broke.',
        };
      }

      const screenings: ScrapedScreening[] = [];

      for (const cycle of cycles) {
        try {
          const detailHtml = await fetchText(cycle.detailUrl);
          const parsed = parseDetailPage(detailHtml, cycle, warnings);
          screenings.push(...parsed);
        } catch (err) {
          warnings.push(
            `cycle "${cycle.slug}": ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        await sleep(DETAIL_DELAY_MS);
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
// Step 1 & 2: extract cycle tiles from the listing page
// ---------------------------------------------------------------------------
export interface CycleLink {
  slug: string;
  title: string;
  detailUrl: string;
}

/**
 * Find each <h2>...</h2> and pair it with the first /evento/SLUG/ link
 * that appears in the window between that h2 and the next h2. That pattern
 * matches the Elementor tile layout MALBA uses on /cine/ — the h2 sits at
 * the top of the tile and the buttons (including the "Ver más" link) sit
 * below it, all before the next tile starts.
 */
export function extractCycles(html: string): CycleLink[] {
  const $ = cheerio.load(html);
  const out: CycleLink[] = [];

  // Collect h2 elements with their position in source order (cheerio
  // preserves document order).
  const h2s: { title: string; startIdx: number }[] = [];
  const eventLinks: { slug: string; startIdx: number }[] = [];

  // Walk raw HTML offsets instead of the DOM tree — we need distance
  // between elements, and cheerio doesn't give character offsets. Use
  // global regex matches against the raw HTML string.
  for (const m of html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)) {
    const inner = m[1];
    const plain = cheerio.load(`<root>${inner}</root>`)('root').text().trim();
    if (plain) h2s.push({ title: plain, startIdx: m.index ?? 0 });
  }
  for (const m of html.matchAll(
    /href="https:\/\/malba\.org\.ar\/evento\/([a-z0-9-]+)\/?"/g,
  )) {
    eventLinks.push({ slug: m[1], startIdx: m.index ?? 0 });
  }

  const seen = new Set<string>();
  for (let i = 0; i < h2s.length; i++) {
    const h2 = h2s[i];
    const nextH2Start = i + 1 < h2s.length ? h2s[i + 1].startIdx : html.length;
    // First event link that comes AFTER this h2 and BEFORE the next h2.
    const link = eventLinks.find(
      (l) => l.startIdx > h2.startIdx && l.startIdx < nextH2Start,
    );
    if (!link) continue;
    if (seen.has(link.slug)) continue;
    seen.add(link.slug);
    out.push({
      slug: link.slug,
      title: h2.title,
      detailUrl: `${DETAIL_BASE}${link.slug}/`,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Step 3 & 4: parse a single cycle's detail page into screenings
// ---------------------------------------------------------------------------

interface DayContext {
  year: number;
  month: number; // 0-11
  day: number;
}

export function parseDetailPage(
  html: string,
  cycle: CycleLink,
  warnings: string[],
): ScrapedScreening[] {
  const $ = cheerio.load(html);

  // Locate the Programación block: <h3>Programación</h3> followed by <p>
  // siblings until something breaks the pattern. We iterate .nextUntil()
  // to capture all day <p>s cleanly.
  const $h3 = $('h3')
    .filter((_i, el) => {
      const t = $(el).text().trim().toLowerCase();
      return t === 'programación' || t === 'programacion';
    })
    .first();
  if ($h3.length === 0) {
    warnings.push(
      `cycle "${cycle.slug}": no <h3>Programación</h3> block (likely recurring-schedule or one-off cycle)`,
    );
    return [];
  }

  // Year anchor: JSON-LD datePublished.
  const anchorYear = extractAnchorYear(html) ?? new Date().getUTCFullYear();

  const screenings: ScrapedScreening[] = [];
  let currentMonth: number | null = null;
  let currentYear: number = anchorYear;
  let firstRolloverHandled = false;
  // Buffer day <p> content we haven't yet been able to place (because we
  // haven't seen a month name). We'll backfill month once the first
  // rollover reveals it.
  const pendingDayBlocks: Array<{
    day: number;
    shows: Array<{ hour: number; minute: number; title: string; director: string }>;
  }> = [];

  const dayParagraphs: string[] = [];
  $h3
    .nextAll('p')
    .each((_i, el) => {
      // Stop collecting once we hit a <p> that contains the "Comprar entradas"
      // button or that has no day-header shape at all — those are the
      // sibling trailers after Programación.
      const $p = $(el);
      const text = $p.text().trim();
      const looksLikeDay = matchDayHeader(splitFirstLine(text).first);
      const hasDecidirLink =
        $p.find('a[href*="liit.com.ar/decidir"]').length > 0 ||
        /comprar entradas/i.test(text);
      if (!looksLikeDay || hasDecidirLink) {
        // Not a day <p>. If we've already collected some, stop — anything
        // further is footer material.
        if (dayParagraphs.length > 0) return false; // break out of .each()
        return; // skip but keep looking
      }
      dayParagraphs.push($.html($p));
    });

  for (const pHtml of dayParagraphs) {
    const block = parseDayParagraph(pHtml, warnings, cycle);
    if (!block) continue;

    if (block.monthName) {
      const m = MONTH_INDEX[block.monthName.toLowerCase()];
      if (m !== undefined) {
        if (currentMonth !== null && m < currentMonth) {
          currentYear += 1;
        }
        if (
          currentMonth === null &&
          !firstRolloverHandled &&
          pendingDayBlocks.length > 0
        ) {
          // First time we learn the month. Everything buffered up to
          // now is the PREVIOUS month (one rollback step). For MALBA,
          // cycles typically span at most 2 calendar months.
          const prevMonth = (m - 1 + 12) % 12;
          const yearOfPrev = m === 0 ? currentYear - 1 : currentYear;
          for (const pending of pendingDayBlocks) {
            emitBlock(
              { year: yearOfPrev, month: prevMonth, day: pending.day },
              pending,
              cycle,
              screenings,
            );
          }
          pendingDayBlocks.length = 0;
          firstRolloverHandled = true;
        }
        currentMonth = m;
      }
    }

    if (currentMonth === null) {
      // No month seen yet; buffer.
      pendingDayBlocks.push({ day: block.day, shows: block.shows });
      continue;
    }

    emitBlock(
      { year: currentYear, month: currentMonth, day: block.day },
      block,
      cycle,
      screenings,
    );
  }

  // If we never saw a month at all, fall back to description heuristic:
  // scan the detail page text for the first month name and use that.
  if (pendingDayBlocks.length > 0 && currentMonth === null) {
    const fallbackMonth = findFirstMonthInText($.text());
    if (fallbackMonth !== null) {
      for (const pending of pendingDayBlocks) {
        emitBlock(
          { year: anchorYear, month: fallbackMonth, day: pending.day },
          pending,
          cycle,
          screenings,
        );
      }
    } else {
      warnings.push(
        `cycle "${cycle.slug}": could not infer month from Programación block or description text`,
      );
    }
  }

  if (screenings.length === 0) {
    warnings.push(
      `cycle "${cycle.slug}": 0 screenings parsed from ${dayParagraphs.length} day paragraph(s)`,
    );
  }

  return screenings;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

interface DayBlock {
  day: number;
  monthName?: string;
  shows: Array<{ hour: number; minute: number; title: string; director: string }>;
}

function parseDayParagraph(
  pHtml: string,
  warnings: string[],
  cycle: CycleLink,
): DayBlock | null {
  const $ = cheerio.load(`<root>${pHtml}</root>`);
  const $p = $('p').first();
  if ($p.length === 0) return null;

  // Split the paragraph's text on <br> boundaries. cheerio normalizes
  // <br /> to <br>, but we still need to walk the HTML to find line
  // boundaries reliably.
  const rawInner = $p.html() ?? '';
  const lines = rawInner.split(/<br\s*\/?>/i).map((s) => s.trim());

  if (lines.length === 0) return null;

  // First line = day header.
  const firstText = cheerio
    .load(`<root>${lines[0]}</root>`)('root')
    .text()
    .trim();
  const dayMatch = matchDayHeader(firstText);
  if (!dayMatch) return null;

  const shows: DayBlock['shows'] = [];
  for (let i = 1; i < lines.length; i++) {
    const lineHtml = lines[i];
    if (!lineHtml) continue;
    const show = parseShowtimeLine(lineHtml);
    if (show) shows.push(show);
    else {
      const textOnly = cheerio
        .load(`<root>${lineHtml}</root>`)('root')
        .text()
        .trim();
      if (textOnly) {
        warnings.push(
          `cycle "${cycle.slug}" day ${dayMatch.day}: unparseable line "${textOnly.slice(0, 80)}"`,
        );
      }
    }
  }

  return {
    day: dayMatch.day,
    monthName: dayMatch.monthName,
    shows,
  };
}

function parseShowtimeLine(
  lineHtml: string,
): { hour: number; minute: number; title: string; director: string } | null {
  // Typical line: "19:00 <a href="...">Title</a>, de Director"
  // Occasionally: "19:00 Title, de Director"  (no link)
  const $ = cheerio.load(`<root>${lineHtml}</root>`);
  const text = $('root').text().trim().replace(/\s+/g, ' ');
  const m = text.match(/^(\d{1,2}):(\d{2})\s+(.+?),\s+de\s+(.+?)$/);
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;
  return {
    hour,
    minute,
    title: m[3].trim(),
    director: m[4].replace(/\.$/, '').trim(),
  };
}

function matchDayHeader(
  text: string,
): { day: number; monthName?: string } | null {
  const cleaned = text
    .toLowerCase()
    .replace(/[°º]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // "JUEVES 2" — bare
  // "VIERNES 1 DE MAYO" — with month
  const dayAlt = DAY_NAMES.map((d) => d.replace(/[̀-ͯ]/g, '')).join('|');
  // Pattern uses a looser day-name charclass to handle accented spellings.
  const withMonth = cleaned.match(
    new RegExp(
      `^(${dayAlt}|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\\s+(\\d{1,2})\\s+de\\s+([a-záéíóú]+)$`,
      'i',
    ),
  );
  if (withMonth) {
    return { day: parseInt(withMonth[2], 10), monthName: withMonth[3] };
  }
  const withoutMonth = cleaned.match(
    new RegExp(
      `^(${dayAlt}|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\\s+(\\d{1,2})$`,
      'i',
    ),
  );
  if (withoutMonth) {
    return { day: parseInt(withoutMonth[2], 10) };
  }
  return null;
}

function findFirstMonthInText(text: string): number | null {
  const cleaned = text.toLowerCase();
  let first: { idx: number; month: number } | null = null;
  for (const [name, idx] of Object.entries(MONTH_INDEX)) {
    const pos = cleaned.indexOf(name);
    if (pos >= 0 && (first === null || pos < first.idx)) {
      first = { idx: pos, month: idx };
    }
  }
  return first?.month ?? null;
}

function extractAnchorYear(html: string): number | null {
  // Prefer JSON-LD datePublished (most reliable).
  const jsonLdBlocks = [...html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
  )];
  for (const m of jsonLdBlocks) {
    const body = m[1];
    const dp = body.match(/"datePublished"\s*:\s*"(\d{4})-/);
    if (dp) return parseInt(dp[1], 10);
  }
  // Fallback: article:published_time meta.
  const meta = html.match(
    /<meta[^>]*property="article:published_time"[^>]*content="(\d{4})-/,
  );
  if (meta) return parseInt(meta[1], 10);
  return null;
}

function splitFirstLine(text: string): { first: string; rest: string } {
  const i = text.indexOf('\n');
  if (i < 0) return { first: text, rest: '' };
  return { first: text.slice(0, i).trim(), rest: text.slice(i + 1) };
}

function emitBlock(
  ctx: DayContext,
  block: Pick<DayBlock, 'shows'>,
  cycle: CycleLink,
  out: ScrapedScreening[],
): void {
  for (const show of block.shows) {
    const startsAt = buildBaLocalToUtc(
      ctx.year,
      ctx.month,
      ctx.day,
      show.hour,
      show.minute,
    );
    out.push({
      cinemaId: 'malba',
      filmTitle: show.title,
      director: show.director,
      startsAtUtc: startsAt,
      tags: inferTags(cycle),
      sourceUrl: cycle.detailUrl,
    });
  }
}

/**
 * Build a UTC Date from BA local (year, month, day, hour, minute).
 * Argentina is UTC-3 with no DST (stable since 2009). Hour 24 means
 * "midnight at the end of this day" → advance the calendar date by 1
 * and use hour 0 locally.
 */
function buildBaLocalToUtc(
  year: number,
  month: number,
  day: number,
  hourBa: number,
  minuteBa: number,
): Date {
  let y = year;
  let m = month;
  let d = day;
  let hLocal = hourBa;
  if (hourBa === 24) {
    hLocal = 0;
    // Advance one calendar day in BA local.
    const next = new Date(Date.UTC(year, month, day + 1));
    y = next.getUTCFullYear();
    m = next.getUTCMonth();
    d = next.getUTCDate();
  }
  const utcHour = hLocal + 3;
  return new Date(Date.UTC(y, m, d, utcHour, minuteBa, 0, 0));
}

function inferTags(cycle: CycleLink): ScreeningTag[] {
  const tags: ScreeningTag[] = ['cycle'];
  const title = cycle.title.toLowerCase();
  if (/retrospect/i.test(title)) tags.push('retrospective');
  if (/restaurad|restor/i.test(title)) tags.push('restored');
  return Array.from(new Set(tags));
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'es-AR,es;q=0.9',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
