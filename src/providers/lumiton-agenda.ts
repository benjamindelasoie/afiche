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
 * location slug, return a ProviderRunResult. Never throws; fetch/parse
 * failures are converted to { success: false, error }.
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

    const synopsis = $a
      .find('p.line-clamp-3')
      .first()
      .text()
      .trim()
      .replace(/&hellip;$|…$/, '');

    const detailHref = $a.find('a[href*="/evento/"]').first().attr('href');
    const sourceUrl = detailHref ?? AGENDA_URL;

    out.push({
      cinemaId: config.cinemaId,
      filmTitle: title,
      startsAtUtc: buildBaLocalToUtc(date, time.hour, time.minute),
      tags: inferTags($a),
      synopsisEs: synopsis || undefined,
      sourceUrl,
    });
  });

  return out;
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
