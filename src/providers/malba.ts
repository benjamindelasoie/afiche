/**
 * MALBA provider.
 *
 * MALBA's detail pages come in several layouts. We try strategies in order:
 *
 *   S1 — DENSE-CYCLE (e.g. Olivera-Aries)
 *     <h3>Programación</h3> followed by one <p> per day. Each <p> has a
 *     day header line ("JUEVES 2" or "VIERNES 1 de mayo") and showtime
 *     lines ("HH:MM <a>Title</a>, de Director").
 *
 *   S2 — SINGLE-EVENT / GROUPED-TIMES (e.g. El Diablo viste a la moda 2)
 *     No <h3>Programación</h3>. The schedule is prose inside a text-editor
 *     widget, with a single date and multiple comma-separated times:
 *       "Miércoles 29 de abril a las 17:45, 21:00 y 24:00"
 *     Film title defaults to the page's <h1>. Director unknown unless it
 *     appears inline ("de Director Name").
 *
 *   S3 — RECURRING-WEEKLY (e.g. Hijo mayor, "Sábados a las 18:00")
 *     Not yet implemented. See TODOS.md #3.
 *
 * The parser tries S1. If S1 returns zero screenings, it falls through to
 * S2. If S2 also returns zero, a warning is emitted and the cycle is
 * skipped. Production warnings surface which cycles still don't parse so
 * we know when to build S3.
 *
 * Shared semantics:
 *   - Year anchor: JSON-LD datePublished on the detail page. Falls back
 *     to the current year if missing.
 *   - "24:00" = midnight at the END of the given day (rolls the calendar
 *     date forward by 1 and uses 00:00 locally).
 *   - Argentina is UTC-3, no DST (stable since 2009).
 *
 * Politeness: MALBA rate-limits aggressively (429s on burst). We sleep
 * 500ms between detail-page fetches.
 */

import * as cheerio from 'cheerio';
import { type Provider, type ProviderRunResult, type ScrapedScreening } from './types';
import type { ScreeningTag } from '@/db';

const LISTING_URL = 'https://malba.org.ar/cine/';
const DETAIL_BASE = 'https://malba.org.ar/evento/';
// See lugones.ts comment — realistic browser UA for GH runner IPs.
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
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

      // Per-film detail pages — fetch each unique /evento/<film>/ URL once
      // and attach its editorial synopsis to every showtime that shares it.
      // The cycle URL stays as sourceUrl so the click target is unchanged.
      await enrichFromFilmDetailPages(screenings, warnings);

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
  const out: CycleLink[] = [];

  const h2s: { title: string; startIdx: number }[] = [];
  const eventLinks: { slug: string; startIdx: number }[] = [];

  // Walk raw HTML offsets instead of the DOM tree — we need distance
  // between elements, and cheerio doesn't give character offsets. Inner
  // h2 markup still gets cheerio-parsed per-match below for clean text.
  // Use global regex matches against the raw HTML string.
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
  const anchorYear = extractAnchorYear(html) ?? new Date().getUTCFullYear();

  // --- Strategy 1: dense-cycle (h3 Programación + per-day <p>s) ----------
  const s1 = parseS1DenseCycle($, cycle, anchorYear, warnings);
  if (s1.length > 0) return s1;

  // --- Strategy 2: single-event / grouped-times (prose schedule line) ----
  const s2 = parseS2SingleEvent($, cycle, anchorYear, warnings);
  if (s2.length > 0) return s2;

  warnings.push(
    `cycle "${cycle.slug}": no schedule recognized (tried dense-cycle + single-event strategies; likely recurring-weekly, see TODOS.md #3)`,
  );
  return [];
}

/**
 * Strategy 1 — dense-cycle. Returns [] if the page doesn't have a
 * <h3>Programación</h3> block or the block yields no parseable days.
 */
function parseS1DenseCycle(
  $: cheerio.CheerioAPI,
  cycle: CycleLink,
  anchorYear: number,
  warnings: string[],
): ScrapedScreening[] {
  const $h3 = $('h3')
    .filter((_i, el) => {
      const t = $(el).text().trim().toLowerCase();
      return t === 'programación' || t === 'programacion';
    })
    .first();
  if ($h3.length === 0) return [];

  const screenings: ScrapedScreening[] = [];
  let currentMonth: number | null = null;
  let currentYear: number = anchorYear;
  let firstRolloverHandled = false;
  // Buffer day <p> content we haven't yet been able to place (because we
  // haven't seen a month name). We'll backfill month once the first
  // rollover reveals it.
  const pendingDayBlocks: Array<{
    day: number;
    shows: Array<{ hour: number; minute: number; title: string; director?: string }>;
  }> = [];

  const dayParagraphs: string[] = [];
  $h3.nextAll('p').each((_i, el) => {
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
// Strategy 2 — single-event / grouped-times
// ---------------------------------------------------------------------------
//
// MALBA uses Elementor with auto-generated per-page hashes in class names,
// so structural descent isn't portable across cycles. Instead we lean on the
// schedule's distinctive grammar:
//
//     "Miércoles 29 de abril a las 17:45, 21:00 y 24:00"
//
// The "a las HH:MM" anchor rarely appears in synopsis prose, so a regex
// against the full event-body text has low false-positive risk. If more
// variants appear in production, they'll surface as warnings via the top-
// level "no schedule recognized" path and we add regex cases here.
//
const S2_SCHEDULE_RE = new RegExp(
  // Day name (with or without accents)
  '(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\\s+' +
    // Day number
    '(\\d{1,2})\\s+de\\s+' +
    // Month name
    '([a-záéíóú]+)\\s+' +
    // Anchor
    'a\\s+las\\s+' +
    // Time list: one or more HH:MM separated by ", " / " y " / " e "
    '((?:\\d{1,2}:\\d{2})(?:\\s*(?:,|\\sy\\s|\\se\\s)\\s*\\d{1,2}:\\d{2})*)',
  'gi',
);

export function parseS2SingleEvent(
  $: cheerio.CheerioAPI,
  cycle: CycleLink,
  anchorYear: number,
  warnings: string[],
): ScrapedScreening[] {
  // Event title: the page's first <h1> (same as the cycle title in practice,
  // but we pull it fresh in case the listing title was truncated).
  const eventTitle = ($('h1').first().text().trim() || cycle.title).trim();

  // Scope the text search to the event article body if we can find it. The
  // site wraps events in <main> or a similar container; falling back to
  // body text is fine because header/footer prose doesn't look like the
  // schedule grammar.
  const $scope = $('main').first().length > 0 ? $('main').first() : $('body').first();
  const text = $scope.text().replace(/\s+/g, ' ').trim();

  const screenings: ScrapedScreening[] = [];
  for (const m of text.matchAll(S2_SCHEDULE_RE)) {
    const dayNum = parseInt(m[2], 10);
    const monthName = m[3].toLowerCase();
    const month = MONTH_INDEX[monthName];
    if (month === undefined) {
      warnings.push(
        `cycle "${cycle.slug}": S2 saw unknown month "${monthName}" in "${m[0].slice(0, 80)}"`,
      );
      continue;
    }
    const times = parseS2TimeList(m[4]);
    if (times.length === 0) {
      warnings.push(`cycle "${cycle.slug}": S2 parsed 0 times from "${m[4]}"`);
      continue;
    }
    for (const { hour, minute } of times) {
      const startsAt = buildBaLocalToUtc(anchorYear, month, dayNum, hour, minute);
      screenings.push({
        cinemaId: 'malba',
        filmTitle: eventTitle,
        startsAtUtc: startsAt,
        tags: inferTags(cycle),
        sourceUrl: cycle.detailUrl,
        // programName intentionally omitted in S2: in single-event mode,
        // cycle.title === eventTitle === filmTitle, so a pill would just
        // echo the film title. Per design doc 2026-04-25 ARCH-2: redundant
        // pill is worse than no pill.
      });
    }
  }

  return screenings;
}

/**
 * Split "17:45, 21:00 y 24:00" into parsed HH:MM tuples.
 * Accepts commas, " y ", and " e " as separators.
 */
function parseS2TimeList(raw: string): Array<{ hour: number; minute: number }> {
  const chunks = raw.split(/\s*(?:,|\sy\s|\se\s)\s*/);
  const out: Array<{ hour: number; minute: number }> = [];
  for (const chunk of chunks) {
    const m = chunk.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) continue;
    const hour = parseInt(m[1], 10);
    const minute = parseInt(m[2], 10);
    if (hour < 0 || hour > 24 || minute < 0 || minute > 59) continue;
    out.push({ hour, minute });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

interface DayBlock {
  day: number;
  monthName?: string;
  shows: Array<{
    hour: number;
    minute: number;
    title: string;
    director?: string;
    /** /evento/<film-slug>/ from the showtime line's <a> when present. */
    filmHref?: string;
  }>;
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
  const firstText = cheerio.load(`<root>${lines[0]}</root>`)('root').text().trim();
  const dayMatch = matchDayHeader(firstText);
  if (!dayMatch) return null;

  const shows: DayBlock['shows'] = [];
  for (let i = 1; i < lines.length; i++) {
    const lineHtml = lines[i];
    if (!lineHtml) continue;
    const show = parseShowtimeLine(lineHtml);
    if (show) shows.push(show);
    else {
      const textOnly = cheerio.load(`<root>${lineHtml}</root>`)('root').text().trim();
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

function parseShowtimeLine(lineHtml: string): {
  hour: number;
  minute: number;
  title: string;
  director?: string;
  filmHref?: string;
} | null {
  // Typical line:  "19:00 <a href="...">Title</a>, de Director"
  // Occasionally:  "19:00 Title, de Director"       (no link)
  // Director-less: "24:00 Terciopelo azul"          (cycle-all-one-director,
  //                MALBA drops the ", de X" on midnight repeats — e.g. the
  //                david-lynch-x5 Saturday midnights).
  const $ = cheerio.load(`<root>${lineHtml}</root>`);
  const text = $('root').text().trim().replace(/\s+/g, ' ');
  const m = text.match(/^(\d{1,2}):(\d{2})\s+(.+?)(?:,\s+de\s+(.+?))?$/);
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;
  const director = m[4]?.replace(/\.$/, '').trim();
  // Capture the per-film href when the line wraps the title in an <a>.
  // MALBA's showtime lines link to /evento/<film-slug>/ for individual
  // films; midnight repeats and a few prose-style lines have no link.
  const rawHref = $('a').first().attr('href');
  const filmHref =
    rawHref && /^https:\/\/malba\.org\.ar\/evento\/[a-z0-9-]+\/?$/.test(rawHref)
      ? rawHref
      : undefined;
  return {
    hour,
    minute,
    title: m[3].trim(),
    ...(director ? { director } : {}),
    ...(filmHref ? { filmHref } : {}),
  };
}

function matchDayHeader(text: string): { day: number; monthName?: string } | null {
  const cleaned = text.toLowerCase().replace(/[°º]/g, '').replace(/\s+/g, ' ').trim();
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
  const jsonLdBlocks = [
    ...html.matchAll(
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
    ),
  ];
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
      ...(show.director ? { director: show.director } : {}),
      startsAtUtc: startsAt,
      tags: inferTags(cycle),
      sourceUrl: cycle.detailUrl,
      // S1 dense-cycle layout: cycle.title is the curatorial program
      // (e.g. "Retrospectiva David Lynch"), distinct from each
      // show.title. Persists as the ProgramPill's text on the cartelera.
      programName: cycle.title,
      // Per-film URL stored separately so the cycle URL stays the click
      // target. enrichFromFilmDetailPages() reads this for synopsis fetches.
      ...(show.filmHref ? { filmDetailUrl: show.filmHref } : {}),
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

// ---------------------------------------------------------------------------
// Per-film synopsis enrichment
// ---------------------------------------------------------------------------
//
// Each MALBA cycle page lists its films with <a href="/evento/<film>/">
// links inside the showtime lines. Each linked /evento/<film>/ page has a
// dedicated editorial synopsis (programmer's note, often with a "Texto de
// NAME" attribution at the tail) that we want on the cards.
//
// Architecture: the cycle parse already records each film's URL on
// ScrapedScreening.filmDetailUrl. After all cycles parse, we collect unique
// film URLs, fetch each once with the same 500ms politeness window MALBA's
// cycle scrape uses, parse the synopsis, and merge into every screening
// sharing that URL. Per-film fetch failures are non-fatal — they surface
// as warnings and the screening keeps whatever cycle-level data we already
// have.
//
// The MALBA per-film page uses the same Elementor text-editor widget
// pattern as the cycle pages. The synopsis is the longest
// .elementor-widget-text-editor body on the page — short widgets ("Durante
// todo abril", auditorio labels) are decoration; the synopsis dwarfs them.
// We strip a trailing "Texto de NAME" attribution that MALBA programmers
// add to credit the writer.

/**
 * Pure parser for the editorial synopsis on a MALBA per-film /evento/ page.
 * Returns undefined when no Elementor text-editor block contains substantive
 * prose (>= 60 chars after the attribution strip).
 */
export function parseFilmSynopsis(html: string): string | undefined {
  const $ = cheerio.load(html);

  let bestText = '';
  $('.elementor-widget-text-editor .elementor-widget-container').each((_i, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text.length > bestText.length) bestText = text;
  });

  // Strip "Texto de NAME" / "Texto de NAME y NAME" / "Texto: NAME" attribution
  // tails. MALBA programmers credit the writer; we don't render that on cards.
  const cleaned = bestText.replace(/\s+Texto\s*(?:de|:)\s+[^.]+\.?\s*$/i, '').trim();

  if (cleaned.length < 60) return undefined;
  return cleaned;
}

/**
 * Fetch each unique filmDetailUrl referenced by `screenings` and write its
 * synopsis into matching screenings. Per-URL dedupe (one cycle film with N
 * showtimes triggers one fetch). Sequential with the same DETAIL_DELAY_MS
 * politeness window the cycle scrape uses, since MALBA rate-limits hard.
 *
 * Exported so tests can inject a fake fetcher.
 */
export async function enrichFromFilmDetailPages(
  screenings: ScrapedScreening[],
  warnings: string[],
  fetcher: (url: string) => Promise<string> = fetchText,
  delayMs: number = DETAIL_DELAY_MS,
): Promise<void> {
  const urls = Array.from(
    new Set(
      screenings
        .map((s) => s.filmDetailUrl)
        .filter((u): u is string => typeof u === 'string' && u.length > 0),
    ),
  );
  if (urls.length === 0) return;

  const synopsisByUrl = new Map<string, string>();

  for (const url of urls) {
    try {
      const html = await fetcher(url);
      const synopsis = parseFilmSynopsis(html);
      if (synopsis) synopsisByUrl.set(url, synopsis);
    } catch (err) {
      warnings.push(
        `film detail fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  for (const s of screenings) {
    if (!s.filmDetailUrl || s.synopsisEs) continue;
    const synopsis = synopsisByUrl.get(s.filmDetailUrl);
    if (synopsis) s.synopsisEs = synopsis;
  }
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
