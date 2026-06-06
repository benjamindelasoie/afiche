/**
 * Centro Cultural Borges provider — the state cultural centre in Galerías
 * Pacífico (Viamonte 525), free entry, with a curated arthouse cinema program
 * (Argentine auteur cinema, retrospectives, animation cycles).
 *
 * The site is an Angular SPA backed by a clean JSON API at
 * `/api/public`. Two endpoints, no HTML scraping:
 *
 *   1. GET /api/public/eventos-del-mes  → every event of the current month,
 *      already flattened to ONE row per occurrence (a film that repeats on five
 *      dates appears as five rows sharing an `id`). We filter `areaNombre ===
 *      'Cine'`. Each row carries `titulo`, `artistaDestacado` (director),
 *      `descripcion`, `fechaRepeticionReal` ("YYYY-MM-DD") and `horario`
 *      ("HH:MM", BA-local) — pre-filtered to active/shown events.
 *
 *   2. GET /api/public/evento-detalle?id={id}  → per-film extras: `duracion`
 *      (runtime, sometimes null) and `descripcionLarga` (a real plot synopsis vs
 *      the short tagline). Fetched once per UNIQUE id (≈10), not per occurrence.
 *
 * The API exposes no production year or original title (like Cine Gaumont) — the
 * matcher tolerates a missing year and leans on title + director, which is plenty
 * for this catalogue of recent Argentine auteur films with named directors.
 *
 * The `/agenda?mes=&anio=` endpoint can page to other months but uses display
 * dates ("DOM 14 JUN"), drops the director, and includes inactive events — not
 * worth the mess for next-month coverage (the venue programs month-to-month).
 *
 * TIMEZONE: Argentina is UTC-3, no DST. We read `fechaRepeticionReal` + `horario`
 * as BA-local and shift +3h to true UTC.
 */

import { type Provider, type ProviderRunResult, type ScrapedScreening } from './types';
import type { ScreeningTag } from '@/db';

const CINEMA_ID = 'centro-cultural-borges';
const API_BASE = 'https://centroculturalborges.gob.ar/api/public';
const SITE_BASE = 'https://centroculturalborges.gob.ar';
const DETAIL_DELAY_MS = 200;
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// --- API response shapes (only the fields we use) --------------------------

interface EventoMes {
  id?: number;
  titulo?: string;
  descripcion?: string;
  artistaDestacado?: string;
  areaNombre?: string;
  horario?: string; // "HH:MM" BA-local
  fechaRepeticionReal?: string; // "YYYY-MM-DD"
}

export interface EventoDetalleResponse {
  duracion?: number | string | null; // the API serializes minutes as a string ("85")
  descripcionLarga?: string | null;
}

// --- Intermediate shapes (exported pieces are pure + fixture-tested) --------

export interface CineEvento {
  id: number;
  title: string;
  director?: string;
  synopsisShort?: string;
  date: string; // "YYYY-MM-DD"
  time: string; // "HH:MM"
}

export interface EventoDetalle {
  runtimeMin?: number;
  synopsisLong?: string;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export const centroCulturalBorgesProvider: Provider = {
  id: CINEMA_ID,
  name: 'Centro Cultural Borges',

  async fetch(): Promise<ProviderRunResult> {
    const warnings: string[] = [];
    try {
      const mes = await fetchJson<EventoMes[]>(`${API_BASE}/eventos-del-mes`);
      const eventos = parseEventos(mes);
      if (eventos.length === 0) {
        // Not necessarily an error — the cinema program can be empty between
        // cycles — but a totally empty month more often means the shape moved.
        return {
          cinemaId: CINEMA_ID,
          screenings: [],
          success: true,
          warnings: ['no Cine events in eventos-del-mes (empty program, or API shape changed)'],
        };
      }

      // Fetch per-film detail once per unique id (films repeat across dates).
      const detalleById = new Map<number, EventoDetalle>();
      for (const id of [...new Set(eventos.map((e) => e.id))]) {
        try {
          const d = await fetchJson<EventoDetalleResponse>(`${API_BASE}/evento-detalle?id=${id}`);
          detalleById.set(id, parseDetalle(d));
        } catch (err) {
          warnings.push(`evento-detalle ${id}: ${msg(err)}`);
        }
        await sleep(DETAIL_DELAY_MS);
      }

      const screenings: ScrapedScreening[] = [];
      for (const ev of eventos) {
        const s = toScreening(ev, detalleById.get(ev.id));
        if (s) screenings.push(s);
        else warnings.push(`unparseable date/time for "${ev.title}" (${ev.date} ${ev.time})`);
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

/** Filter the month feed to Cine occurrences and map to our shape. */
export function parseEventos(json: unknown): CineEvento[] {
  if (!Array.isArray(json)) return [];
  const out: CineEvento[] = [];
  for (const raw of json as EventoMes[]) {
    if (raw?.areaNombre !== 'Cine') continue;
    const id = raw.id;
    const title = (raw.titulo ?? '').trim();
    const date = (raw.fechaRepeticionReal ?? '').trim();
    const time = (raw.horario ?? '').trim();
    if (typeof id !== 'number' || !title || !date || !time) continue;
    const director = (raw.artistaDestacado ?? '').trim();
    out.push({
      id,
      title,
      ...(director ? { director } : {}),
      ...(raw.descripcion ? { synopsisShort: cleanSynopsis(raw.descripcion) } : {}),
      date,
      time,
    });
  }
  return out;
}

/** Pull runtime + the fuller synopsis from an evento-detalle response. */
export function parseDetalle(json: EventoDetalleResponse): EventoDetalle {
  const out: EventoDetalle = {};
  const durRaw = json?.duracion;
  const dur =
    typeof durRaw === 'string' ? parseInt(durRaw, 10) : typeof durRaw === 'number' ? durRaw : NaN;
  if (Number.isFinite(dur) && dur > 0) out.runtimeMin = dur;
  const long = cleanSynopsis(json?.descripcionLarga ?? undefined);
  if (long) out.synopsisLong = long;
  return out;
}

/** Combine a Cine occurrence with its (optional) detail into a screening. */
export function toScreening(ev: CineEvento, detalle?: EventoDetalle): ScrapedScreening | null {
  const startsAtUtc = baLocalToUtc(ev.date, ev.time);
  if (!startsAtUtc) return null;
  // Prefer the fuller plot synopsis from evento-detalle; fall back to the short
  // tagline from the month feed.
  const synopsisEs = detalle?.synopsisLong ?? ev.synopsisShort;
  const tags: ScreeningTag[] = [];
  return {
    cinemaId: CINEMA_ID,
    filmTitle: ev.title,
    ...(ev.director ? { director: ev.director } : {}),
    ...(detalle?.runtimeMin ? { runtimeMin: detalle.runtimeMin } : {}),
    startsAtUtc,
    tags,
    ...(synopsisEs ? { synopsisEs } : {}),
    sourceUrl: `${SITE_BASE}/evento/${ev.id}`,
  };
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
// Helpers
// ---------------------------------------------------------------------------

/** Trim, collapse whitespace, drop a trailing age tag like " (+13)". */
function cleanSynopsis(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw
    .replace(/\s+/g, ' ')
    .replace(/\s*\(\+\d+\)\s*$/, '')
    .trim();
  return s.length > 1 ? s : undefined;
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
