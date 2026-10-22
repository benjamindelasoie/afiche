/**
 * Cineclub Lucero provider. The first-floor sala of Club Lucero, a bar in
 * Palermo Hollywood. Wed–Fri programming in the sala, Tuesdays outdoors on
 * the patio (audio via wireless headphones so the bar keeps running).
 *
 * Strategy: they have no site of their own worth scraping — clublucero.com is
 * 410 Gone and the @cineclublucero IG account has been removed. Their own
 * Linktree points "ENTRADAS CINE" straight at an Eventbrite organizer page.
 * Two JSON calls, no HTML parsing:
 *
 *  1. The organizer page's own listing API (what its "Show more" button
 *     calls) gives the ids of every upcoming event. It carries no format.
 *  2. Eventbrite's public destination API, asked for exactly those ids, adds
 *     the `EventbriteFormat/<id>` tag the feature-only filter needs.
 *
 * Originally a single `/org/<orgId>/showmore/` call did both. By 2026-10 Eventbrite
 * rebuilt the organizer page and that endpoint now answers 403 from CloudFront
 * for every query variant. The organizer page itself no longer references it.
 *
 * TIMEZONE: neither API gives a UTC instant any more, only the event's
 * wall-clock (`start_date` + `start_time`) and its IANA zone. Lucero's events
 * are all in America/Argentina/Buenos_Aires, so the standard +3h shift applies
 * (Argentina is UTC-3, no DST); an event in any other zone is skipped with a
 * warning rather than mis-timed.
 *
 * SCOPE (v1): features only. The organizer publishes DJ nights, impro courses
 * and parties alongside screenings, plus a handful of non-feature events filed
 * under the same "Screening" format. See FEATURE-ONLY FILTER below.
 *
 * Neither API gives runtime/country/synopsis; TMDB enrichment fills those.
 */

import { type Provider, type ProviderRunResult, type ScrapedScreening } from './types';
import type { ScreeningTag } from '@/db';

const CINEMA_ID = 'cineclub-lucero'; // our cinemas.id
const ORG_ID = '34315560147'; // Club Lucero on Eventbrite
const ORG_EVENTS_URL = `https://www.eventbrite.com/organizer-profile/api/organizers/${ORG_ID}/events/`;
const DESTINATION_URL = 'https://www.eventbrite.com/api/v3/destination/events/';
const ORG_URL = `https://www.eventbrite.com/o/club-lucero-${ORG_ID}`;
const PAGE_SIZE = 50; // also the destination API's page size, so one id batch = one page
const MAX_PAGES = 10; // backstop; the upcoming feed has never exceeded one page
const REQUEST_DELAY_MS = 300;
const FETCH_TIMEOUT_MS = 20_000;

/**
 * Eventbrite's format id for "Screening" (tag `EventbriteFormat/7`). Stable
 * across categories — the organizer files films under Film & Media (104),
 * Arts (105) and even Spirituality (114), but the format is 7 for all of them.
 * Filtering on format instead of the category label is what keeps the
 * Bergman / Life of Brian night from being dropped.
 */
const SCREENING_FORMAT_ID = '7';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// --- API response shapes (only the fields we use) --------------------------

/** GET /organizer-profile/api/organizers/<orgId>/events/?page=N&pageSize=50 */
export interface OrgEventsResponse {
  events?: Array<{ id?: string; is_cancelled?: boolean | null }>;
  hasMore?: boolean;
}

/** One event from GET /api/v3/destination/events/?event_ids=<csv> */
export interface ApiEvent {
  id?: string;
  name?: string;
  url?: string;
  start_date?: string; // "2026-10-22" — wall-clock in `timezone`
  start_time?: string; // "21:00"
  timezone?: string; // "America/Argentina/Buenos_Aires"
  tags?: Array<{ prefix?: string; tag?: string }>; // { prefix: 'EventbriteFormat', tag: 'EventbriteFormat/7' }
}

export interface DestinationResponse {
  events?: ApiEvent[];
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
      const ids: string[] = [];
      let listed = 0;

      for (let page = 1; page <= MAX_PAGES; page++) {
        const resp = await fetchJson<OrgEventsResponse>(
          `${ORG_EVENTS_URL}?page=${page}&pageSize=${PAGE_SIZE}`,
        );
        const pageEvents = resp.events ?? [];
        listed += pageEvents.length;
        for (const e of pageEvents) {
          if (e.id && e.is_cancelled !== true) ids.push(e.id);
        }

        if (resp.hasMore !== true) break;
        if (page === MAX_PAGES) {
          warnings.push(`stopped at MAX_PAGES=${MAX_PAGES} with hasMore still true`);
        }
        await sleep(REQUEST_DELAY_MS);
      }

      if (listed === 0) {
        // An organizer with literally zero upcoming events of ANY kind is the
        // signature of a moved/renamed org or a changed response shape — not
        // a quiet week. Fail loudly so it surfaces in the run log.
        return {
          cinemaId: CINEMA_ID,
          screenings: [],
          success: false,
          warnings,
          error:
            'organizer listing returned no events at all — org id or API shape may have changed.',
        };
      }

      const events: ApiEvent[] = [];
      for (let i = 0; i < ids.length; i += PAGE_SIZE) {
        const batch = ids.slice(i, i + PAGE_SIZE);
        await sleep(REQUEST_DELAY_MS);
        const resp = await fetchJson<DestinationResponse>(
          `${DESTINATION_URL}?event_ids=${batch.join(',')}&page_size=${PAGE_SIZE}`,
        );
        events.push(...(resp.events ?? []));
      }
      if (events.length < ids.length) {
        // Not fatal (what did come back is still good), but a silent shortfall
        // would hide films, so say how many went missing.
        warnings.push(
          `destination API returned ${events.length} of ${ids.length} listed events`,
        );
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
 * v1 scope decision: Afiche's cartelera carries feature films only. Untyped
 * events (no `EventbriteFormat` tag at all) are excluded wholesale by the
 * format filter, because nothing in the payload distinguishes a film from a
 * party there. Revisit if the operator wants that tail.
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
  // Festival shorts blocks (FESTIVAL BITBANG! CORTOS INTERNACIONALES I..XII).
  // Plural only: a singular CORTO can be a title word (Corto Maltés).
  { re: /\b(CORTOS|CORTOMETRAJES)\b/i, why: 'shorts programme' },
];

export function nonFeatureReason(title: string): string | undefined {
  return NON_FEATURE_PATTERNS.find((p) => p.re.test(title))?.why;
}

// ---------------------------------------------------------------------------
// Pure mapping (exported for fixture tests)
// ---------------------------------------------------------------------------

/**
 * Map destination-API events to screenings. `now` is passed in (not read from
 * the clock) so tests can pin it.
 */
export function parseEvents(
  events: ApiEvent[],
  now: Date,
  warnings: string[] = [],
): ScrapedScreening[] {
  const out: ScrapedScreening[] = [];

  for (const e of events) {
    if (formatId(e) !== SCREENING_FORMAT_ID) continue;

    const rawTitle = (e.name ?? '').trim();
    if (!rawTitle) {
      warnings.push('event with no name — skipped');
      continue;
    }

    const skip = nonFeatureReason(rawTitle);
    if (skip) continue;

    if (e.timezone && !e.timezone.startsWith('America/Argentina/')) {
      warnings.push(`${rawTitle}: unexpected timezone ${e.timezone} — skipped`);
      continue;
    }
    const startsAtUtc = toUtc(e);
    if (!startsAtUtc) {
      warnings.push(
        `${rawTitle}: unparseable start ${JSON.stringify([e.start_date, e.start_time])}`,
      );
      continue;
    }
    // The upcoming feed keeps an event listed until it ENDS, so tonight's
    // already-started session is still in it. Drop it: ingest only ever deletes FUTURE rows, so a past-dated
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
 * A "PREFIX: film" split needs a trigger, because a colon can equally be part
 * of the work's own name. Two triggers, either sufficient:
 *
 *  1. A QUOTED title follows the colon. When the operator quotes the film,
 *     they're marking where the title starts, so whatever precedes it is
 *     curatorial. This is the load-bearing one — cycle names are invented
 *     constantly (#BRINGBACK2016, JOYSTICK A LA PANTALLA, AMORES NOVENTOSOS
 *     and COSMOS all appeared inside one month), so an allowlist can't keep
 *     up. `COSMOS: "INTERSTELLAR"` matters especially: left unsplit it forks
 *     a second films row alongside the plain INTERSTELLAR already scraped.
 *  2. The prefix carries a cycle keyword. Needed for the unquoted cases —
 *     `Ciclo OPERAS PRIMAS: SHADOWS de John Cassavets`,
 *     `PELICULERO PRESENTA: STRANGE DARLING`.
 *
 * `X`/`POR` catch the recurring themed nights, which have no other marker:
 * TERROR X MUJERES, CIENCIA FICCION POR MUJERES, MUSICALES X MUJERES.
 */
const PROGRAM_KEYWORD_RE =
  /\b(CICLO|PRESENTA|ESPECIAL|MARAT[OÓ]N|SESIONES|VHS)\b|\s(X|POR)\s/i;

/**
 * Prefixes that are part of the FILM's title, not a cycle — the exception to
 * trigger 1 above. Both are franchise halves TMDB indexes the full string
 * under, so splitting them loses the match. Keep this list tight: it only
 * earns its place for works whose real title contains a colon AND whose
 * event name quotes the second half.
 */
const FRANCHISE_PREFIX_RE = /^(NIRVANNA|MOBILE SUIT GUNDAM)$/i;

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
/** Same shape, non-global — `.test()` on a /g regex mutates `lastIndex`. */
const HAS_QUOTED_SPAN_RE = /["“”«»][^"“”«»]+["“”«»]/;
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
 *
 * THESE REGEXES ARE EFFECTIVELY FROZEN. `filmTitle` and `year` become the
 * immutable `(scrapedTitle, scrapedYear)` upsert key in `films`, and
 * `tmdb-overrides.json` is keyed on `scrapedTitle` as well. Changing a rule
 * therefore forks a new film row for every title whose parse shifts, and
 * silently un-keys any manual TMDB override written against the old string —
 * which bites hardest on exactly the films that needed manual help. The golden
 * corpus in `cineclub-lucero.test.ts` pins all 82 published titles so such a
 * shift fails CI instead of landing quietly. If a change is intended: update
 * the corpus fixture in the same commit, re-key affected `tmdb-overrides.json`
 * entries, and UPDATE the existing `films.scraped_title` rather than letting a
 * duplicate row appear.
 */
export function parseEventTitle(raw: string): ParsedTitle {
  const s = raw.replace(/\s+/g, ' ').trim();

  // 1. Cycle prefix — split on the FIRST colon only, so a title with its own
  //    colon survives (`VHS ANIMÉ PRESENTA:Dragon Ball Z: El Ataque del Dragón`).
  let programName: string | undefined;
  let body = s;
  const colon = s.match(/^([^:]{2,60}?)\s*:\s*(.+)$/);
  if (colon) {
    const prefix = colon[1].trim();
    const rest = colon[2].trim();
    const quotedTitleFollows = HAS_QUOTED_SPAN_RE.test(rest);
    const isCycle =
      (quotedTitleFollows || PROGRAM_KEYWORD_RE.test(prefix)) &&
      !FRANCHISE_PREFIX_RE.test(prefix);
    if (isCycle) {
      programName = prefix;
      body = rest;
    }
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
      // Since Oct 2026 the credit runs on: `Dir. Name · País · 1990 · 97 min`.
      // Only the first segment is the director; a bare 4-digit segment is the year.
      const [name, ...credits] = dirLabel[1].split('·').map((part) => part.trim());
      director = name.replace(/[.,;]+$/, '');
      year ??= validYear(credits.find((part) => /^\d{4}$/.test(part)) ?? '');
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

/** `EventbriteFormat/7` -> "7"; undefined for an untyped event. */
export function formatId(e: Pick<ApiEvent, 'tags'>): string | undefined {
  const tag = e.tags?.find((t) => t.prefix === 'EventbriteFormat')?.tag;
  return tag?.split('/')[1];
}

/**
 * The event's BA wall-clock (`start_date` + `start_time`) as a true UTC Date.
 * Callers have already checked the zone is an Argentine one.
 */
export function toUtc(e: Pick<ApiEvent, 'start_date' | 'start_time'>): Date | null {
  if (!e.start_date || !e.start_time) return null;
  return baLocalToUtc(`${e.start_date}T${e.start_time}`);
}

/** "2026-07-30T18:00" (BA wall-clock, seconds optional) -> true UTC Date. */
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
      // Both endpoints answer a bare user-agent today, but Eventbrite has
      // challenged non-browser clients before; look like the page's own JS.
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      'Accept-Language': 'es-AR,es;q=0.9',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
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
