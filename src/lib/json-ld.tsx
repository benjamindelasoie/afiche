/**
 * Schema.org JSON-LD payload builders for Afiche.
 *
 * Two surfaces emit JSON-LD today:
 *   1. The homepage `/` — `@graph` array of `ScreeningEvent` objects covering
 *      today + next 6 days (the 7-day high-intent window — see eng-review D3
 *      / design doc 20260517-135641). Indexed by Google (homepage has no
 *      `noindex`).
 *   2. `/pelicula/<slug>` alive — `Movie` at root with `subjectOf.itemListElement`
 *      populated with the film's upcoming `ScreeningEvent` rows. Read-and-
 *      discarded by Google today (page is `noindex` per Strategy A); structured
 *      data is pre-baked for the moment the revisit-trigger fires and noindex
 *      is dropped. Do NOT interpret presence as commitment to flip.
 *
 * Module shape: composable atoms (buildMovie, buildMovieTheater,
 * buildScreeningEvent) plus per-page top-level wrappers (buildHomepageJsonLd,
 * buildFilmPageJsonLd) per eng-review D2. Atoms are tested independently;
 * wrappers are thin compositions tested at the integration boundary.
 *
 * Inline emission of the payload into HTML is the `<JsonLd>` component in
 * json-ld.tsx — that's the only file that knows about <script> tags and
 * dangerouslySetInnerHTML. Callers should NEVER inline serialize() into
 * their own <script> tags.
 */
import { BA_TZ } from './date-ranges';
import type { ScreeningRow } from '@/db/queries';

/** Schema.org @context value emitted at the root of every top-level JSON-LD payload. */
const SCHEMA_ORG_CONTEXT = 'https://schema.org';

/** Window for homepage ScreeningEvent emit. See eng-review D3 for rationale. */
const HOMEPAGE_JSON_LD_DAYS = 7;

const ONE_DAY_MS = 86_400_000;
const ONE_MINUTE_MS = 60_000;

/**
 * Format a runtime as an ISO 8601 duration string (`PT{N}M`). Schema.org's
 * Movie.duration field consumes this shape.
 */
function isoDuration(minutes: number): string {
  return `PT${minutes}M`;
}

/**
 * Format a UTC Date as a BA-local ISO 8601 datetime string with explicit
 * `-03:00` offset (NOT UTC `Z`). Argentina is fixed at UTC-3 year-round —
 * no DST — so the offset is a literal constant.
 *
 * Google's Event rich result displays the event time using the offset in
 * the JSON-LD startDate. Emitting UTC `Z` would show event times 3 hours
 * earlier than the actual BA local time — a critical correctness bug
 * disguised as a representation choice.
 */
function isoBaLocal(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // The 'en-CA' locale emits 24-hour `00` for midnight; some Intl runtimes
  // return `24` for midnight in 24-hour mode — normalize defensively.
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}-03:00`;
}

// ---------------------------------------------------------------------------
// Atomic builders — each emits one Schema.org type, no @context wrapper.
// ---------------------------------------------------------------------------

export interface MovieJsonLd {
  '@type': 'Movie';
  name: string;
  image?: string;
  description?: string;
  director?: { '@type': 'Person'; name: string };
  /** Year as a string ("2001"). Schema.org accepts year-only datePublished. */
  datePublished?: string;
  /** ISO 8601 duration: `PT{N}M`. */
  duration?: string;
}

export interface MovieTheaterJsonLd {
  '@type': 'MovieTheater';
  name: string;
  address?: string;
  addressLocality?: string;
}

export interface ScreeningEventJsonLd {
  '@type': 'ScreeningEvent';
  name: string;
  startDate: string;
  endDate?: string;
  eventStatus: 'https://schema.org/EventScheduled';
  eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode';
  location: MovieTheaterJsonLd;
  /**
   * Schema.org's ScreeningEvent property linking to the work shown. Spelled
   * `workPresented` (not `workPerformed` — that's for live theater /
   * concerts / PerformingArtsEvent).
   */
  workPresented: MovieJsonLd;
}

/**
 * Schema.org Movie. Only `name` is required by Schema.org; everything else
 * is omitted when the source field is null. TMDB-enriched films have most
 * fields populated; pre-enrichment / long-tail festival titles may have
 * only the title.
 */
export function buildMovie(film: ScreeningRow['film']): MovieJsonLd {
  const m: MovieJsonLd = {
    '@type': 'Movie',
    name: film.title,
  };
  if (film.posterUrl) m.image = film.posterUrl;
  if (film.synopsisEs) m.description = film.synopsisEs;
  if (film.director) m.director = { '@type': 'Person', name: film.director };
  if (film.year) m.datePublished = String(film.year);
  if (film.runtimeMin) m.duration = isoDuration(film.runtimeMin);
  return m;
}

/**
 * Schema.org MovieTheater. `address` is the street address when known;
 * `addressLocality` is the neighborhood. Google's Event rich result
 * prefers a complete address but accepts MovieTheater with just `name`.
 */
export function buildMovieTheater(cinema: ScreeningRow['cinema']): MovieTheaterJsonLd {
  const t: MovieTheaterJsonLd = {
    '@type': 'MovieTheater',
    name: cinema.name,
  };
  if (cinema.address) t.address = cinema.address;
  if (cinema.neighborhood) t.addressLocality = cinema.neighborhood;
  return t;
}

/**
 * Schema.org ScreeningEvent. Always emits the four required-by-Google
 * properties (name, startDate, eventStatus, location) plus
 * eventAttendanceMode. endDate is computed as `startDate + runtimeMin`
 * when the film's runtime is known; omitted otherwise (a partial Event
 * with no endDate is still valid Schema.org and still gets rich-result
 * eligibility).
 */
export function buildScreeningEvent(s: ScreeningRow): ScreeningEventJsonLd {
  const event: ScreeningEventJsonLd = {
    '@type': 'ScreeningEvent',
    name: `${s.film.title} en ${s.cinema.name}`,
    startDate: isoBaLocal(s.startsAtUtc),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: buildMovieTheater(s.cinema),
    workPresented: buildMovie(s.film),
  };
  if (s.film.runtimeMin) {
    const end = new Date(s.startsAtUtc.getTime() + s.film.runtimeMin * ONE_MINUTE_MS);
    event.endDate = isoBaLocal(end);
  }
  return event;
}

// ---------------------------------------------------------------------------
// Top-level page wrappers — assemble a full @context'd payload per page.
// ---------------------------------------------------------------------------

export interface HomepageJsonLd {
  '@context': typeof SCHEMA_ORG_CONTEXT;
  '@graph': ScreeningEventJsonLd[];
}

/**
 * Build the homepage JSON-LD payload. Filters the input screenings to the
 * 7-day high-intent window (today + next 6 days, per eng-review D3 — the
 * visible page shows 14 days but the JSON-LD emits the 7-day cut where
 * most search intent lives). Emits as a `@graph` array of standalone
 * `ScreeningEvent` objects per Google's Event rich-result documentation
 * (which favors `@graph` over `ItemList` for multi-event pages).
 */
export function buildHomepageJsonLd(
  screenings: ScreeningRow[],
  options: { now?: Date } = {},
): HomepageJsonLd {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() + HOMEPAGE_JSON_LD_DAYS * ONE_DAY_MS);
  const window = screenings.filter((s) => s.startsAtUtc < cutoff);
  return {
    '@context': SCHEMA_ORG_CONTEXT,
    '@graph': window.map(buildScreeningEvent),
  };
}

export type FilmPageJsonLd = MovieJsonLd & {
  '@context': typeof SCHEMA_ORG_CONTEXT;
  subjectOf: {
    '@type': 'ItemList';
    itemListElement: ScreeningEventJsonLd[];
  };
};

/**
 * Build the /pelicula/<slug> JSON-LD payload. Root type is `Movie` (not
 * `ItemList`) — the page's primary content is a single film, with its
 * upcoming screenings as the subject of an inner `ItemList`. This shape
 * is what Google's Movie rich result accepts.
 *
 * Callers MUST gate the mount on `screenings.length > 0` — emitting
 * `Movie` with an empty `subjectOf.itemListElement` would semantically
 * misrepresent the data and could trip soft-404 classification. The
 * page's `notFound()` branch achieves this by returning before render.
 */
export function buildFilmPageJsonLd(
  film: ScreeningRow['film'],
  screenings: ScreeningRow[],
): FilmPageJsonLd {
  const movie = buildMovie(film);
  return {
    '@context': SCHEMA_ORG_CONTEXT,
    ...movie,
    subjectOf: {
      '@type': 'ItemList',
      itemListElement: screenings.map(buildScreeningEvent),
    },
  };
}

// ---------------------------------------------------------------------------
// Serialization — inline-script-safe JSON encoding.
// ---------------------------------------------------------------------------

/**
 * Serialize a JSON-LD payload for inline `<script type="application/ld+json">`
 * emission. Three transforms beyond `JSON.stringify`:
 *
 *   1. `</` sequences are escaped to `<\/`. This prevents a script-tag
 *      breakout XSS when any string field (TMDB-derived film titles or
 *      synopses, scraper-derived program names) happens to contain a
 *      literal `</script>` sequence. Load-bearing, not theoretical — TMDB
 *      strings are external-API content and not fully trusted.
 *   2. `U+2028` (line separator) and `U+2029` (paragraph separator) are
 *      escaped to ` ` / ` `. Both are valid JSON characters but
 *      historically broke browser JavaScript parsing of inline JSON. ECMA
 *      2019 fixed parser support; some older crawlers still trip.
 *
 * Called exclusively by the `<JsonLd>` component in json-ld.tsx, which
 * wraps the result in `dangerouslySetInnerHTML`. NEVER inline this output
 * via raw string interpolation into JSX — React would HTML-escape the
 * quotes and break the JSON parse.
 */
export function serialize(payload: unknown): string {
  return JSON.stringify(payload)
    .replace(/<\//g, '<\\/')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
}

// ---------------------------------------------------------------------------
// Inline-script-emit React Server Component.
//
// Confines the unsafe React keyword (`dangerouslySetInnerHTML`) and the
// serialize-with-escape mechanics to one symbol. Both surfaces that emit
// JSON-LD (homepage + /pelicula/<slug>) import this component and pass a
// payload built by the builders above.
//
// Why `dangerouslySetInnerHTML`: React would otherwise HTML-escape the
// payload's quotes (turning `"` into `&quot;`), breaking the JSON parse
// when a crawler reads the page. The `serialize()` helper makes this safe
// by escaping `</` sequences to `<\/` so a film synopsis containing a
// literal `</script>` cannot break out of the surrounding tag.
//
// Why a Server Component: no client-side JavaScript needed. The script
// tag renders into the SSR'd HTML, gets read by crawlers and bots, and
// costs zero hydration.
// ---------------------------------------------------------------------------

export interface JsonLdProps {
  payload: unknown;
}

export function JsonLd({ payload }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      // Inline JSON-LD requires dangerouslySetInnerHTML — React would
      // otherwise HTML-escape the JSON's quotes and break crawler parsing.
      // serialize() handles the </ → <\/ script-breakout escape so this
      // is safe even with external-API-derived strings (TMDB synopses,
      // film titles, etc.).
      dangerouslySetInnerHTML={{ __html: serialize(payload) }}
    />
  );
}
