/**
 * El Cairo Cine Público provider. The Santa Fe province's public cinema in
 * Rosario (Santa Fe 1120): national releases, Latin American cinema, cycles
 * and free functions.
 *
 * Strategy: the site is WordPress + The Events Calendar, which exposes its
 * REST API, so the screening list is structured JSON rather than scraped HTML:
 *
 *   https://elcairocinepublico.gob.ar/wp-json/tribe/events/v1/events
 *
 * One API event is one function, and it carries an explicit
 * `utc_start_date`, a cycle (`categories`) and labels (`tags`). What it does
 * NOT carry is the film: `description` is empty, because the theme renders
 * the ficha técnica from custom fields straight into the event's page. So the
 * provider walks those pages too, once per SERIES — a film playing three
 * days is three API events whose URLs differ only by a trailing
 * `/YYYY-MM-DD/`, and all three render the same page.
 *
 * Two event shapes put more than one film on a page, each as an <h2> block
 * inside the synopsis:
 *
 *   - Double bills ("MICRO-RETRO: CLAUDIO PERRIN (SOLXS + EL DESENTIERRO)"):
 *     both films screen, so each becomes its own screening at the event's
 *     time, with the event title as the programme pill.
 *   - Duels ("FELICIDAD VS. MI VIDA ES MI VIDA", the ZOOM / VERSUS cycle):
 *     the audience votes in the room and only the winner screens. Neither
 *     film can honestly be listed, so the event is emitted once under its own
 *     title with no metadata hints.
 */

import * as cheerio from 'cheerio';
import type { ScreeningTag } from '@/db';
import { BA_TZ } from '@/lib/date-ranges';
import { type Provider, type ProviderRunResult, type ScrapedScreening } from './types';

const CINEMA_ID = 'el-cairo'; // our cinemas.id
const BASE_URL = 'https://elcairocinepublico.gob.ar';
const EVENTS_API = `${BASE_URL}/wp-json/tribe/events/v1/events`;
const PER_PAGE = 50;
/** Safety stop: the cartelera is ~20 events, so this is never reached honestly. */
const MAX_PAGES = 10;
const DETAIL_DELAY_MS = 300;
/** A hung government host must not stall every provider queued behind it. */
const FETCH_TIMEOUT_MS = 20_000;
/** Above this share of unreadable film pages the run fails instead. */
const MAX_UNREADABLE_SHARE = 0.5;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// API shape (only the fields we read)
// ---------------------------------------------------------------------------

export interface TribeTerm {
  name: string;
  slug: string;
}

export interface TribeEvent {
  id: number;
  title: string;
  url: string;
  /** "YYYY-MM-DD HH:MM:SS", already UTC. */
  utc_start_date: string;
  all_day: boolean;
  categories: TribeTerm[];
  tags: TribeTerm[];
}

export interface TribeEventsPage {
  events: TribeEvent[];
  total: number;
  total_pages: number;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export const elCairoProvider: Provider = {
  id: CINEMA_ID,
  name: 'El Cairo',

  async fetch(): Promise<ProviderRunResult> {
    const warnings: string[] = [];
    try {
      const now = new Date();
      // One malformed API event must not take the venue's whole run down.
      const events = (await fetchEvents(now)).filter((e) => {
        const ok =
          typeof e?.title === 'string' &&
          typeof e.url === 'string' &&
          typeof e.utc_start_date === 'string';
        if (!ok)
          warnings.push(`event ${e?.id ?? '?'}: malformed in the API response — skipped`);
        return ok;
      });

      // Fetch one DATED page per series: the bare series URL redirects to a
      // `/all/` listing of its dates, which carries no ficha at all.
      const pageUrls = new Map<string, string>();
      const offSite = new Set<string>();
      for (const e of events) {
        // The API is third-party input: never follow it off the venue's site.
        if (!isVenueUrl(e.url)) offSite.add(decodeEntities(e.title));
        else if (!pageUrls.has(seriesUrl(e.url))) pageUrls.set(seriesUrl(e.url), e.url);
      }
      for (const title of offSite) {
        warnings.push(`${title}: event URL is off the venue's site — skipped`);
      }

      // A film whose page we could not read is left out of this run rather
      // than listed title-only. Without its ficha it would carry no year, and
      // films are keyed on (title, year): the run would fork a second,
      // yearless row for the film and move its screenings onto it.
      const details = new Map<string, FilmPage>();
      for (const [series, url] of pageUrls) {
        try {
          const page = parseDetailPage(await fetchText(url));
          if (page.films[0]?.filmTitle) details.set(series, page);
          else
            warnings.push(
              `${url}: no film heading on the page (template change?) — skipped`,
            );
        } catch (err) {
          warnings.push(`${url}: detail fetch failed (${msg(err)}) — skipped`);
        }
        await sleep(DETAIL_DELAY_MS);
      }

      // Ingest replaces every future screening per run, so a skipped film is
      // gone until a run reads its page. One bad page is worth that; most of
      // them failing (a template change, the host throttling us) is not, so
      // fail the run and let ingest keep the last good schedule.
      const unreadable = pageUrls.size - details.size;
      if (pageUrls.size > 0 && unreadable / pageUrls.size > MAX_UNREADABLE_SHARE) {
        throw new Error(
          `${unreadable} of ${pageUrls.size} film pages unreadable — keeping the last good schedule`,
        );
      }
      // Pages that still show a title but lost the ficha's year are a template
      // change, not a few odd listings (La Random has no year by design):
      // every film would ingest year-less and fork, so fail the run instead.
      const yearless = [...details.values()].filter((p) => !p.films.some((f) => f.year));
      if (details.size > 0 && yearless.length / details.size > MAX_UNREADABLE_SHARE) {
        throw new Error(
          `${yearless.length} of ${details.size} film pages carry no year (ficha markup changed?) — keeping the last good schedule`,
        );
      }

      const readable = events.filter((e) => details.has(seriesUrl(e.url)));
      const screenings = buildScreenings(readable, details, now, warnings);
      if (events.length === 0) {
        warnings.push(
          'events API returned no upcoming screenings — suspicious for a sala that programs every week.',
        );
      } else if (screenings.length === 0) {
        warnings.push(`${events.length} events returned but none became a screening`);
      }

      return { cinemaId: CINEMA_ID, screenings, success: true, warnings };
    } catch (err) {
      return {
        cinemaId: CINEMA_ID,
        screenings: [],
        success: false,
        warnings,
        error: msg(err),
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

async function fetchEvents(now: Date): Promise<TribeEvent[]> {
  // `start_date` is BA-local and day-granular; anything earlier today is
  // filtered against `now` in buildScreenings. en-CA formats as YYYY-MM-DD.
  const startDate = new Intl.DateTimeFormat('en-CA', { timeZone: BA_TZ }).format(now);
  const out: TribeEvent[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${EVENTS_API}?per_page=${PER_PAGE}&page=${page}&start_date=${startDate}`;
    const body = JSON.parse(await fetchText(url)) as TribeEventsPage;
    // WordPress answers some failures with a 200 and an error object.
    if (!Array.isArray(body.events)) {
      throw new Error(`events API: no events array in the response for ${url}`);
    }
    out.push(...body.events);
    if (!(page < Number(body.total_pages))) break; // also stops on a missing total
  }
  return out;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'es-AR,es;q=0.9' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  // isVenueUrl vetted the request; a redirect must not take us off-site either.
  if (res.url && !isVenueUrl(res.url)) {
    throw new Error(`${url} redirected off the venue's site to ${res.url}`);
  }
  return res.text();
}

// ---------------------------------------------------------------------------
// Event -> screenings (pure — exported for fixture tests)
// ---------------------------------------------------------------------------

/**
 * Join API events with their parsed series pages. `details` is keyed by
 * `seriesUrl(event.url)`. fetch() passes only events whose page it read; a
 * missing entry still yields a title-only screening, as a defensive default.
 */
export function buildScreenings(
  events: TribeEvent[],
  details: Map<string, FilmPage>,
  now: Date,
  warnings: string[] = [],
): ScrapedScreening[] {
  const out: ScrapedScreening[] = [];

  for (const ev of events) {
    const title = decodeEntities(ev.title);
    if (ev.all_day) {
      // No all-day events in the cartelera so far; one would be an
      // exhibition or a workshop, not a function with a start time.
      warnings.push(`${title}: all-day event — skipped`);
      continue;
    }
    const startsAtUtc = parseUtc(ev.utc_start_date);
    if (!startsAtUtc) {
      warnings.push(
        `${title}: unparseable utc_start_date "${ev.utc_start_date}" — skipped`,
      );
      continue;
    }
    // Ingest only replaces FUTURE rows; a past insert would be an orphan.
    if (startsAtUtc <= now) continue;

    const categories = ev.categories ?? [];
    const cycle = categories[0] ? decodeEntities(categories[0].name) : undefined;
    const tags = tagsFor(ev, cycle);
    const page = details.get(seriesUrl(ev.url));
    const base = { cinemaId: CINEMA_ID, startsAtUtc, sourceUrl: ev.url };

    // A duel: an event of the Zoom / Versus cycle that bills two films or a
    // "VS." title, or elsewhere a "VS." title whose page lists both films. A
    // single film whose own title has "VS." ("KRAMER VS. KRAMER") has one film
    // on its page and stays one.
    const versusCycle = categories.some((c) => /versus/i.test(c.slug));
    const twoFilms = !!page && page.films.length > 1;
    const duel = versusCycle
      ? isDuel(title) || twoFilms
      : isDuel(title) && (!page || twoFilms);

    if (page && page.films.length > 1 && !duel) {
      for (const film of page.films) {
        out.push({ ...base, ...film, tags, programName: title });
      }
      continue;
    }

    const film = page && !duel ? page.films[0] : undefined;
    out.push({
      ...base,
      ...film,
      // Only the room's vote decides which film screens: no TMDB match is honest.
      ...(duel ? { skipTmdb: true } : {}),
      // The API title is what the box office bills; the page h1 carries the
      // same string plus the original title, which the ficha already split.
      filmTitle: title,
      tags,
      programName: cycle,
    });
  }

  return out;
}

/** "FELICIDAD VS. MI VIDA ES MI VIDA" — the audience picks one in the room. */
export function isDuel(title: string): boolean {
  return /\sVS\.?\s/i.test(title);
}

function tagsFor(ev: TribeEvent, cycle: string | undefined): ScreeningTag[] {
  const tags: ScreeningTag[] = [];
  const labels = (ev.tags ?? []).map((t) => stripAccents(t.name).toLowerCase());
  if (labels.some((l) => l.startsWith('estreno'))) tags.push('premiere');
  if (labels.some((l) => l.startsWith('funcion especial'))) tags.push('unique');
  if (cycle) tags.push('cycle');
  return tags;
}

/** True for an https URL on the venue's own host. */
export function isVenueUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = (h: string) => h.replace(/^www\./, '');
    return (
      u.protocol === 'https:' && host(u.hostname) === host(new URL(BASE_URL).hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Recurring events share one page: `/pelicula-de-sala/los-calvos/2026-10-22/`
 * and `/…/2026-10-23/` render identically. Strip the date to key them as one
 * series — only as a key, the stripped URL itself is not a film page.
 */
export function seriesUrl(url: string): string {
  return url.replace(/\d{4}-\d{2}-\d{2}\/?$/, '');
}

/** "2026-10-23 01:30:00" (UTC) -> Date. */
export function parseUtc(raw: string): Date | null {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi));
}

// ---------------------------------------------------------------------------
// Detail page (pure — exported for fixture tests)
// ---------------------------------------------------------------------------

type FilmFields = Pick<
  ScrapedScreening,
  | 'filmTitle'
  | 'filmTitleOriginal'
  | 'director'
  | 'year'
  | 'country'
  | 'runtimeMin'
  | 'synopsisEs'
>;

export interface FilmPage {
  /** One entry per film on the page; more than one for double bills / duels. */
  films: FilmFields[];
}

/**
 * Read the film(s) off an event page.
 *
 * Single film: the h1 holds "TITLE <span>/ Original title</span>", the
 * `.ficha-tecnica-online` block holds "LABEL: <span>value</span>" rows, and
 * `.sinopsis-online` holds the synopsis — optionally followed by a "***"
 * separator and a note about the event, which isn't the film's synopsis.
 *
 * Several films: `.sinopsis-online` holds one <h2> per film, each followed by
 * its synopsis and either "<strong>DIRECCIÓN:</strong> …" rows or an
 * "<em>Drama / 6’ / Argentina 2021</em>" credit line. The shared ficha then
 * only holds what the films have in common, and fills the gaps.
 */
export function parseDetailPage(html: string): FilmPage {
  const $ = cheerio.load(html);
  const shared = parseFicha($);

  const h1 = $('h1.titulo-cine-desala').first();
  const original = collapse(h1.find('span').text()).replace(/^\/\s*/, '');
  const h1Title = collapse(h1.clone().children().remove().end().text());

  const sinopsis = $('.sinopsis-online').first();
  // An empty <h2> used as spacing is not a film heading.
  const h2s = sinopsis.children('h2').filter((_, el) => collapse($(el).text()) !== '');

  if (h2s.length < 2) {
    return {
      films: [
        {
          filmTitle: h1Title,
          filmTitleOriginal: original || undefined,
          ...shared,
          synopsisEs: synopsisBeforeSeparator($, sinopsis.children()),
        },
      ],
    };
  }

  // Only who-and-where carries over from the shared ficha: a programme-level
  // runtime or year would be the bill's, not this film's.
  const { director, country } = shared;
  const films = h2s.toArray().map((h2, i) => {
    // Up to the next FILM heading: a blank spacer <h2> inside the block
    // must not cut the film off from its own synopsis and credits.
    // It also ends at a "***" separator: what follows is a note about the
    // event, whose "DURACIÓN:" would be the programme's, not this film's.
    const next = h2s.get(i + 1);
    const block = untilSeparator($, next ? $(h2).nextUntil(next) : $(h2).nextAll());
    const credits = parseBlockCredits($, block);
    return {
      filmTitle: collapse($(h2).text()),
      ...stripUndefined({ director, country }),
      ...credits,
      synopsisEs: synopsisBeforeSeparator($, block),
    };
  });
  return { films };
}

type Credits = Omit<FilmFields, 'filmTitle' | 'filmTitleOriginal' | 'synopsisEs'>;

function parseFicha($: cheerio.CheerioAPI): Credits {
  const rows = new Map<string, string>();
  $('.ficha-tecnica-online .ficha-tec-resp').each((_, el) => {
    const prev = el.prev && 'data' in el.prev ? el.prev.data : '';
    const label = labelKey(prev);
    if (label) rows.set(label, collapse($(el).text()));
  });
  return creditsFrom(rows);
}

/** Per-film credits inside a multi-film synopsis block. */
function parseBlockCredits($: cheerio.CheerioAPI, block: Elements): Credits {
  const rows = new Map<string, string>();
  block.each((_, el) => {
    for (const line of linesOf($(el))) {
      const m = line.match(/^([A-ZÁÉÍÓÚÑ ]+):\s*(.+)$/i);
      if (m && !rows.has(labelKey(m[1]))) rows.set(labelKey(m[1]), m[2]);
    }
  });
  const credits = creditsFrom(rows);

  // The other house style: "<em>Drama / 6’ / Argentina 2021</em>".
  block.find('em').each((_, em) => {
    const parts = collapse($(em).text()).split(/\s+\/\s+/);
    if (parts.length < 2) return;
    for (const part of parts) {
      const runtime = part.match(/^(\d{1,3})\s*['’′]$/);
      if (runtime) credits.runtimeMin ??= Number(runtime[1]);
      const origin = part.match(/^(\D+?)\s+((?:19|20)\d{2})$/);
      if (origin) {
        credits.country ??= origin[1];
        credits.year ??= Number(origin[2]);
      }
    }
  });
  return stripUndefined(credits);
}

function creditsFrom(rows: Map<string, string>): Credits {
  const year = rows.get('ANO')?.match(/\b(?:19|20)\d{2}\b/);
  const runtime = rows.get('DURACION')?.match(/\d{1,3}/);
  return stripUndefined({
    director: rows.get('DIRECCION') || undefined,
    country: rows.get('ORIGEN') || undefined,
    year: year ? Number(year[0]) : undefined,
    runtimeMin: runtime ? Number(runtime[0]) : undefined,
  });
}

/** Paragraph text up to the first "***", minus credit lines. */
function synopsisBeforeSeparator(
  $: cheerio.CheerioAPI,
  nodes: Elements,
): string | undefined {
  const paras: string[] = [];
  for (const el of nodes.filter('p').toArray()) {
    const p = $(el);
    const text = collapse(p.text());
    if (text === '***') break;
    if (!text) continue;
    // Credit rows ("DIRECCIÓN: …") and all-italic credit lines ("<em>Drama /
    // 6’ / Argentina 2021</em>"). Italics inside a sentence — a film title in
    // the synopsis — are synopsis.
    const allItalic = squash(p.find('em').text()) === squash(p.text());
    const creditShape = /\s\/\s/.test(text);
    if (/^[A-ZÁÉÍÓÚÑ ]+:/.test(text) || (allItalic && creditShape)) continue;
    paras.push(text);
  }
  return paras.length ? paras.join('\n\n') : undefined;
}

/** The elements before the first "***" paragraph. */
function untilSeparator($: cheerio.CheerioAPI, nodes: Elements): Elements {
  const end = nodes.toArray().findIndex((el) => collapse($(el).text()) === '***');
  return end === -1 ? nodes : nodes.slice(0, end);
}

/** A <p>'s lines, split on <br>. */
function linesOf(el: Elements): string[] {
  const html = el.html() ?? '';
  return html
    .split(/<br\s*\/?>/i)
    .map((chunk) => collapse(cheerio.load(chunk).text()))
    .filter(Boolean);
}

/** "DIRECCIÓN:" -> "DIRECCION", "AÑO:" -> "ANO". */
function labelKey(raw: string): string {
  return stripAccents(collapse(raw).replace(/:$/, '')).toUpperCase();
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** A selection of elements, e.g. `$('.x').children()` (cheerio's Element isn't exported). */
type Elements = ReturnType<ReturnType<cheerio.CheerioAPI['root']>['children']>;

/** WordPress HTML-encodes titles in the API ("RECORD&#8217;A"). */
function decodeEntities(s: string): string {
  return collapse(cheerio.load(`<p>${s}</p>`)('p').text());
}

function stripUndefined<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

/** All whitespace removed: compares text across <br> and spacing. */
function squash(s: string): string {
  return s.replace(/\s+/g, '');
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
