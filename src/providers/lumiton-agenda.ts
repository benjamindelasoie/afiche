/**
 * Shared agenda parser for Lumiton-operated venues.
 *
 * Lumiton publishes one combined agenda page at
 * https://lumiton.ar/agenda-presencial/ that lists events for three
 * separate cinemas: Cine York, Centro Cultural Munro, and Lumiton's
 * own flagship space. Every <article> tile carries machine-readable
 * data attributes we filter on:
 *
 *   <article data-event
 *            data-date="YYYY-MM-DD"
 *            data-locations='["cine-york"]'>
 *
 * So one parser handles all three venues; the only thing that changes
 * per provider is the location slug (and the cinemaId we stamp onto
 * each screening).
 *
 * Each cinema ships as its own Provider (cine-york.ts,
 * centro-cultural-munro.ts, lumiton.ts) to keep one-provider-per-cinema
 * semantics in run.ts and the ingest layer. Yes, that means we fetch
 * the same ~180KB agenda page three times per scrape — the host is
 * forgiving and the architecture is simpler than teaching the ingest
 * layer to wipe-and-reinsert multiple cinemas in one batch.
 */

import * as cheerio from 'cheerio';
import type { ProviderRunResult, ScrapedScreening } from './types';
import type { ScreeningTag } from '@/db';

export const AGENDA_URL = 'https://lumiton.ar/agenda-presencial/';
const USER_AGENT =
  'Mozilla/5.0 (compatible; AficheScraper/0.1; +https://afiche.ar)';

export interface LumitonVenueConfig {
  /** cinemas.id in the DB — stamped onto every emitted screening. */
  cinemaId: string;
  /** Human-readable name for error messages. */
  displayName: string;
  /** Slug that appears inside data-locations='[...]' in the agenda HTML. */
  locationSlug: string;
}

/**
 * Fetch the agenda, parse all event tiles, filter by this venue's
 * location slug, then enrich each unique detail page for metadata
 * (director, titleOriginal, year, country, runtimeMin). Never throws;
 * fetch/parse failures are converted to { success: false, error }.
 *
 * Why always-fetch instead of lazy-on-TMDB-miss: the agenda tile has
 * no metadata beyond title+date+synopsis, so ~20% of films TMDB can't
 * resolve would otherwise land in the DB with null director/year/
 * poster and a broken card on the site. Detail pages are ~4KB and
 * the host is forgiving; rescuing the long tail is worth the fetches.
 */
export async function fetchAndParse(
  config: LumitonVenueConfig,
): Promise<ProviderRunResult> {
  const warnings: string[] = [];
  try {
    const html = await fetchText(AGENDA_URL);
    const screenings = parseAgenda(html, config, warnings);

    if (screenings.length === 0) {
      return {
        cinemaId: config.cinemaId,
        screenings: [],
        success: false,
        warnings,
        error: `No ${config.displayName} screenings parsed from agenda page — selector likely broke or the location slug "${config.locationSlug}" changed.`,
      };
    }

    await enrichFromDetailPages(screenings, warnings);

    return {
      cinemaId: config.cinemaId,
      screenings,
      success: true,
      warnings,
    };
  } catch (err) {
    return {
      cinemaId: config.cinemaId,
      screenings: [],
      success: false,
      warnings,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Pure parser — takes HTML + config, returns screenings. Exported for
 * unit tests that feed a fixture string rather than hitting the network.
 */
export function parseAgenda(
  html: string,
  config: LumitonVenueConfig,
  warnings: string[],
): ScrapedScreening[] {
  const $ = cheerio.load(html);
  const out: ScrapedScreening[] = [];

  $('article[data-event]').each((_i, el) => {
    const $a = $(el);
    const date = $a.attr('data-date'); // "YYYY-MM-DD"
    const locsAttr = $a.attr('data-locations');
    if (!date || !locsAttr) return;

    const locs = parseLocationsJson(locsAttr);
    if (!locs.includes(config.locationSlug)) return; // not our venue

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      warnings.push(`${config.cinemaId}: malformed data-date "${date}"`);
      return;
    }

    const timeText = $a
      .find('.g-event-fecha .tracking-tighter.text-6xl')
      .last()
      .text()
      .trim();
    const time = parseTime(timeText);
    if (!time) {
      warnings.push(
        `${config.cinemaId}: could not parse time "${timeText}" for ${date}`,
      );
      return;
    }

    const title = $a.find('h3').first().text().trim();
    if (!title) {
      warnings.push(`${config.cinemaId}: event on ${date} has no <h3> title`);
      return;
    }

    // Don't scrape a synopsis from the agenda tile: the tile's
    // p.line-clamp-3 is Lumiton's own CSS-truncated preview (~100-140
    // chars, always cut mid-sentence, dangling commas/connectives).
    // Rendering that in a card reads as "broken data." Better to show
    // no synopsis (DESIGN.md line 136: "Card renders without synopsis
    // block"). Full synopses live on the /evento/ detail page body;
    // enriching from there is tracked in TODOS.md.

    const detailHref = $a.find('a[href*="/evento/"]').first().attr('href');
    const sourceUrl = detailHref ?? AGENDA_URL;

    out.push({
      cinemaId: config.cinemaId,
      filmTitle: title,
      startsAtUtc: buildBaLocalToUtc(date, time.hour, time.minute),
      tags: inferTags($a),
      sourceUrl,
    });
  });

  return out;
}

// ---------------------------------------------------------------------------
// Event detail page — enrichment
// ---------------------------------------------------------------------------

export interface EventDetail {
  director?: string;
  titleOriginal?: string;
  year?: number;
  country?: string;
  runtimeMin?: number;
}

/**
 * Pure parser for a single event detail page. The metadata block looks like:
 *
 *   <div class="mb-4 uppercase">
 *     <b>Dirección</b>
 *     John Ford <br>
 *     <b>Título Original</b>
 *     Grapes of wrath
 *     <div class="text-sm">EE.UU..  129 min.  1940.</div>
 *   </div>
 *
 * All fields are optional — missing ones come back undefined.
 */
export function parseEventDetail(html: string): EventDetail {
  const $ = cheerio.load(html);
  const out: EventDetail = {};

  const $block = $('article .mb-4.uppercase').first();
  if ($block.length === 0) return out;

  $block.find('b').each((_i, el) => {
    const label = normalizeLabel($(el).text());
    const value = textUntilNextBlock(el);
    if (!value) return;
    if (label.startsWith('direccion')) out.director = value;
    else if (label.startsWith('titulo original')) out.titleOriginal = value;
  });

  const smText = $block
    .find('.text-sm')
    .first()
    .text()
    .replace(/\s+/g, ' ')
    .trim();
  if (smText) {
    const runtimeMatch = smText.match(/(\d{1,3})\s*min\b\.?/i);
    if (runtimeMatch) out.runtimeMin = parseInt(runtimeMatch[1], 10);

    const yearMatch = smText.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) out.year = parseInt(yearMatch[0], 10);

    // Country is whatever precedes the first numeric token (runtime or year).
    // Trailing punctuation is stripped so "EE.UU.." collapses to "EE.UU".
    let firstIdx = Infinity;
    if (runtimeMatch?.index !== undefined) firstIdx = runtimeMatch.index;
    if (yearMatch?.index !== undefined && yearMatch.index < firstIdx) {
      firstIdx = yearMatch.index;
    }
    const countryPart = (Number.isFinite(firstIdx) ? smText.slice(0, firstIdx) : smText)
      .replace(/[.,\s]+$/, '')
      .trim();
    if (countryPart) out.country = countryPart;
  }

  return out;
}

/**
 * Enrich screenings in-place with detail-page metadata. Dedupes by
 * sourceUrl — a single film with N showtimes triggers one fetch.
 * Only `/evento/` URLs are fetched (screenings that fell back to the
 * agenda URL as sourceUrl are left alone).
 *
 * Exported so tests can inject a fake fetcher.
 */
export async function enrichFromDetailPages(
  screenings: ScrapedScreening[],
  warnings: string[],
  fetcher: (url: string) => Promise<string> = fetchText,
  concurrency = 5,
): Promise<void> {
  const urls = Array.from(
    new Set(
      screenings
        .map((s) => s.sourceUrl)
        .filter((u) => u.includes('/evento/')),
    ),
  );
  if (urls.length === 0) return;

  const detailByUrl = new Map<string, EventDetail>();

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        const html = await fetcher(url);
        return { url, detail: parseEventDetail(html) };
      }),
    );
    results.forEach((r, j) => {
      if (r.status === 'fulfilled') {
        detailByUrl.set(r.value.url, r.value.detail);
      } else {
        const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
        warnings.push(`detail fetch failed for ${batch[j]}: ${reason}`);
      }
    });
  }

  for (const s of screenings) {
    const d = detailByUrl.get(s.sourceUrl);
    if (!d) continue;
    if (d.director && !s.director) s.director = d.director;
    if (d.titleOriginal && !s.filmTitleOriginal) s.filmTitleOriginal = d.titleOriginal;
    if (d.year !== undefined && s.year === undefined) s.year = d.year;
    if (d.country && !s.country) s.country = d.country;
    if (d.runtimeMin !== undefined && s.runtimeMin === undefined) {
      s.runtimeMin = d.runtimeMin;
    }
  }
}

function normalizeLabel(raw: string): string {
  // Lowercase + strip accents so "Dirección" and "Título Original" match
  // a plain ASCII comparison.
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Walk sibling nodes after `el` collecting text, stopping at the next
 * <br>, <b>, or <div>. Matches the "label + value until next divider"
 * shape used by Lumiton's detail-page metadata block.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function textUntilNextBlock(el: any): string {
  let value = '';
  let cur = el.next;
  while (cur) {
    if (cur.type === 'tag' && (cur.name === 'br' || cur.name === 'b' || cur.name === 'div')) {
      break;
    }
    if (cur.type === 'text') value += cur.data;
    cur = cur.next;
  }
  return value.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseLocationsJson(raw: string): string[] {
  // '["cine-york"]' or '["cine-york","lumiton"]'. Defensive try/catch:
  // on smart-quote / encoding weirdness the event is silently skipped.
  // If EVERY event gets skipped, the provider surfaces a "selector broke"
  // error at the fetchAndParse level.
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === 'string');
    }
  } catch {
    // ignore
  }
  return [];
}

function parseTime(raw: string): { hour: number; minute: number } | null {
  // "18:00hs" or "18:00 hs" or just "18:00".
  const m = raw.match(/^(\d{1,2}):(\d{2})\s*(?:hs?)?$/i);
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Build a UTC Date from BA-local (date, hour, minute). Argentina is UTC-3
 * with no DST (stable since 2009). Hour 24 means midnight at the end of
 * the given day — roll one calendar day forward and use 00:00 locally.
 */
function buildBaLocalToUtc(
  isoDate: string,
  hourBa: number,
  minuteBa: number,
): Date {
  const [y, m, d] = isoDate.split('-').map((s) => parseInt(s, 10));
  let year = y;
  let month = m - 1;
  let day = d;
  let hLocal = hourBa;
  if (hourBa === 24) {
    hLocal = 0;
    const next = new Date(Date.UTC(year, month, day + 1));
    year = next.getUTCFullYear();
    month = next.getUTCMonth();
    day = next.getUTCDate();
  }
  return new Date(Date.UTC(year, month, day, hLocal + 3, minuteBa, 0, 0));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inferTags($a: any): ScreeningTag[] {
  const tags: ScreeningTag[] = [];
  const cls = ($a.attr('class') ?? '').toLowerCase();
  if (cls.includes('tipo-vecine')) tags.push('cycle');
  return tags;
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
