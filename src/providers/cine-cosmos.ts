/**
 * Cine Cosmos provider. UBA's rep cinema on Av. Corrientes.
 *
 * Strategy:
 *   1. Fetch the homepage. Each .card holds one film with a link to a
 *      detail page (?c=main&a=Detalle&idPelicula=<id>).
 *   2. For each unique detail URL, fetch the detail page once and parse:
 *        - title           .peliculaTitulo
 *        - director/año/país/duración   .peliculaInfoTexto inline label/value
 *        - schedule        .funcionesHora ("Ju - Vi - Sá - Do - Lu - Ma - Mi | 16:55, 19:10")
 *        - synopsis        .peliculaDescpTexto innerHTML, stop at first <br>
 *      Detail pages are the source of truth — homepage cards re-render the
 *      same fields with slightly different separators.
 *   3. Anchor calendar dates on the most-recent Thursday in BA local time.
 *      Cine Cosmos changes programming weekly on Thursdays, and the day
 *      pattern is given as DOW abbreviations only (no calendar dates).
 *   4. Emit one ScrapedScreening per (film, day, time).
 *
 * The site is plain server-rendered HTML with stable Bootstrap classes —
 * no rate limit, no Cloudflare. Politeness sleep between detail fetches
 * is conservative (300ms) since the cartelera is small (~7 films).
 */

import * as cheerio from 'cheerio';
import { type Provider, type ProviderRunResult, type ScrapedScreening } from './types';

const LISTING_URL = 'https://www.cinecosmos.uba.ar/';
const DETAIL_BASE = 'https://www.cinecosmos.uba.ar/?c=main&a=Detalle&idPelicula=';
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const DETAIL_DELAY_MS = 300;

// Cine Cosmos cycles run Thursday → Wednesday. Map each Spanish day
// abbreviation to its offset from cycle-start Thursday. Both "Sá" (with
// accent) and "Sa" appear across listing/detail HTML so both are accepted.
const DAY_OFFSET: Record<string, number> = {
  ju: 0,
  vi: 1,
  sa: 2,
  sá: 2,
  do: 3,
  lu: 4,
  ma: 5,
  mi: 6,
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export const cineCosmosProvider: Provider = {
  id: 'cine-cosmos',
  name: 'Cine Cosmos',

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
          error: 'No film cards found on listing page — selector likely broke.',
        };
      }

      const anchor = mostRecentThursdayBaLocal(new Date());
      const screenings: ScrapedScreening[] = [];

      for (const program of programs) {
        try {
          const detailHtml = await fetchText(program.detailUrl);
          const parsed = parseDetailPage(detailHtml, program, anchor, warnings);
          screenings.push(...parsed);
        } catch (err) {
          warnings.push(
            `program "${program.idPelicula}": ${err instanceof Error ? err.message : String(err)}`,
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
// Listing extraction
// ---------------------------------------------------------------------------
export interface ProgramLink {
  idPelicula: string;
  /** Listing-side title — used as a fallback if detail-page title fails. */
  title: string;
  detailUrl: string;
}

export function extractPrograms(html: string): ProgramLink[] {
  const $ = cheerio.load(html);
  const out: ProgramLink[] = [];
  const seen = new Set<string>();

  $('.card').each((_i, el) => {
    const $el = $(el);
    const href = $el.find('a[href*="idPelicula="]').first().attr('href');
    if (!href) return;
    const m = href.match(/idPelicula=(\d+)/);
    if (!m) return;
    const idPelicula = m[1];
    if (seen.has(idPelicula)) return;
    seen.add(idPelicula);

    const title = $el.find('.card-title').first().text().trim();
    out.push({
      idPelicula,
      title,
      detailUrl: `${DETAIL_BASE}${idPelicula}`,
    });
  });

  return out;
}

// ---------------------------------------------------------------------------
// Detail page parsing
// ---------------------------------------------------------------------------

interface FilmContext {
  title: string;
  director?: string;
  year?: number;
  country?: string;
  runtimeMin?: number;
  synopsis?: string;
}

export function parseDetailPage(
  html: string,
  program: ProgramLink,
  anchor: Date,
  warnings: string[],
): ScrapedScreening[] {
  const $ = cheerio.load(html);

  const film = parseFilmContext($, program);
  if (!film.title) {
    warnings.push(`program "${program.idPelicula}": no title found on detail page`);
    return [];
  }

  const schedule = parseSchedule($);
  if (schedule.days.length === 0 || schedule.times.length === 0) {
    warnings.push(
      `program "${program.idPelicula}" "${film.title}": no schedule recognized` +
        ` (days=${schedule.days.length}, times=${schedule.times.length})`,
    );
    return [];
  }

  const screenings: ScrapedScreening[] = [];
  for (const day of schedule.days) {
    for (const time of schedule.times) {
      const startsAtUtc = buildBaLocalToUtc(anchor, day.offset, time.hour, time.minute);
      screenings.push({
        cinemaId: 'cine-cosmos',
        filmTitle: film.title,
        director: film.director,
        year: film.year,
        country: film.country,
        runtimeMin: film.runtimeMin,
        startsAtUtc,
        tags: ['cycle'],
        synopsisEs: film.synopsis,
        sourceUrl: program.detailUrl,
      });
    }
  }
  return screenings;
}

function parseFilmContext($: cheerio.CheerioAPI, program: ProgramLink): FilmContext {
  const title = $('.peliculaTitulo').first().text().trim() || program.title;
  const film: FilmContext = { title };

  // Info row: "Dirección: <director> Año: <year> País: <country> Duración: <n>m"
  // Walk the labelled fields left-to-right. The whole block is one big
  // text run with bold labels — flatten and regex-slice.
  const infoText = $('.peliculaInfoTexto').first().text().replace(/\s+/g, ' ').trim();
  if (infoText) {
    const director = infoText.match(/Direcci[oó]n:\s*(.+?)(?:\s+A[ñn]o:|$)/i);
    if (director) film.director = director[1].trim();
    const year = infoText.match(/A[ñn]o:\s*(\d{4})/i);
    if (year) film.year = parseInt(year[1], 10);
    const country = infoText.match(/Pa[íi]s:\s*(.+?)(?:\s+Duraci[oó]n:|$)/i);
    if (country) film.country = country[1].trim();
    const runtime = infoText.match(/Duraci[oó]n:\s*(\d+)\s*m/i);
    if (runtime) film.runtimeMin = parseInt(runtime[1], 10);
  }

  film.synopsis = parseSynopsis($);
  return film;
}

/**
 * Synopsis lives in `.peliculaDescpTexto`. The element also contains the
 * showtime line after a `<br>`:
 *
 *   <p class="peliculaDescpTexto">
 *     Real synopsis prose ending with a period.
 *     <br> 21:30 SALA 1
 *   </p>
 *
 * We split on the first `<br>` (any case/self-closing variant) and keep
 * the prose before it. Returns undefined when the resulting text is too
 * short to be a real synopsis (40-char floor).
 */
export function parseSynopsis($: cheerio.CheerioAPI): string | undefined {
  const $p = $('.peliculaDescpTexto').first();
  if ($p.length === 0) return undefined;
  const inner = $p.html() ?? '';
  const beforeBr = inner.split(/<br\s*\/?\s*>/i)[0] ?? '';
  // Strip any remaining inline markup (the synopsis prose is typically
  // plain text but we don't want stray <strong>/<em>/<a> bleeding in).
  const text = cheerio
    .load(`<root>${beforeBr}</root>`)('root')
    .text()
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < 40) return undefined;
  return text;
}

interface DayHit {
  code: string;
  offset: number;
}
interface TimeHit {
  hour: number;
  minute: number;
}

export function parseSchedule(
  $: cheerio.CheerioAPI,
): { days: DayHit[]; times: TimeHit[] } {
  // Detail page format: "Ju - Vi - Sá - Do - Lu - Ma - Mi | 16:55, 19:10"
  // Homepage card-footer also matches but uses space separators between
  // days and " - " between times. The "|" splits day-list from time-list
  // in both forms.
  const text = $('.funcionesHora').first().text().replace(/\s+/g, ' ').trim();
  return parseScheduleString(text);
}

export function parseScheduleString(text: string): { days: DayHit[]; times: TimeHit[] } {
  const [dayPart, timePart] = text.split(/\s*\|\s*/);
  if (!dayPart || !timePart) return { days: [], times: [] };

  const days: DayHit[] = [];
  for (const raw of dayPart.split(/[\s\-,]+/)) {
    const code = raw.trim().toLowerCase().replace(/\.$/, '');
    if (!code) continue;
    const offset = DAY_OFFSET[code];
    if (offset === undefined) continue;
    if (days.some((d) => d.offset === offset)) continue;
    days.push({ code, offset });
  }

  const times: TimeHit[] = [];
  for (const raw of timePart.split(/[\s,\-/]+/)) {
    const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) continue;
    const hour = parseInt(m[1], 10);
    const minute = parseInt(m[2], 10);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) continue;
    if (times.some((t) => t.hour === hour && t.minute === minute)) continue;
    times.push({ hour, minute });
  }

  return { days, times };
}

// ---------------------------------------------------------------------------
// Date math
// ---------------------------------------------------------------------------

/**
 * Most-recent Thursday in BA local time, returned as a UTC midnight Date
 * representing that BA-local day. If today (BA) is Thursday, returns
 * today; otherwise rolls back to the previous Thursday. Cine Cosmos
 * publishes a new program every Thursday morning, so the most-recent
 * Thursday is the cycle anchor regardless of when in the week we scrape.
 */
export function mostRecentThursdayBaLocal(now: Date): Date {
  // Argentina is UTC-3 with no DST. Shift UTC clock to BA local clock.
  const baMs = now.getTime() - 3 * 3600 * 1000;
  const ba = new Date(baMs);
  const baDow = ba.getUTCDay(); // 0=Sun … 4=Thu
  const daysSinceThu = (baDow - 4 + 7) % 7;
  return new Date(
    Date.UTC(
      ba.getUTCFullYear(),
      ba.getUTCMonth(),
      ba.getUTCDate() - daysSinceThu,
    ),
  );
}

function buildBaLocalToUtc(
  anchor: Date,
  dayOffset: number,
  hourBa: number,
  minuteBa: number,
): Date {
  // anchor is a UTC midnight standing in for BA-local midnight on the
  // cycle's Thursday. Add dayOffset days, then convert BA-local hour to
  // UTC by shifting +3.
  return new Date(
    Date.UTC(
      anchor.getUTCFullYear(),
      anchor.getUTCMonth(),
      anchor.getUTCDate() + dayOffset,
      hourBa + 3,
      minuteBa,
      0,
      0,
    ),
  );
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

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
