/**
 * Homepage time-window registry.
 *
 * The redesigned homepage (`/`) is a window-scoped, group-by-film cartelera.
 * The window is selected via `?ventana=hoy|finde|semana|prox` (server-rendered,
 * shareable) and defaults to `hoy`. This file is the single declarative source
 * for those windows: the nav pills, the `?ventana=` validation, the bounded DB
 * query, and the tests all derive from `WINDOWS` + `DEFAULT_WINDOW`. Removing a
 * window, re-labelling one, or changing the default front door is a one-line
 * edit here — nothing else needs to know.
 *
 * Window bounds (BA tz, all upper bounds exclusive):
 *   hoy    = [todayStart, +1d)         — today only (the default front door)
 *   finde  = [comingFri, nextMon)      — this/coming weekend (see getWeekendBoundsBA)
 *   semana = [todayStart, +7d)         — the next 7 days
 *   prox   = [todayStart+7d, +90d)     — the awareness horizon (finite cap)
 *
 * Render mode (collapse / day-chip / disclosure grouping) is derived from the
 * window via `windowRenderMode` — `hoy` is the single-day view (expanded
 * multi-showtime films, no day chips, disclosure grouped by venue); every other
 * window spans multiple days (collapsed by default, day chips on single-showtime
 * rows, disclosure grouped by day).
 */

import { getTodayStartBA, getWeekendBoundsBA } from './date-ranges';

const DAY_MS = 86_400_000;

export type WindowKey = 'hoy' | 'finde' | 'semana' | 'prox';

export interface WindowBounds {
  lower: Date;
  /** Exclusive upper bound. */
  upper: Date;
}

export interface WindowDef {
  key: WindowKey;
  /** Nav pill label (the `prox` arrow is appended by the nav component). */
  label: string;
  bounds: (now: Date) => WindowBounds;
}

/**
 * Declarative window registry. Order is the nav-pill render order.
 * `DEFAULT_WINDOW` is the front door when `?ventana=` is absent or invalid.
 */
export const WINDOWS: WindowDef[] = [
  {
    key: 'hoy',
    label: 'Hoy',
    bounds: (now) => {
      const lower = getTodayStartBA(now);
      return { lower, upper: new Date(lower.getTime() + DAY_MS) };
    },
  },
  {
    key: 'finde',
    label: 'Este finde',
    bounds: (now) => getWeekendBoundsBA(now),
  },
  {
    key: 'semana',
    label: 'Esta semana',
    bounds: (now) => {
      const lower = getTodayStartBA(now);
      return { lower, upper: new Date(lower.getTime() + 7 * DAY_MS) };
    },
  },
  {
    key: 'prox',
    label: 'Próximamente',
    bounds: (now) => {
      const todayStart = getTodayStartBA(now);
      return {
        lower: new Date(todayStart.getTime() + 7 * DAY_MS),
        upper: new Date(todayStart.getTime() + 90 * DAY_MS),
      };
    },
  },
];

/** Default front door when `?ventana=` is missing or unrecognized. */
export const DEFAULT_WINDOW: WindowKey = 'hoy';

const WINDOW_BY_KEY = new Map<WindowKey, WindowDef>(WINDOWS.map((w) => [w.key, w]));

/** Look up a window definition by key. */
export function getWindowDef(key: WindowKey): WindowDef {
  return WINDOW_BY_KEY.get(key)!;
}

/**
 * Resolve a raw `?ventana=` search-param value to a valid WindowKey.
 * Unknown / garbage / missing values fall back to DEFAULT_WINDOW. Accepts
 * the `string | string[] | undefined` shape Next.js hands to `searchParams`.
 */
export function resolveWindowKey(param: string | string[] | undefined): WindowKey {
  const raw = Array.isArray(param) ? param[0] : param;
  if (raw && WINDOW_BY_KEY.has(raw as WindowKey)) return raw as WindowKey;
  return DEFAULT_WINDOW;
}

export interface WindowRenderMode {
  /** Multi-day window — single-showtime rows get a day chip, disclosure groups by day. */
  multiDay: boolean;
  /** Multi-showtime films expand by default (only `hoy`, where same-day times are few). */
  disclosureDefaultOpen: boolean;
}

/**
 * Per-window UI render mode. `hoy` is the single-day view: no day chips,
 * multi-showtime films expanded by default, disclosure grouped by venue.
 * Every other window spans multiple days: day chips on single-showtime rows,
 * collapsed by default, disclosure grouped by day.
 */
export function windowRenderMode(key: WindowKey): WindowRenderMode {
  const isHoy = key === 'hoy';
  return { multiDay: !isHoy, disclosureDefaultOpen: isHoy };
}
