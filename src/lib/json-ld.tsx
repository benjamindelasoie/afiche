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
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION, SITE_SOURCE_URL } from './site';
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
  /**
   * Stable URN identifying this Movie across every embedding on the
   * page. Schema.org parsers (including Google's) deduplicate entities
   * by `@id` — so the same Movie embedded in 20 different
   * ScreeningEvents resolves to a single entity in the parsed graph
   * instead of 20 distinct objects. Form: `urn:afiche:film:<slug>`.
   * Omitted when the film has no slug (legacy rows pre-backfill).
   */
  '@id'?: string;
  name: string;
  /**
   * Always present. Real TMDB poster when available, falls back to the
   * branded `/no-poster.svg` when the film hasn't been enriched.
   */
  image: string;
  description?: string;
  director?: { '@type': 'Person'; name: string };
  /** Year as a string ("2001"). Schema.org accepts year-only datePublished. */
  datePublished?: string;
  /** ISO 8601 duration: `PT{N}M`. */
  duration?: string;
}

/**
 * Schema.org PostalAddress. Google's Event rich result strongly prefers
 * structured location data over a plain `address` string. Schema.org's
 * `addressLocality` is the city (e.g., "Buenos Aires"); `addressRegion`
 * is the state/province; `streetAddress` is the line for street + number.
 * The cinema's neighborhood (e.g., "Palermo", "San Nicolás") is a sub-
 * locality which Schema.org has no formal slot for — it stays in the DB
 * and UI but does not surface in JSON-LD.
 */
export interface PostalAddressJsonLd {
  '@type': 'PostalAddress';
  streetAddress?: string;
  addressLocality: string;
  addressCountry: string;
}

export interface MovieTheaterJsonLd {
  '@type': 'MovieTheater';
  /**
   * Stable URN identifying this MovieTheater across every embedding on
   * the page. Same entity-deduplication purpose as `MovieJsonLd['@id']`
   * — Schema.org parsers see the same theater across N ScreeningEvents
   * as one entity, not N. Form: `urn:afiche:cine:<cinema-id>` (where
   * cinema-id is the slug from the `cinemas` table). URN form rather
   * than URL because `/cine/<slug>` pages do not exist yet (see
   * TODO #14 — when they ship, this can switch to the canonical URL
   * without a content change).
   */
  '@id': string;
  name: string;
  address: PostalAddressJsonLd;
}

/**
 * Hardcoded locality for every BA cinema's MovieTheater.address. Schema.org
 * requires addressLocality on PostalAddress; Afiche's geographic scope is
 * BA-only, so the value is a constant.
 */
const ADDRESS_LOCALITY = 'Buenos Aires';
/** ISO 3166-1 alpha-2 country code for Argentina. */
const ADDRESS_COUNTRY = 'AR';

/** URN prefix for Movie entity identifiers. See MovieJsonLd['@id']. */
const FILM_URN_PREFIX = 'urn:afiche:film:';
/** URN prefix for MovieTheater entity identifiers. See MovieTheaterJsonLd['@id']. */
const CINEMA_URN_PREFIX = 'urn:afiche:cine:';

/**
 * Fully-qualified URL of the branded fallback poster. Used as the Movie
 * `image` value when the film has no TMDB-sourced posterUrl, so the
 * Schema.org ScreeningEvent still satisfies Google's image-required
 * rich-result eligibility check. The asset lives at `public/no-poster.svg`
 * (carmine field, cream serif "A", "SIN AFICHE" wordmark — matches the
 * favicon's brand mark). Built from the canonical SITE_URL (src/lib/site.ts),
 * the same origin as the OG `metadataBase`.
 */
const NO_POSTER_URL = `${SITE_URL}/no-poster.svg`;

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
  // Image is always emitted — Google's Event rich-result eligibility
  // requires it. Falls back to the branded SVG when the film hasn't
  // been TMDB-enriched (or TMDB had no poster on file). Same asset is
  // used as the visual fallback on the homepage card and /pelicula
  // hero, so the JSON-LD mirrors what users see.
  const m: MovieJsonLd = {
    '@type': 'Movie',
    name: film.title,
    image: film.posterUrl ?? NO_POSTER_URL,
  };
  // @id placed immediately after @type when slug is available.
  // Object-key insertion order is preserved by JSON.stringify in V8 /
  // SpiderMonkey / JavaScriptCore so the serialized output reads
  // canonically (@type, @id, name, image, ...). Slug is contractually
  // non-null post-backfill but typed nullable for legacy rows.
  if (film.slug) m['@id'] = `${FILM_URN_PREFIX}${film.slug}`;
  if (film.synopsisEs) m.description = film.synopsisEs;
  if (film.director) m.director = { '@type': 'Person', name: film.director };
  if (film.year) m.datePublished = String(film.year);
  if (film.runtimeMin) m.duration = isoDuration(film.runtimeMin);
  return m;
}

/**
 * Schema.org MovieTheater. `address` is always a `PostalAddress` object —
 * Google's Event rich result classifies a plain-string `address` as
 * unstructured and downgrades validation. `addressLocality` and
 * `addressCountry` are always emitted (constants since Afiche is BA-only);
 * `streetAddress` is included when the cinema row has it.
 */
export function buildMovieTheater(cinema: ScreeningRow['cinema']): MovieTheaterJsonLd {
  const address: PostalAddressJsonLd = {
    '@type': 'PostalAddress',
    addressLocality: ADDRESS_LOCALITY,
    addressCountry: ADDRESS_COUNTRY,
  };
  if (cinema.address) address.streetAddress = cinema.address;
  return {
    '@type': 'MovieTheater',
    '@id': `${CINEMA_URN_PREFIX}${cinema.id}`,
    name: cinema.name,
    address,
  };
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

/**
 * A `ScreeningEvent` with its own `@context` — the unit emitted by
 * `buildHomepageJsonLd`, one per `<script type="application/ld+json">`
 * tag. See the helper's doc comment for why we don't use `@graph`.
 */
export type ScreeningEventJsonLdRoot = ScreeningEventJsonLd & {
  '@context': typeof SCHEMA_ORG_CONTEXT;
};

/**
 * Build the homepage JSON-LD payloads — one self-contained `ScreeningEvent`
 * per upcoming screening in the 7-day high-intent window (today + next 6
 * days, per eng-review D3). The visible page shows 14 days; the JSON-LD
 * emits the 7-day cut where most search intent lives.
 *
 * Returns an **array** rather than a single `@graph` wrapper. The homepage
 * mounts one `<JsonLd>` per element, producing one `<script>` tag per
 * event — Google's documented pattern for multiple events on one page.
 * `@graph` parses as Schema.org but Google's Rich Results tester
 * classifies the typeless root as "unknown-type" and rejects the whole
 * payload, even when every nested `ScreeningEvent` is individually valid
 * (observed 2026-05-17).
 */
export function buildHomepageJsonLd(
  screenings: ScreeningRow[],
  options: { now?: Date } = {},
): ScreeningEventJsonLdRoot[] {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() + HOMEPAGE_JSON_LD_DAYS * ONE_DAY_MS);
  return screenings
    .filter((s) => s.startsAtUtc < cutoff)
    .map((s) => ({
      '@context': SCHEMA_ORG_CONTEXT,
      ...buildScreeningEvent(s),
    }));
}

// ---------------------------------------------------------------------------
// Site identity — the "who is this site" node (Organization).
//
// Distinct from the ScreeningEvent graph, which describes the *content*. This
// node gives AI crawlers / entity-resolvers a single, unambiguous identity for
// afiche itself: a name, canonical url, logo, description, the city it serves,
// and its public source-of-truth (the code-available repo). Without it the only
// typed entities on the page are the nested `Person` directors inside each
// Movie — which an identity checker misreads as "this site is a Person".
// Emitted once on the homepage (src/app/page.tsx), alongside the events.
// ---------------------------------------------------------------------------

/** Absolute URL of the app icon used as the Organization logo. Lives in /public. */
const LOGO_URL = `${SITE_URL}/icon-512.png`;

export interface SiteJsonLd {
  '@context': typeof SCHEMA_ORG_CONTEXT;
  '@type': 'Organization';
  '@id': string;
  name: string;
  url: string;
  logo: string;
  description: string;
  /** The geographic scope afiche curates — BA-only, a constant. */
  areaServed: { '@type': 'City'; name: string };
  /** Public external identities for the same entity (the code-available repo). */
  sameAs: string[];
}

/**
 * Build the homepage site-identity payload — a Schema.org `Organization`
 * describing afiche the product. Stable `@id` (`${SITE_URL}/#organization`) so
 * other nodes can reference it and parsers dedupe it to one entity. All fields
 * are constants sourced from src/lib/site.ts; there is no per-request data, so
 * the shape is deterministic and unit-testable without a DB.
 */
export function buildSiteJsonLd(): SiteJsonLd {
  return {
    '@context': SCHEMA_ORG_CONTEXT,
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: SITE_URL,
    logo: LOGO_URL,
    description: SITE_DESCRIPTION,
    areaServed: { '@type': 'City', name: 'Buenos Aires' },
    sameAs: [SITE_SOURCE_URL],
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
