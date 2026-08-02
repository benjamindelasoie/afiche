/**
 * Cineclub Lucero provider. The first-floor sala of Club Lucero, a bar in
 * Palermo Hollywood. Wed–Fri programming in the sala, Tuesdays outdoors on
 * the patio (audio via wireless headphones so the bar keeps running).
 *
 * Strategy: they have no site of their own worth scraping — clublucero.com is
 * 410 Gone and the @cineclublucero IG account has been removed. Their own
 * Linktree points "ENTRADAS CINE" straight at an Eventbrite organizer page,
 * which is backed by a clean JSON endpoint:
 *
 *   GET /org/<orgId>/showmore/?page_size=50&type=future&page=N
 *     -> { data: { events: [...], has_next_page: bool } }
 *
 * No HTML parsing and no detail-page walk: the listing carries everything we
 * need (name, start.utc, url, format, venue). Event detail pages add nothing —
 * Eventbrite renders the long description client-side and past events collapse
 * it entirely, so the listing IS the richest available source.
 *
 * TIMEZONE: unlike most providers, no +3h math is needed — Eventbrite emits a
 * real UTC instant in `start.utc` (cross-checked against `start.local`, which
 * is BA wall-clock). We still keep a local->UTC fallback for the day the
 * `utc` field goes missing, using the standard Argentina UTC-3 shift.
 *
 * SCOPE (v1): features only. The organizer publishes DJ nights, impro courses
 * and parties alongside screenings, plus a handful of non-feature events filed
 * under the same "Screening" format. See FEATURE-ONLY FILTER below.
 *
 * The listing gives no runtime/country/synopsis; TMDB enrichment fills those.
 */

import { type Provider, type ProviderRunResult, type ScrapedScreening } from './types';
import type { ScreeningTag } from '@/db';

const CINEMA_ID = 'cineclub-lucero'; // our cinemas.id
const ORG_ID = '34315560147'; // Club Lucero on Eventbrite
const API_BASE = `https://www.eventbrite.com/org/${ORG_ID}/showmore/`;
const ORG_URL = `https://www.eventbrite.com/o/club-lucero-${ORG_ID}`;
const PAGE_SIZE = 50;
const MAX_PAGES = 10; // backstop; the future feed has never exceeded one page
const PAGE_DELAY_MS = 300;

/**
 * Eventbrite's format id for "Screening". Stable across categories — the
 * organizer files films under Film & Media (104), Arts (105) and even
 * Spirituality (114), but format_id is 7 for all of them. Filtering on
 * format_id instead of the category label is what keeps the Bergman /
 * Life of Brian night from being dropped.
 */
const SCREENING_FORMAT_ID = '7';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// --- API response shapes (only the fields we use) --------------------------

interface ApiEventStart {
  utc?: string; // "2026-07-30T21:00:00Z" — a real UTC instant
  local?: string; // "2026-07-30T18:00:00" — BA wall-clock
}

export interface ApiEvent {
  name?: { text?: string };
  url?: string;
  format_id?: string | null;
  start?: ApiEventStart;
}

export interface ShowmoreResponse {
  data?: {
    events?: ApiEvent[];
    has_next_page?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export const cineclubLuceroProvider: Provider = {
  id: CINEMA_ID,
  name: 'Cineclub Lucero',

  async fetch(): Promise<ProviderRunResult> {
    const warnings: string[] = [];
    try {
      const events: ApiEvent[] = [];
      let sawEvents = false;

      for (let page = 1; page <= MAX_PAGES; page++) {
        const resp = await fetchJson<ShowmoreResponse>(
          `${API_BASE}?page_size=${PAGE_SIZE}&type=future&page=${page}`,
        );
        const pageEvents = resp.data?.events ?? [];
        if (pageEvents.length > 0) sawEvents = true;
        events.push(...pageEvents);

        if (resp.data?.has_next_page !== true) break;
        if (page === MAX_PAGES) {
          warnings.push(
            `stopped at MAX_PAGES=${MAX_PAGES} with has_next_page still true`,
          );
        }
        await sleep(PAGE_DELAY_MS);
      }

      if (!sawEvents) {
        // An organizer with literally zero upcoming events of ANY kind is the
        // signature of a moved/renamed org or a changed response shape — not
        // a quiet week. Fail loudly so it surfaces in the run log.
        return {
          cinemaId: CINEMA_ID,
          screenings: [],
          success: false,
          warnings,
          error:
            'showmore returned no events at all — org id or API shape may have changed.',
        };
      }

      const screenings = parseEvents(events, new Date(), warnings);

      if (screenings.length === 0) {
        // Legitimately common: Lucero publishes its Wed–Fri films only about
        // a week ahead, so a mid-cycle scrape sees only DJ nights. Not an
        // error — but say so, otherwise a real parse regression looks the same.
        warnings.push(
          `${events.length} upcoming event(s) but no feature screenings — ` +
            'expected when the next weeks of cine are not published yet.',
        );
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
// FEATURE-ONLY FILTER
// ---------------------------------------------------------------------------

/**
 * Non-feature events the organizer files under format "Screening".
 *
 * v1 scope decision: Afiche's cartelera carries feature films only. The
 * untyped bucket (events Eventbrite left with category_id/format_id/
 * subcategory_id ALL null — VIDEODROME and EL CASTILLO AMBULANTE sit there
 * next to FESTIVAL CANNABICO) is excluded wholesale by the format filter,
 * because nothing in the payload distinguishes a film from a party there.
 * Revisit if the operator wants that tail.
 */
const NON_FEATURE_PATTERNS: ReadonlyArray<{ re: RegExp; why: string }> = [
  // Recurring free 23:00 session: The Wizard of Oz synced to Dark Side of
  // the Moon. A projection, but framed and attended as a DJ/visual set.
  { re: /^\s*SESIONES\s+CLUB\s+LUCERO\b/i, why: 'DJ/visual session' },
  // The weekly FLEABAG night is a staged monologue plus the TV pilot.
  { re: /^\s*FLEABAG\b/i, why: 'theatre monologue + TV pilot' },
  // Explicit TV-episode markers, whatever the show.
  { re: /\bPILOTO\s+DE\s+LA\s+SERIE\b/i, why: 'TV pilot' },
  { re: /\bCAP[IÍ]TULOS?\s*\d/i, why: 'TV episodes' },
  { re: /\bTEMPORADA\s*\d/i, why: 'TV season' },
];

export function nonFeatureReason(title: string): string | undefined {
  return NON_FEATURE_PATTERNS.find((p) => p.re.test(title))?.why;
}

// ---------------------------------------------------------------------------
// Pure mapping (exported for fixture tests)
// ---------------------------------------------------------------------------

/**
 * Map a showmore payload's events to screenings. `now` is passed in (not read
 * from the clock) so tests can pin it.
 */
export function parseEvents(
  events: ApiEvent[],
  now: Date,
  warnings: string[] = [],
): ScrapedScreening[] {
  const out: ScrapedScreening[] = [];

  for (const e of events) {
    if (e.format_id !== SCREENING_FORMAT_ID) continue;

    const rawTitle = (e.name?.text ?? '').trim();
    if (!rawTitle) {
      warnings.push('event with no name — skipped');
      continue;
    }

    const skip = nonFeatureReason(rawTitle);
    if (skip) continue;

    const startsAtUtc = toUtc(e.start);
    if (!startsAtUtc) {
      warnings.push(`${rawTitle}: unparseable start ${JSON.stringify(e.start)}`);
      continue;
    }
    // The "future" feed occasionally retains an event whose start has already
    // passed. Drop it: ingest only ever deletes FUTURE rows, so a past-dated
    // insert would become a permanent orphan no later scrape can clean up.
    if (startsAtUtc <= now) continue;

    const parsed = parseEventTitle(rawTitle);
    if (!parsed.filmTitle) {
      warnings.push(`${rawTitle}: title parsed to empty — skipped`);
      continue;
    }

    const tags: ScreeningTag[] = parsed.programName ? ['cycle'] : [];

    out.push({
      cinemaId: CINEMA_ID,
      filmTitle: parsed.filmTitle,
      startsAtUtc,
      tags,
      ...(parsed.filmTitleOriginal !== undefined
        ? { filmTitleOriginal: parsed.filmTitleOriginal }
        : {}),
      ...(parsed.director !== undefined ? { director: parsed.director } : {}),
      ...(parsed.year !== undefined ? { year: parsed.year } : {}),
      ...(parsed.programName !== undefined ? { programName: parsed.programName } : {}),
      sourceUrl: e.url ?? ORG_URL,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Title parsing
// ---------------------------------------------------------------------------

export interface ParsedTitle {
  filmTitle: string;
  filmTitleOriginal?: string;
  director?: string;
  year?: number;
  programName?: string;
}

/**
 * Cycle prefixes are freeform, so we gate the "PREFIX: film" split on a
 * keyword rather than splitting on every colon. Without the gate,
 * `Mobile Suit Gundam: "Char's Counterattack"` loses the franchise half of
 * its real TMDB title, and `NIRVANNA: "The band,the show, the movie"` loses
 * the word TMDB actually indexes it under.
 *
 * `X`/`POR` catch the recurring themed nights, which have no other marker:
 * TERROR X MUJERES, CIENCIA FICCION POR MUJERES, MUSICALES X MUJERES.
 */
const PROGRAM_KEYWORD_RE =
  /\b(CICLO|PRESENTA|ESPECIAL|MARAT[OÓ]N|SESIONES|VHS)\b|\s(X|POR)\s/i;

/** Directors written as `(Nombre Apellido, 1999)` — the commonest form. */
const DIRECTOR_YEAR_PAREN_RE = /\(\s*([^(),\d]{3,60}?)\s*,\s*(\d{4})\s*\)/;
/** A bare `(1999)`. */
const YEAR_PAREN_RE = /\(\s*(\d{4})\s*\)/;
/** `Dir. Nombre Apellido`, always terminal. */
const DIR_LABEL_RE = /\bDir\.\s*(.+?)\s*$/i;
/**
 * `de Nombre Apellido`, terminal. Case-SENSITIVE on lowercase `de` — that one
 * detail is what separates `SHADOWS de John Cassavets` (director) from
 * `PERROS DE LA CALLE` (title). Lucero writes film titles in caps and
 * attribution in prose case.
 */
const DE_DIRECTOR_RE = /\sde\s+(\p{Lu}[\p{L}.'-]*(?:\s+(?:&|y|\p{Lu}[\p{L}.'-]*))*)\s*$/u;
/**
 * `TITULO - MEL BROOKS` — an ALL-CAPS director after a dash. Deliberately
 * narrow: 2–3 words, no articles/conjunctions, so it can't swallow a title
 * like `EL BUENO - EL MALO Y EL FEO`.
 */
const DASH_DIRECTOR_RE =
  /\s[-–—]\s+(\p{Lu}[\p{Lu}.'-]+(?:\s+\p{Lu}[\p{Lu}.'-]+){1,2})\s*$/u;
const DASH_DIRECTOR_STOPWORDS =
  /\b(EL|LA|LOS|LAS|UN|UNA|Y|O|DE|DEL|EN|CON|THE|OF|AND|A)\b/;

const QUOTE_RE = /["“”«»]([^"“”«»]+)["“”«»]/g;
/**
 * Quoted spans are masked with a delimited index before any metadata regex
 * runs. The `@@` delimiters matter: a bare number would be indistinguishable
 * from digits in a real title (`"76 89 23"`, `TORSO (1973)`) and the unmasking
 * pass would corrupt them.
 */
const QUOTE_TOKEN = (i: number) => `@@${i}@@`;
const QUOTE_TOKEN_RE = /@@(\d+)@@/g;
/** A parenthetical sitting directly after a quoted span. */
const ORIGINAL_TITLE_RE = /@@\d+@@\s*\(\s*([^)]+?)\s*\)/;

/**
 * Pull a film title (plus whatever metadata the operator hand-typed) out of
 * one Eventbrite event name.
 *
 * The load-bearing idea: the operator consistently *quotes* the film title
 * when the name carries anything else, so quoted spans are masked out before
 * any metadata regex runs. That keeps `"SPIDERMAN - ACROSS THE SPIDER-VERSE"`
 * from being mistaken for a dash-director, and `"76 89 23"` from being read
 * as a year.
 *
 * A quoted span becomes the whole title only when nothing meaningful is left
 * outside it. Otherwise the unquoted words are kept — that's what preserves
 * `Mobile Suit Gundam: Char's Counterattack`.
 */
export function parseEventTitle(raw: string): ParsedTitle {
  const s = raw.replace(/\s+/g, ' ').trim();

  // 1. Cycle prefix — split on the FIRST colon only, so a title with its own
  //    colon survives (`VHS ANIMÉ PRESENTA:Dragon Ball Z: El Ataque del Dragón`).
  let programName: string | undefined;
  let body = s;
  const colon = s.match(/^([^:]{2,60}?)\s*:\s*(.+)$/);
  if (colon && PROGRAM_KEYWORD_RE.test(colon[1])) {
    programName = colon[1].trim();
    body = colon[2].trim();
  }

  // 2. Mask quoted spans so metadata regexes only ever see unquoted text.
  const quotes: string[] = [];
  let masked = body.replace(QUOTE_RE, (_m, inner: string) => {
    quotes.push(inner.trim());
    return QUOTE_TOKEN(quotes.length - 1);
  });

  // 3. Metadata, most specific first.
  let director: string | undefined;
  let year: number | undefined;

  const dirYear = masked.match(DIRECTOR_YEAR_PAREN_RE);
  if (dirYear) {
    director = dirYear[1].trim();
    year = validYear(dirYear[2]);
    masked = masked.replace(DIRECTOR_YEAR_PAREN_RE, ' ');
  }

  const yearOnly = masked.match(YEAR_PAREN_RE);
  if (yearOnly) {
    year ??= validYear(yearOnly[1]);
    masked = masked.replace(YEAR_PAREN_RE, ' ');
  }

  if (!director) {
    const dirLabel = masked.match(DIR_LABEL_RE);
    if (dirLabel) {
      director = dirLabel[1].trim().replace(/[.,;]+$/, '');
      masked = masked.replace(DIR_LABEL_RE, ' ');
    }
  }

  if (!director) {
    const de = masked.match(DE_DIRECTOR_RE);
    if (de) {
      director = de[1].trim().replace(/[.,;]+$/, '');
      masked = masked.replace(DE_DIRECTOR_RE, ' ');
    }
  }

  if (!director) {
    const dash = masked.match(DASH_DIRECTOR_RE);
    if (dash && !DASH_DIRECTOR_STOPWORDS.test(dash[1])) {
      director = dash[1].trim().replace(/[.,;]+$/, '');
      masked = masked.replace(DASH_DIRECTOR_RE, ' ');
    }
  }

  // 4. Original title: a parenthetical directly after a quoted span, e.g.
  //    `"Battle Angel Alita" (Gunnm)`. Requiring the adjacency is what stops
  //    `RIÑON PELVICO (Parte Dos)` from claiming an original title.
  let filmTitleOriginal: string | undefined;
  const afterQuote = masked.match(ORIGINAL_TITLE_RE);
  if (afterQuote) {
    filmTitleOriginal = afterQuote[1].trim();
    masked = masked.replace(ORIGINAL_TITLE_RE, (m) => m.slice(0, m.indexOf('(')));
  }

  // 5. Title. If the unquoted remainder is only punctuation, the quoted spans
  //    ARE the title; otherwise keep everything, quotes inlined.
  const remainder = masked.replace(QUOTE_TOKEN_RE, ' ');
  const filmTitle =
    quotes.length > 0 && !hasWords(remainder)
      ? cleanTitle(quotes.join(' '))
      : cleanTitle(masked.replace(QUOTE_TOKEN_RE, (_m, i: string) => quotes[Number(i)]));

  return {
    filmTitle,
    ...(filmTitleOriginal !== undefined ? { filmTitleOriginal } : {}),
    ...(director !== undefined ? { director } : {}),
    ...(year !== undefined ? { year } : {}),
    ...(programName !== undefined ? { programName } : {}),
  };
}

function hasWords(s: string): boolean {
  return /[\p{L}\p{N}]/u.test(s);
}

/** Collapse whitespace and shave the punctuation metadata removal leaves behind. */
function cleanTitle(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s*([,;:])\s*$/, '')
    .replace(/^\s*[-–—:,;.]+\s*/, '')
    .replace(/\s*[-–—:,;]+\s*$/, '')
    .replace(/\s+\.\s*$/, '')
    .trim();
}

function validYear(raw: string): number | undefined {
  const n = Number(raw);
  // Cinema starts in 1888 (Roundhay Garden Scene); allow a little lead time
  // for announced-but-unreleased titles.
  if (!Number.isFinite(n) || n < 1888 || n > new Date().getUTCFullYear() + 2) {
    return undefined;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * Eventbrite gives a true UTC instant in `start.utc`. Prefer it; fall back to
 * shifting the BA wall-clock in `start.local` by +3h (Argentina is UTC-3, no
 * DST) if that field ever goes missing.
 */
export function toUtc(start: ApiEventStart | undefined): Date | null {
  if (!start) return null;

  if (start.utc) {
    const d = new Date(start.utc);
    if (!Number.isNaN(d.getTime())) return d;
  }

  return baLocalToUtc(start.local);
}

/** "2026-07-30T18:00:00" (BA wall-clock) -> true UTC Date. */
export function baLocalToUtc(raw: string | undefined): Date | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const [y, mo, d, h, min] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h + 3, min, 0, 0));
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      // Eventbrite serves the showmore endpoint to browsers only; a bare or
      // CI user-agent gets a challenge page instead of JSON.
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      'Accept-Language': 'es-AR,es;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
