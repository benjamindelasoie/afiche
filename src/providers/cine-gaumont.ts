/**
 * Cine Gaumont provider — Espacio INCAA Km 0, the state cinema for Argentine
 * national film, facing Plaza del Congreso.
 *
 * The site (cinegaumont.ar) runs on the "Voy al Cine" platform. Three sources,
 * no JS rendering needed — everything we use is server-rendered HTML or a clean
 * JSON endpoint:
 *
 *   1. GET /                      → the cartelera: films grouped into sections
 *      (`.peliculas-section`). "Estrenos" → premieres, "Películas en cartel" →
 *      regular run, and one `.peliculas-ciclos` block per curatorial cycle
 *      (e.g. "Ciclo Bleak Week"), each headed by an `<h2 class="section-title">`.
 *      This gives us the film id list + cycle/program context + base tags.
 *
 *   2. GET https://www.cinegaumont.com.ar/films/{id}/tree  → JSON showtimes for
 *      a ~6-day window. NOTE the host is `.com.ar` (the `.ar` host 404s this).
 *      Shape: { days: { "YYYY-MM-DD": [ { name, formats: [ { performances:
 *      [ { showTime: "HH:MM" } ] } ] } ] } }. Times are BA-local.
 *
 *   3. GET /pelicula?filmid={id}  → the detail page: proper-case title, original
 *      title, director, origin/country, runtime, synopsis. (The `.aspx` form
 *      301-redirects here.) These feed TMDB matching — the more we emit, the
 *      smaller /admin/unmatched stays.
 *
 * Per film we fetch the tree first; a film with no showtime in the window is
 * skipped before we bother fetching its detail page. The scraped title is taken
 * from the detail page (proper-case, stable) so the immutable (scrapedTitle,
 * scrapedYear) upsert key doesn't drift. The detail page exposes no production
 * year — fine, the matcher accepts any candidate year when scrapedYear is
 * undefined and leans on the title + director hints instead.
 *
 * TIMEZONE: Argentina is UTC-3, no DST. We read each "YYYY-MM-DD" + "HH:MM" as
 * BA-local and shift +3h to true UTC before emitting `startsAtUtc`.
 */

import * as cheerio from 'cheerio';
import { type Provider, type ProviderRunResult, type ScrapedScreening } from './types';
import type { ScreeningTag } from '@/db';

const CINEMA_ID = 'cine-gaumont';
const SITE_BASE = 'https://www.cinegaumont.ar';
const API_BASE = 'https://www.cinegaumont.com.ar'; // showtime tree lives on .com.ar
const LISTING_URL = `${SITE_BASE}/`;
const DETAIL_DELAY_MS = 250;
// Realistic desktop Chrome UA. Datacenter IPs + scraper-shaped UAs invite 403s
// from a lot of AR cinema infra; send a normal browser UA to be safe.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// --- Intermediate shapes (exported pieces are pure + fixture-tested) --------

export interface FilmListing {
  filmId: number;
  /** Raw card title — ALL CAPS on this site. Detail page carries proper case. */
  listingTitle: string;
  /** Cycle name, only for films inside a `.peliculas-ciclos` section. */
  programName?: string;
  /** Base tags derived from the section the film sits in. */
  tags: ScreeningTag[];
}

export interface FilmMeta {
  title: string;
  titleOriginal?: string;
  director?: string;
  country?: string;
  runtimeMin?: number;
  synopsisEs?: string;
}

export interface TreeShowtime {
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:MM"
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export const cineGaumontProvider: Provider = {
  id: CINEMA_ID,
  name: 'Cine Gaumont',

  async fetch(): Promise<ProviderRunResult> {
    const warnings: string[] = [];
    try {
      const listingHtml = await fetchText(LISTING_URL);
      const films = parseListing(listingHtml);
      if (films.length === 0) {
        return {
          cinemaId: CINEMA_ID,
          screenings: [],
          success: false,
          warnings,
          error: 'No films parsed from cartelera — listing selectors likely broke.',
        };
      }

      const screenings: ScrapedScreening[] = [];
      for (const film of films) {
        try {
          // Tree first: skip the detail fetch for films not scheduled in the
          // ~6-day window (common for cycle entries announced ahead of time).
          const tree = await fetchJson<unknown>(`${API_BASE}/films/${film.filmId}/tree`);
          const showtimes = parseTree(tree);
          if (showtimes.length === 0) continue;

          const detailHtml = await fetchText(
            `${SITE_BASE}/pelicula?filmid=${film.filmId}`,
          );
          const meta = parseDetail(detailHtml);
          if (!meta.title) {
            warnings.push(
              `film ${film.filmId} "${film.listingTitle}": detail page had no title — skipped`,
            );
            continue;
          }
          screenings.push(...toScreenings(film, meta, showtimes));
          await sleep(DETAIL_DELAY_MS);
        } catch (err) {
          warnings.push(`film ${film.filmId} "${film.listingTitle}": ${msg(err)}`);
        }
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
// Pure parsing (exported for fixture tests)
// ---------------------------------------------------------------------------

/**
 * Parse the cartelera homepage into the film list. Walks each
 * `.peliculas-section` block (skipping the hero swiper, which duplicates
 * films), reads its `.section-title`, and collects one entry per card.
 * Cycle sections (`.peliculas-ciclos`) carry their title as `programName`.
 */
export function parseListing(html: string): FilmListing[] {
  const $ = cheerio.load(html);
  const byId = new Map<number, FilmListing>();

  $('.peliculas-section').each((_i, section) => {
    const $section = $(section);
    const sectionTitle = $section.find('.section-title').first().text().trim();
    const isCiclo = $section.hasClass('peliculas-ciclos');
    const isEstreno = $section.hasClass('peliculas-estrenos');

    $section.find('.category-thumb').each((_j, thumb) => {
      const $thumb = $(thumb);
      const href = $thumb.find('a[href*="filmid="]').first().attr('href') ?? '';
      const idMatch = href.match(/filmid=(\d+)/);
      if (!idMatch) return;
      const filmId = parseInt(idMatch[1], 10);
      const listingTitle = $thumb.find('.name').first().text().trim();
      if (!listingTitle) return;

      const entry: FilmListing = {
        filmId,
        listingTitle,
        tags: sectionTags(isCiclo, isEstreno, sectionTitle),
        ...(isCiclo && sectionTitle ? { programName: sectionTitle } : {}),
      };

      // A film could appear in more than one section; keep the one that
      // carries a cycle context so the cartelera pill survives.
      const existing = byId.get(filmId);
      if (!existing || (!existing.programName && entry.programName)) {
        byId.set(filmId, entry);
      }
    });
  });

  return [...byId.values()];
}

/** Tags implied by the section a film sits in. No language tags — see note. */
function sectionTags(
  isCiclo: boolean,
  isEstreno: boolean,
  title: string,
): ScreeningTag[] {
  const tags: ScreeningTag[] = [];
  if (isEstreno) tags.push('premiere');
  if (isCiclo) {
    tags.push('cycle');
    const t = title.toLowerCase();
    if (/funciones?\s+[úu]nicas?|[úu]nica\s+funci/.test(t)) tags.push('unique');
    if (/retrospectiv/.test(t)) tags.push('retrospective');
    if (/restaurad|restor/.test(t)) tags.push('restored');
  }
  // Deliberately no 'vos'/'dubbed': the tree's format ("2D-Castellano" /
  // "2D-Subtitulado") can't tell an Argentine original-Spanish film from a
  // dubbed foreign one, and in an all-indie cartelera a language tag would be
  // universal-noise (same stance as the Cacodelphia provider).
  return Array.from(new Set(tags));
}

/** Parse a film detail page (`/pelicula?filmid=N`) into its metadata. */
export function parseDetail(html: string): FilmMeta {
  const $ = cheerio.load(html);
  const $box = $('.movie-info-box').first();

  const title = $box.find('h2.name').first().text().replace(/\s+/g, ' ').trim();

  // First `.year` div is the runtime ("102 minutos."); a later `.year` holds
  // the audience rating — don't confuse them.
  const runtimeMin = parseRuntime($box.find('.year').first().text());
  const synopsisEs = cleanText($box.find('p.description').first().text());

  const meta: FilmMeta = { title };
  if (runtimeMin !== undefined) meta.runtimeMin = runtimeMin;
  if (synopsisEs) meta.synopsisEs = synopsisEs;

  $('.movie-side-info-box li').each((_i, li) => {
    const text = $(li).text().replace(/\s+/g, ' ').trim();
    const m = text.match(/^([^:]+):\s*(.*)$/);
    if (!m) return;
    const label = stripDiacritics(m[1].trim().toLowerCase());
    const value = m[2].trim();
    if (!value) return;
    if (label === 'titulo original') meta.titleOriginal = value;
    else if (label === 'origen') meta.country = value;
    else if (label === 'direccion') meta.director = value;
  });

  return meta;
}

/**
 * Flatten the `/films/{id}/tree` JSON into a flat showtime list. Defensive
 * against the API shape shifting (everything optional) and filters to the
 * Gaumont cinema node so a future multi-venue tree can't bleed in other times.
 */
export function parseTree(json: unknown): TreeShowtime[] {
  const out: TreeShowtime[] = [];
  const days = (json as { days?: Record<string, unknown> } | null)?.days;
  if (!days || typeof days !== 'object') return out;

  for (const [date, cinemas] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!Array.isArray(cinemas)) continue;
    for (const cinema of cinemas) {
      const name = (cinema as { name?: string })?.name;
      if (name && !/gaumont/i.test(name)) continue;
      const formats = (cinema as { formats?: unknown })?.formats;
      if (!Array.isArray(formats)) continue;
      for (const fmt of formats) {
        const perfs = (fmt as { performances?: unknown })?.performances;
        if (!Array.isArray(perfs)) continue;
        for (const perf of perfs) {
          const time = (perf as { showTime?: string })?.showTime;
          if (typeof time === 'string' && /^\d{1,2}:\d{2}$/.test(time)) {
            out.push({ date, time });
          }
        }
      }
    }
  }
  return out;
}

/** Combine a listing entry, its detail metadata, and its showtimes. */
export function toScreenings(
  listing: FilmListing,
  meta: FilmMeta,
  showtimes: TreeShowtime[],
): ScrapedScreening[] {
  const filmTitle = (meta.title || listing.listingTitle).trim();
  const sourceUrl = `${SITE_BASE}/pelicula?filmid=${listing.filmId}`;

  const out: ScrapedScreening[] = [];
  for (const st of showtimes) {
    const startsAtUtc = baLocalToUtc(st.date, st.time);
    if (!startsAtUtc) continue;
    out.push({
      cinemaId: CINEMA_ID,
      filmTitle,
      // Only when it actually differs — for Spanish-language films the
      // "original" equals the display title and carries no extra signal.
      ...(meta.titleOriginal && meta.titleOriginal !== filmTitle
        ? { filmTitleOriginal: meta.titleOriginal }
        : {}),
      ...(meta.director ? { director: meta.director } : {}),
      ...(meta.country ? { country: meta.country } : {}),
      ...(meta.runtimeMin ? { runtimeMin: meta.runtimeMin } : {}),
      startsAtUtc,
      tags: listing.tags,
      ...(meta.synopsisEs ? { synopsisEs: meta.synopsisEs } : {}),
      sourceUrl,
      ...(listing.programName ? { programName: listing.programName } : {}),
    });
  }
  return out;
}

/** "YYYY-MM-DD" + "HH:MM" BA-local → true UTC Date (+3h). Null if unparseable. */
export function baLocalToUtc(date: string, time: string): Date | null {
  const dm = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!dm || !tm) return null;
  const [y, mo, d] = [dm[1], dm[2], dm[3]].map(Number);
  const [h, min] = [tm[1], tm[2]].map(Number);
  if (h > 23 || min > 59) return null;
  return new Date(Date.UTC(y, mo - 1, d, h + 3, min, 0, 0));
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function parseRuntime(raw: string | undefined): number | undefined {
  const m = raw?.match(/(\d+)\s*min/i);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function cleanText(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.replace(/\s+/g, ' ').trim();
  return s.length > 1 ? s : undefined;
}

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'es-AR,es;q=0.9' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
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
