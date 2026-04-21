/**
 * Cine York provider — served via lumiton.ar's shared agenda page.
 *
 * Lumiton operates three screens (Cine York, Centro Cultural Munro, and
 * their own Lumiton space). The agenda lists all three; every event tile
 * carries a `data-locations='["slug"]'` attribute we filter on.
 *
 * Strategy:
 *   1. Fetch https://lumiton.ar/agenda-presencial/ (the `?lugar=cine-york`
 *      query param is a client-side filter hint; server returns all
 *      events regardless, so we pull once and filter ourselves).
 *   2. For every <article data-event ...> tile whose data-locations JSON
 *      array contains "cine-york":
 *        - data-date attribute gives the full YYYY-MM-DD (no year
 *          inference required)
 *        - Time is "HH:MMhs" in the third .tracking-tighter.text-6xl <div>
 *          inside the .g-event-fecha row
 *        - Film title is the <h3>
 *        - Synopsis is the first <p class="line-clamp-3">
 *        - Detail URL is the <a href="https://lumiton.ar/evento/SLUG/">
 *
 * Notes / known gaps (add to TODOS.md if they become real pain):
 *   - Pagination: yith-infinite-scrolling plugin is on the page. The
 *     initial HTML already carries ~2.5 weeks of programming, which
 *     covers the week view comfortably. If a future need crosses that
 *     horizon we'll need to walk the "load more" XHR endpoint.
 *   - Multi-location events: not observed in the current snapshot
 *     (every tile has exactly one location slug in the JSON array).
 *     The filter uses `.includes("cine-york")` so multi-location events
 *     would still match.
 *   - Year / month logic: unneeded — data-date has the full date.
 */

import * as cheerio from 'cheerio';
import {
  type Provider,
  type ProviderRunResult,
  type ScrapedScreening,
} from './types';
import type { ScreeningTag } from '@/db';

const AGENDA_URL = 'https://lumiton.ar/agenda-presencial/';
const LOCATION_SLUG = 'cine-york';
const USER_AGENT =
  'Mozilla/5.0 (compatible; AficheScraper/0.1; +https://afiche.ar)';

export const cineYorkProvider: Provider = {
  id: 'cine-york',
  name: 'Cine York',

  async fetch(): Promise<ProviderRunResult> {
    const warnings: string[] = [];
    try {
      const html = await fetchText(AGENDA_URL);
      const screenings = parseAgenda(html, warnings);

      if (screenings.length === 0) {
        return {
          cinemaId: this.id,
          screenings: [],
          success: false,
          warnings,
          error:
            'No Cine York screenings parsed from agenda page — selector likely broke or the location slug changed.',
        };
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
// Parser (exported for tests)
// ---------------------------------------------------------------------------

export function parseAgenda(
  html: string,
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
    if (!locs.includes(LOCATION_SLUG)) return; // not our cinema

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      warnings.push(`cine-york: malformed data-date "${date}"`);
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
        `cine-york: could not parse time "${timeText}" for ${date}`,
      );
      return;
    }

    const title = $a.find('h3').first().text().trim();
    if (!title) {
      warnings.push(`cine-york: event on ${date} has no <h3> title`);
      return;
    }

    const synopsis = $a
      .find('p.line-clamp-3')
      .first()
      .text()
      .trim()
      .replace(/&hellip;$|…$/, '');

    const detailHref = $a
      .find('a[href*="/evento/"]')
      .first()
      .attr('href');
    const sourceUrl = detailHref ?? AGENDA_URL;

    out.push({
      cinemaId: 'cine-york',
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
  // The attribute is JSON-ish: '["cine-york"]' or '["cine-york","lumiton"]'.
  // cheerio hands it back without the outer apostrophes (already stripped),
  // but we still need JSON.parse — which chokes on the rare edge case of
  // smart quotes. Defensive try/catch returns [] and the event is silently
  // skipped; a "selector broke" error at the fetch layer catches the case
  // where EVERY event is skipped.
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    // ignore
  }
  return [];
}

function parseTime(raw: string): { hour: number; minute: number } | null {
  // "18:00hs" or "18:00 hs" or just "18:00"
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
  // Header prose near the tile may indicate restored/retrospective —
  // add only when we see stable signals; for now keep tags minimal.
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
