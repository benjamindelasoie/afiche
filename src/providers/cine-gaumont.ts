/**
 * Cine Gaumont provider — Espacio INCAA Km 0, the state cinema for Argentine
 * national film, facing Plaza del Congreso.
 *
 * The site (cinegaumont.ar) runs on the Cinexo ticketing platform: a
 * client-rendered Next.js shell whose cartelera is fetched in the browser from
 * one clean JSON endpoint, so there is no HTML to scrape:
 *
 *   GET https://apifront.cinexo.com.ar/mobile/consultas/peliculas/
 *       PeliculasConFuncionesYHorarios?idComplejo=372001&fecha=DD/MM/YYYY
 *
 * One call per day. Shape: { success, data: { datos: [film], funciones:
 * [showtime] } }. `datos` is the whole cartelera (same list every day) with
 * title, director, runtime, synopsis and `fecha_estreno`; `funciones` holds
 * that day's showtimes ({ codPelicula, hora: "HH:MM" }), joined to `datos` by
 * `peliculas_codigo`. The site offers a 7-day window starting today; for today
 * the API only returns showtimes that haven't started yet.
 *
 * Titles (and most directors) arrive ALL-CAPS with sloppy spacing
 * ("ADOLESCENCIA,SEXO Y…", "XUL "). normalizeTitle sentence-cases them the
 * same way displayFilmTitle would at render, so the stored key reads like
 * the page; normalizeDirector name-cases each word. The API carries no
 * original title, country or year; TMDB enrichment fills those. Cycles aren't
 * exposed anymore, so no programName.
 *
 * TIMEZONE: Argentina is UTC-3, no DST. We read each date + "HH:MM" as
 * BA-local and shift +3h to true UTC before emitting `startsAtUtc`.
 */

import { type Provider, type ProviderRunResult, type ScrapedScreening } from './types';
import type { ScreeningTag } from '@/db';
import { caseIfAllCaps } from '@/lib/title-case';

const CINEMA_ID = 'cine-gaumont';
const SITE_BASE = 'https://www.cinegaumont.ar';
const API_BASE = 'https://apifront.cinexo.com.ar';
const COMPLEJO_ID = '372001'; // Cine Gaumont on the Cinexo platform
const WINDOW_DAYS = 7; // matches the date strip the site offers
const DAY_DELAY_MS = 250;
const FETCH_TIMEOUT_MS = 20_000;
const RELEASE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
// Realistic desktop Chrome UA. Datacenter IPs + scraper-shaped UAs invite 403s
// from a lot of AR cinema infra; send a normal browser UA to be safe.
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// --- API response shapes (only the fields we use) --------------------------

interface ApiFilm {
  peliculas_codigo?: string;
  peliculas_nombre?: string;
  peliculas_duracion?: string; // minutes, as a string
  peliculas_sinopsis?: string;
  director?: string;
  fecha_estreno?: string; // "DD/MM/YYYY", or "-" when unknown
}

interface ApiFuncion {
  codPelicula?: string;
  hora?: string; // "HH:MM", BA-local
  idUltracine?: string;
}

interface DayResponse {
  success?: boolean;
  data?: { datos?: ApiFilm[]; funciones?: ApiFuncion[] };
}

export interface DayParse {
  screenings: ScrapedScreening[];
  /** Films in the cartelera list — 0 means the API shape likely changed. */
  filmCount: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export const cineGaumontProvider: Provider = {
  id: CINEMA_ID,
  name: 'Cine Gaumont',

  async fetch(): Promise<ProviderRunResult> {
    const warnings: string[] = [];
    const screenings: ScrapedScreening[] = [];
    let filmCount = 0;
    let daysOk = 0;

    for (const date of baDateWindow(new Date(), WINDOW_DAYS)) {
      try {
        const day = await fetchJson<DayResponse>(dayUrl(date));
        const parsed = parseDay(day, date);
        screenings.push(...parsed.screenings);
        warnings.push(...parsed.warnings);
        filmCount = Math.max(filmCount, parsed.filmCount);
        daysOk++;
      } catch (err) {
        warnings.push(`${date}: ${msg(err)}`);
      }
      await sleep(DAY_DELAY_MS);
    }

    // The Gaumont screens every day, so a week of listed films with no
    // matched showtime is a reshaped `funciones` (or a changed complejo id),
    // not a quiet week.
    const fail = (error: string): ProviderRunResult => ({
      cinemaId: CINEMA_ID,
      screenings: [],
      success: false,
      warnings,
      error,
    });
    if (daysOk === 0) return fail('Every day request to the Cinexo API failed.');
    if (filmCount === 0) {
      return fail(
        'Cinexo API returned no films for any day — API shape may have changed.',
      );
    }
    if (screenings.length === 0) {
      return fail(
        `Cinexo API listed ${filmCount} films but no showtimes matched them in ${daysOk} day(s) — funciones shape or complejo id may have changed.`,
      );
    }
    return { cinemaId: CINEMA_ID, screenings, success: true, warnings };
  },
};

// ---------------------------------------------------------------------------
// Pure parsing (exported for fixture tests)
// ---------------------------------------------------------------------------

/**
 * Map one day's API response ("YYYY-MM-DD" BA-local `date`) to screenings.
 * Defensive against the shape shifting (everything optional) and filters to
 * the Gaumont complejo so a multi-venue response can't bleed in other times.
 */
export function parseDay(json: unknown, date: string): DayParse {
  const out: DayParse = { screenings: [], filmCount: 0, warnings: [] };
  const data = (json as DayResponse | null)?.data;
  const datos = Array.isArray(data?.datos) ? data.datos : [];
  const funciones = Array.isArray(data?.funciones) ? data.funciones : [];

  const films = new Map<string, ApiFilm>();
  for (const film of datos) {
    if (film?.peliculas_codigo) films.set(String(film.peliculas_codigo), film);
  }
  out.filmCount = films.size;

  for (const fn of funciones) {
    if (fn?.idUltracine && fn.idUltracine !== COMPLEJO_ID) continue;
    const code = String(fn?.codPelicula ?? '');
    const film = films.get(code);
    const filmTitle = normalizeTitle(film?.peliculas_nombre ?? '');
    if (!film || !filmTitle) {
      out.warnings.push(`${date}: showtime for unknown film ${code || '?'} — skipped`);
      continue;
    }
    const startsAtUtc = baLocalToUtc(date, fn.hora ?? '');
    if (!startsAtUtc) {
      out.warnings.push(`${date} "${filmTitle}": unparseable time "${fn.hora}"`);
      continue;
    }

    const director = normalizeDirector(film.director);
    const runtimeMin = parseRuntime(film.peliculas_duracion);
    const synopsisEs = cleanText(film.peliculas_sinopsis);
    out.screenings.push({
      cinemaId: CINEMA_ID,
      filmTitle,
      ...(director ? { director } : {}),
      ...(runtimeMin ? { runtimeMin } : {}),
      startsAtUtc,
      tags: screeningTags(film, date),
      ...(synopsisEs ? { synopsisEs } : {}),
      sourceUrl: `${SITE_BASE}/es-AR/programacion/corp/${COMPLEJO_ID}/${code}`,
    });
  }
  return out;
}

/**
 * 'premiere' during the film's release week (the 7 days from `fecha_estreno`),
 * standing in for the old site's "Estrenos" section. No language tags: the API's
 * `subtitulada` flag can't tell an Argentine original-Spanish film from a dubbed
 * foreign one, and in an all-indie cartelera a language tag would be
 * universal-noise (same stance as the Cacodelphia provider).
 */
function screeningTags(film: ApiFilm, date: string): ScreeningTag[] {
  const release = film.fecha_estreno?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!release) return [];
  const releaseMs = Date.UTC(+release[3], +release[2] - 1, +release[1]);
  const [y, m, d] = date.split('-').map(Number);
  const dayMs = Date.UTC(y, m - 1, d);
  return dayMs >= releaseMs && dayMs - releaseMs < RELEASE_WEEK_MS ? ['premiere'] : [];
}

/** `count` consecutive BA-local dates ("YYYY-MM-DD") starting today in BA. */
export function baDateWindow(now: Date, count: number): string[] {
  const baMidnight = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  baMidnight.setUTCHours(0, 0, 0, 0);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(baMidnight.getTime() + i * 24 * 60 * 60 * 1000);
    out.push(d.toISOString().slice(0, 10));
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

/** The API wants the date as "DD/MM/YYYY". */
function dayUrl(date: string): string {
  const [y, m, d] = date.split('-');
  return `${API_BASE}/mobile/consultas/peliculas/PeliculasConFuncionesYHorarios?idComplejo=${COMPLEJO_ID}&fecha=${d}/${m}/${y}`;
}

function parseRuntime(raw: string | undefined): number | undefined {
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Collapse whitespace, restore the space after a comma, sentence-case caps. */
export function normalizeTitle(raw: string): string {
  const s = raw
    .replace(/\s+/g, ' ')
    .replace(/,(?=\p{L})/gu, ', ')
    .trim();
  return caseIfAllCaps(s);
}

const NAME_PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'van', 'von']);

/** `HERNAN GOLDFRIND` → `Hernan Goldfrind`; mixed-case names pass through. */
export function normalizeDirector(raw: string | undefined): string | undefined {
  const s = cleanText(raw);
  if (!s || s !== s.toLocaleUpperCase('es')) return s;
  return s
    .toLocaleLowerCase('es')
    .split(' ')
    .map((word, i) =>
      i > 0 && NAME_PARTICLES.has(word)
        ? word
        : word.replace(
            /(^|[-'])(\p{L})/gu,
            (_m, sep: string, ch: string) => sep + ch.toLocaleUpperCase('es'),
          ),
    )
    .join(' ');
}

function cleanText(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.replace(/\s+/g, ' ').trim();
  return s.length > 1 ? s : undefined;
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      'Accept-Language': 'es-AR,es;q=0.9',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const json = (await res.json()) as T & { success?: boolean; message?: string };
  if (json?.success === false) {
    throw new Error(`API error for ${url}: ${json.message ?? 'success=false'}`);
  }
  return json;
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
