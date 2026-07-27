/**
 * CineArte Cacodelphia provider. Downtown arthouse on Diagonal Norte.
 *
 * Strategy: the site (cineartecacodelphia.com.ar) is a SPA on the adro.studio
 * ticketing platform, backed by a clean JSON API — no HTML scraping needed:
 *   1. GET /nowPlaying/86   → films currently on (pref hash + release flag).
 *   2. GET /movie/86/<pref> → film metadata (nombre, descripción, duración)
 *                              + showtimes[].
 *   3. Emit one ScrapedScreening per showtime.
 *
 * TIMEZONE (important): the API serializes `fechaHora` with a "UTC" label, but
 * the wall-clock is actually BA-local — verified against the live site, where a
 * showtime the API reports as "2026-06-06 21:00:00 UTC" renders to users as
 * 21:00 on Sat the 6th. So we read the wall-clock as BA-local and shift +3h to
 * true UTC. Argentina is UTC-3, no DST.
 *
 * The API gives no director/year/original-title; TMDB enrichment fills those.
 * Titles arrive ALL-CAPS (like Cine Lorca) — emitted verbatim; displayFilmTitle
 * title-cases at render.
 */

import { type Provider, type ProviderRunResult, type ScrapedScreening } from './types';
import type { ScreeningTag } from '@/db';

const API_BASE = 'https://apiv2.gaf.adro.studio';
const ADRO_CINEMA_ID = '86'; // CineArte Cacodelphia on the adro.studio platform
const CINEMA_ID = 'cacodelphia'; // our cinemas.id
const SITE_BASE = 'https://cineartecacodelphia.com.ar';
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DETAIL_DELAY_MS = 300;

// --- API response shapes (only the fields we use) --------------------------

interface NowPlayingItem {
  pref: string;
  nombre: string;
  release?: number; // 1 = "Estreno" (premiere)
}

interface ApiShowtime {
  lenguaje?: string; // "Subt" | "Cast"
  formato?: string; // "2D"
  mostrar?: string; // "0" = hidden
  expired?: boolean;
  fechaHora?: { date?: string }; // "YYYY-MM-DD HH:MM:SS.ffffff" (BA wall-clock)
}

interface ApiMovie {
  nombre?: string;
  descripcion?: string;
  Duracion?: string; // minutes, as a string
}

export interface MovieResponse {
  status?: string;
  data?: { movie?: ApiMovie; showtimes?: ApiShowtime[] };
}

interface NowPlayingResponse {
  status?: string;
  data?: NowPlayingItem[];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export const cacodelphiaProvider: Provider = {
  id: CINEMA_ID,
  name: 'CineArte Cacodelphia',

  async fetch(): Promise<ProviderRunResult> {
    const warnings: string[] = [];
    try {
      const nowPlaying = await fetchJson<NowPlayingResponse>(
        `${API_BASE}/nowPlaying/${ADRO_CINEMA_ID}`,
      );
      const films = nowPlaying.data ?? [];
      if (films.length === 0) {
        return {
          cinemaId: CINEMA_ID,
          screenings: [],
          success: false,
          warnings,
          error: 'nowPlaying returned no films — API shape may have changed.',
        };
      }

      const screenings: ScrapedScreening[] = [];
      for (const film of films) {
        try {
          const movie = await fetchJson<MovieResponse>(
            `${API_BASE}/movie/${ADRO_CINEMA_ID}/${film.pref}`,
          );
          screenings.push(...parseMovie(movie, film, warnings));
        } catch (err) {
          warnings.push(`film "${film.nombre}" (${film.pref}): ${msg(err)}`);
        }
        await sleep(DETAIL_DELAY_MS);
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
// Pure mapping (exported for fixture tests)
// ---------------------------------------------------------------------------

/**
 * Cacodelphia's API bakes a ciclo/retrospective into the movie `nombre` as a
 * "{Film} - CICLO {Name}" suffix (e.g. "EL JOCKEY - CICLO LUIS ORTEGA"). Left
 * in the title it poisons TMDB search — a clean "EL JOCKEY" matches instantly,
 * the suffixed form finds nothing and lands in the operator queue. Split it so
 * the film title stays clean (TMDB-matchable) and the ciclo becomes a Program
 * (`programName`), which is what it actually is. Conservative: only splits when
 * a program keyword follows a dash, and never empties the title.
 */
const CICLO_SUFFIX_RE =
  /\s*[-–—]\s*((?:CICLO|RETROSPECTIVA|FOCO|MUESTRA|HOMENAJE)\b.*)$/i;

export function splitCiclo(raw: string): {
  filmTitle: string;
  programName?: string;
} {
  const m = raw.match(CICLO_SUFFIX_RE);
  if (!m || m.index === undefined) return { filmTitle: raw };
  const filmTitle = raw.slice(0, m.index).trim();
  if (!filmTitle) return { filmTitle: raw }; // suffix was the whole title — keep it
  return { filmTitle, programName: m[1].trim() };
}

/** Map one /movie response (+ its nowPlaying entry) to screenings. */
export function parseMovie(
  resp: MovieResponse,
  listing: { pref: string; nombre?: string; release?: number },
  warnings: string[] = [],
): ScrapedScreening[] {
  const movie = resp.data?.movie;
  const showtimes = resp.data?.showtimes ?? [];
  const title = (movie?.nombre ?? listing.nombre ?? '').trim();
  if (!title) return [];
  const { filmTitle, programName } = splitCiclo(title);

  const runtimeMin = parseRuntime(movie?.Duracion);
  const synopsisEs = cleanSynopsis(movie?.descripcion);
  const sourceUrl = `${SITE_BASE}/pelicula/${ADRO_CINEMA_ID}/${listing.pref}`;
  const isPremiere = listing.release === 1;

  const out: ScrapedScreening[] = [];
  for (const st of showtimes) {
    if (st.mostrar === '0' || st.expired === true) continue;
    const startsAtUtc = baWallClockToUtc(st.fechaHora?.date);
    if (!startsAtUtc) {
      warnings.push(`${title}: unparseable showtime "${st.fechaHora?.date}"`);
      continue;
    }
    const tags: ScreeningTag[] = [];
    if (isPremiere) tags.push('premiere');
    // No language tag. The API's `lenguaje` is "Subt" | "Cast", but in an
    // all-indie cartelera every foreign film is subtitled, so 'vos' would be
    // universal-noise (no other provider emits it). 'dubbed' WOULD carry signal,
    // but "Cast" can't distinguish an Argentine original-Spanish film from a
    // dubbed foreign one, so we leave it untagged rather than mislabel.

    out.push({
      cinemaId: CINEMA_ID,
      filmTitle,
      startsAtUtc,
      tags,
      ...(programName !== undefined ? { programName } : {}),
      ...(runtimeMin !== undefined ? { runtimeMin } : {}),
      ...(synopsisEs !== undefined ? { synopsisEs } : {}),
      sourceUrl,
    });
  }
  return out;
}

/**
 * "2026-06-06 21:00:00.000000" — a BA wall-clock the API mislabels as UTC —
 * to a true UTC Date by shifting +3h. Returns null if unparseable.
 */
export function baWallClockToUtc(raw: string | undefined): Date | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  const [y, mo, d, h, min] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h + 3, min, 0, 0));
}

function parseRuntime(raw: string | undefined): number | undefined {
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function cleanSynopsis(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return s.length > 1 ? s : undefined; // guard against placeholder "."
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
