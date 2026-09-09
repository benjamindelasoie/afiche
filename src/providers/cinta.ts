/**
 * CINTA provider. An open-air cinema on a Palermo terrace (Gurruchaga 1791),
 * which programmes classics and modern favourites in two nightly turnos.
 *
 * Strategy: they have no site of their own — their Instagram bio links
 * straight at a Passline producer page, so that listing IS the venue's live
 * programming surface and the only thing to scrape:
 *
 *   https://www.passline.com/sitio/cinta-proyecciones
 *
 * The listing carries everything we need per event (title, BA-local date and
 * time, the room it plays in, and the ticket URL). Detail pages add nothing
 * we use AND sit behind a harder Cloudflare rule than the listing, so this
 * provider deliberately never walks them.
 *
 * ---------------------------------------------------------------------------
 * CLOUDFLARE: why this provider fetches through a reader proxy
 * ---------------------------------------------------------------------------
 * Passline puts an interactive Cloudflare challenge (Turnstile) plus a
 * Queue-it waiting room in front of every HTML page. That challenge is
 * fingerprint-based, not header-based: a plain `fetch()` gets 403 no matter
 * what User-Agent, Accept-Language or Sec-Fetch-* headers it sends, and even
 * replaying a `cf_clearance` cookie harvested from a real Chrome session
 * still 403s, because the cookie is bound to Chrome's TLS fingerprint. Only
 * a real browser engine gets a 200.
 *
 * Rather than pull a headless browser into a repo whose every other provider
 * is `fetch()` + cheerio, we route through a public reader proxy that renders
 * the page and hands back the post-challenge DOM. `x-respond-with: html`
 * returns the *same* markup a browser sees, so the parse below uses the same
 * stable Passline selectors it would have used against the origin.
 *
 * The direct fetch is still attempted FIRST on every run, so the day Passline
 * relaxes the rule (or we scrape from an allow-listed IP) we quietly stop
 * depending on the proxy — and a warning records which path was taken, so the
 * run log says so rather than us having to guess.
 *
 * Scraping the listing is permitted by passline.com/robots.txt, which
 * disallows only /carro*, /ticket* and the courtesy-ticket paths.
 *
 * The listing gives no year, director, runtime or synopsis; TMDB enrichment
 * fills those. It is also, deliberately, the reason `scrapedYear` is null for
 * every CINTA film — see the immutable-upsert-key note in db/schema.ts.
 */

import * as cheerio from 'cheerio';
import { type Provider, type ProviderRunResult, type ScrapedScreening } from './types';

const CINEMA_ID = 'cinta'; // our cinemas.id
const LISTING_URL = 'https://www.passline.com/sitio/cinta-proyecciones';

/**
 * Reader proxy used only when the direct fetch is challenged. It renders the
 * URL in a real browser and returns the resulting DOM. Prefix form, so the
 * target URL keeps its scheme: `https://r.jina.ai/https://example.com/x`.
 */
const READER_PREFIX = 'https://r.jina.ai/';

/** Sent to the origin: Passline serves HTML pages to browsers only. */
const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/**
 * Sent to the reader proxy, which is the exact OPPOSITE of the origin: it
 * serves its own web UI to browsers and 403s an API call that arrives wearing
 * a browser User-Agent. Passing BROWSER_USER_AGENT through to it is therefore
 * a silent way to break the fallback — hence two constants, and headers that
 * are chosen per host rather than merged.
 */
const PROXY_USER_AGENT = 'afiche-scraper (+https://github.com/benjamindelasoie/afiche)';

/** The venue CINTA plays in when it is at home, as Passline files it. */
const HOME_ROOM = 'Crepas Palermo';

/**
 * Passline renders one `.masonry-item` per event, and each carries a title,
 * a `.fecha-site` line and a `.lugar-site` line. If a fetch comes back
 * without a single one of these, we got a challenge page (or the template
 * changed) rather than an empty month — either way it is not a listing.
 */
const LISTING_MARKER = '.masonry-item .fecha-site';

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export const cintaProvider: Provider = {
  id: CINEMA_ID,
  name: 'Cinta',

  async fetch(): Promise<ProviderRunResult> {
    const warnings: string[] = [];
    try {
      const html = await fetchListing(warnings);
      const screenings = parseListing(html, new Date(), warnings);

      if (screenings.length === 0) {
        // CINTA publishes a month at a time and goes quiet between cycles, so
        // an empty upcoming list is plausible. Say so explicitly, otherwise a
        // real parse regression is indistinguishable from a quiet fortnight.
        warnings.push(
          'listing parsed but produced no upcoming screenings — expected ' +
            'between monthly cycles, suspicious otherwise.',
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
// Network
// ---------------------------------------------------------------------------

/**
 * Get the listing DOM: origin first, reader proxy as the fallback.
 *
 * Both attempts are validated with `looksLikeListing`, not just an HTTP 200 —
 * Cloudflare serves its interstitial with a 403 today but has served 200s in
 * the past, and the proxy will happily relay whatever it was given.
 */
export async function fetchListing(warnings: string[]): Promise<string> {
  let directProblem: string;
  try {
    const html = await fetchText(LISTING_URL, {
      'User-Agent': BROWSER_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-AR,es;q=0.9',
    });
    if (looksLikeListing(html)) return html;
    directProblem = 'response carried no event markup (challenge page?)';
  } catch (err) {
    directProblem = msg(err);
  }

  const html = await fetchText(`${READER_PREFIX}${LISTING_URL}`, {
    'User-Agent': PROXY_USER_AGENT,
    // Ask for rendered HTML rather than the proxy's default markdown, so the
    // parse below keeps working against Passline's own selectors.
    'x-respond-with': 'html',
  });
  if (!looksLikeListing(html)) {
    throw new Error(
      `neither the origin nor the reader proxy returned the listing ` +
        `(direct: ${directProblem}; proxy: no event markup)`,
    );
  }

  warnings.push(`origin fetch fell back to the reader proxy (${directProblem})`);
  return html;
}

/** True when the document actually contains Passline's event cards. */
export function looksLikeListing(html: string): boolean {
  return cheerio.load(html)(LISTING_MARKER).length > 0;
}

/** Headers are passed whole, never merged — see PROXY_USER_AGENT. */
async function fetchText(url: string, headers: Record<string, string>) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// ---------------------------------------------------------------------------
// Parsing (pure — exported for fixture tests)
// ---------------------------------------------------------------------------

/**
 * Map the Passline producer listing to screenings. `now` is passed in (not
 * read from the clock) so tests can pin it.
 *
 * Sold-out functions are KEPT. Afiche is a cartelera: it reports what is being
 * shown, and the "AGOTADAS" state belongs to the ticket page each screening
 * already links to. Dropping them would make the site claim nothing screens on
 * a night CINTA is in fact full.
 */
export function parseListing(
  html: string,
  now: Date,
  warnings: string[] = [],
): ScrapedScreening[] {
  const $ = cheerio.load(html);
  const out: ScrapedScreening[] = [];
  const offsiteRooms = new Set<string>();

  $('.masonry-item').each((_, el) => {
    const card = $(el);

    // The `title` attribute holds the untruncated string; the element text is
    // the same value but subject to Passline's line-clamping.
    const rawTitle = (
      card.find('.descripcion-evento .h4').attr('title') ??
      card.find('.descripcion-evento .h4').text()
    ).trim();
    if (!rawTitle) return; // masonry container / spacer, not an event

    const rawDate = card.find('.fecha-site').text();
    const startsAtUtc = parseSpanishDateTime(rawDate);
    if (!startsAtUtc) {
      warnings.push(`${rawTitle}: unparseable date "${collapse(rawDate)}" — skipped`);
      return;
    }
    // Passline keeps sold-out past events on the producer page. Drop them:
    // ingest only ever deletes FUTURE rows, so a past-dated insert would
    // become an orphan no later scrape can clean up.
    if (startsAtUtc <= now) return;

    const filmTitle = parseEventTitle(rawTitle);
    if (!filmTitle) {
      warnings.push(`${rawTitle}: title parsed to empty — skipped`);
      return;
    }

    const room = collapse(card.find('.lugar-site').text());
    if (room && room !== HOME_ROOM) offsiteRooms.add(room);

    const href = card.find('a[href*="/sitio-evento/"]').first().attr('href');

    out.push({
      cinemaId: CINEMA_ID,
      filmTitle,
      startsAtUtc,
      tags: [],
      sourceUrl: href ? absolute(href) : LISTING_URL,
    });
  });

  // CINTA is a projector and a terrace, not a building: they have taken the
  // cycle on the road (their own Instagram highlights a run in Uruguay). The
  // `cinemas.address` we render — and the Maps link built from it — is the
  // Palermo terrace, so a function billed anywhere else must be surfaced
  // rather than silently mapped to Gurruchaga 1791. See gotcha #1 in the
  // add-venue skill: a wrong address is the failure this warning exists for.
  for (const room of offsiteRooms) {
    warnings.push(
      `screenings billed at "${room}", not "${HOME_ROOM}" — verify the ` +
        `cinemas.address for '${CINEMA_ID}' still applies to these functions.`,
    );
  }

  return out;
}

// ---------------------------------------------------------------------------
// Title parsing
// ---------------------------------------------------------------------------

/**
 * CINTA names every event `<film> DD/MM - <N> Turno`, because the same film
 * plays twice a night and Passline needs distinct event names:
 *
 *   "Midnight in Paris 09/09 - Primer Turno"
 *   "(500) Days of Summer 14/09 - Segundo Turno"
 *
 * Anchoring the strip on the DD/MM stamp — not on the dash — is what keeps
 * hyphenated titles ("Punch-Drunk-Love") intact. The turno suffix alone is
 * the fallback for the day they drop the date from the event name.
 *
 * FROZEN-ISH: `filmTitle` becomes the immutable `films.scraped_title` upsert
 * key, so a change here forks a new film row for every title whose parse
 * shifts. If you must change it, update the existing rows in the same pass.
 */
const DATE_TURNO_SUFFIX_RE = /\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s*[-–—]?.*$/;
const TURNO_SUFFIX_RE = /\s*[-–—]\s*\S+\s+turnos?\s*$/i;

export function parseEventTitle(raw: string): string {
  const s = collapse(raw);
  const stripped = DATE_TURNO_SUFFIX_RE.test(s)
    ? s.replace(DATE_TURNO_SUFFIX_RE, '')
    : s.replace(TURNO_SUFFIX_RE, '');
  return stripped.replace(/\s*[-–—:,;.]+\s*$/, '').trim();
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS_ES: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9, // the other accepted Argentine spelling
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const FECHA_RE =
  /(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+(\d{4})\s+a\s+las\s+(\d{1,2})[:.](\d{2})/i;

/**
 * "09 de Septiembre 2026 a las 19:10" (BA wall-clock) -> true UTC Date.
 *
 * Argentina is UTC-3 year-round with no DST, so the shift is a constant +3h.
 */
export function parseSpanishDateTime(raw: string): Date | null {
  const m = collapse(raw).match(FECHA_RE);
  if (!m) return null;

  const month = MONTHS_ES[stripAccents(m[2]).toLowerCase()];
  if (!month) return null;

  const [day, year, hour, minute] = [m[1], m[3], m[4], m[5]].map(Number);
  if (hour > 23 || minute > 59) return null;

  const d = new Date(Date.UTC(year, month - 1, day, hour + 3, minute, 0, 0));
  // Round-trip the day-of-month to reject impossible dates (31 de febrero),
  // which Date.UTC would otherwise roll forward into the next month.
  const rolled = new Date(Date.UTC(year, month - 1, day));
  return rolled.getUTCDate() === day ? d : null;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function absolute(href: string): string {
  return new URL(href, LISTING_URL).toString();
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
