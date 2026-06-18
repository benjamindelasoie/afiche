/**
 * afiche MCP tools — read-only, deterministic wrappers over src/db/queries.ts.
 * Layout A: each tool's input + output zod schema is co-located with its
 * `registerTool` call. Every handler is wrapped in `safe()` so a DB/unexpected
 * failure returns `{ isError: true }` with a readable message instead of an
 * opaque JSON-RPC -32603. Every showtime emitted is filtered through
 * `catchable()` — the server never advertises a screening you can no longer
 * attend (the `getUpcomingScreeningsByFilm` lower bound is BA midnight, not now).
 *
 * Transport-agnostic: `registerAficheTools(server)` takes any MCP server, so a
 * future stdio entrypoint reuses it unchanged.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  getWindowScreeningsByFilm,
  getUpcomingScreeningsByFilm,
  getFilmBySlug,
  listCinemas,
  searchUpcomingFilms,
} from '@/db/queries';
import { getWindowDef, type WindowKey } from '@/lib/windows';
import { normalizeForSearch } from '@/lib/text';
import { SITE_URL } from '@/lib/site';
import { toVenue, toVenues, toFilmDTO, catchable, toBAISO } from './format';

type ToolText = { type: 'text'; text: string };
type ToolResult = {
  content: ToolText[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const text = (t: string): ToolText => ({ type: 'text', text: t });

/** Wrap a handler so a thrown DB/unexpected error becomes a readable isError result. */
async function safe(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [text(`afiche: no pude completar la consulta ahora mismo (${msg}).`)],
    };
  }
}

// --- reusable output sub-schemas ------------------------------------------
const showtimeSchema = z.object({
  startsAt: z.string(),
  label: z.string(),
  tags: z.array(z.string()),
  programName: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  icsUrl: z.string(),
});
const venueSchema = z.object({
  cinema: z.object({
    id: z.string(),
    name: z.string(),
    neighborhood: z.string().nullable(),
  }),
  showtimes: z.array(showtimeSchema),
});
const filmDetailSchema = z.object({
  slug: z.string().nullable(),
  title: z.string(),
  titleOriginal: z.string().nullable(),
  director: z.string().nullable(),
  year: z.number().nullable(),
  country: z.string().nullable(),
  runtimeMin: z.number().nullable(),
  synopsis: z.string().nullable(),
  genres: z.array(z.string()),
  cast: z.array(z.object({ name: z.string(), character: z.string() })),
  voteAverage: z.number().nullable(),
  posterUrl: z.string().nullable(),
  url: z.string().nullable(),
});

const WINDOW_KEYS = ['hoy', 'finde', 'semana', 'prox'] as const;

export function registerAficheTools(server: McpServer): void {
  // -------------------------------------------------------------------------
  // search_films
  // -------------------------------------------------------------------------
  server.registerTool(
    'search_films',
    {
      title: 'Buscar películas en cartelera',
      description:
        'Search films currently in the Buenos Aires indie cinema cartelera by title or director. ' +
        'Accent- and case-insensitive ("almodovar" matches "Almodóvar"). Returns only films with at ' +
        'least one still-catchable upcoming screening, each with a `slug` usable with get_film. ' +
        'Use this to find a film, then call get_film for full detail.',
      inputSchema: {
        query: z
          .string()
          .min(2)
          .describe('Title or director, e.g. "almodovar" or "blue velvet".'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe('Max results (default 20).'),
      },
      outputSchema: {
        query: z.string(),
        count: z.number(),
        films: z.array(
          z.object({
            slug: z.string(),
            title: z.string(),
            titleOriginal: z.string().nullable(),
            director: z.string().nullable(),
            year: z.number().nullable(),
            country: z.string().nullable(),
            nextShowtime: z.string(),
            venueCount: z.number(),
            screeningCount: z.number(),
            url: z.string(),
          }),
        ),
      },
    },
    async ({ query, limit }) =>
      safe(async () => {
        const hits = await searchUpcomingFilms(query, new Date(), limit ?? 20);
        const films = hits.map((h) => ({
          slug: h.slug,
          title: h.title,
          titleOriginal: h.titleOriginal,
          director: h.director,
          year: h.year,
          country: h.country,
          nextShowtime: toBAISO(h.nextShowtimeUtc),
          venueCount: h.venueCount,
          screeningCount: h.screeningCount,
          url: `${SITE_URL}/pelicula/${h.slug}`,
        }));
        const structured = { query, count: films.length, films };
        const body = films.length
          ? films
              .map(
                (f) =>
                  `- ${f.title}${f.year ? ` (${f.year})` : ''}${f.director ? ` · ${f.director}` : ''} — ${f.screeningCount} func. en ${f.venueCount} sala(s)`,
              )
              .join('\n')
          : 'sin resultados con funciones próximas.';
        return {
          structuredContent: structured,
          content: [text(`${films.length} resultado(s) para "${query}":\n${body}`)],
        };
      }),
  );

  // -------------------------------------------------------------------------
  // whats_on
  // -------------------------------------------------------------------------
  server.registerTool(
    'whats_on',
    {
      title: 'Qué se proyecta',
      description:
        'List films screening in Buenos Aires indie cinemas for a time window, grouped by film and venue. ' +
        'Windows: hoy (today), finde (this weekend), semana (next 7 days), prox (upcoming, 7–90 days). ' +
        'Optionally filter by cinema_id (a venue slug from list_cinemas) or neighborhood (e.g. "Palermo", ' +
        'accent-insensitive). Times are Buenos Aires local. Only still-catchable showtimes are returned.',
      inputSchema: {
        window: z
          .enum(WINDOW_KEYS)
          .default('hoy')
          .describe('Time window. Defaults to hoy (today).'),
        cinema_id: z
          .string()
          .optional()
          .describe('Filter to one venue slug, e.g. "lugones".'),
        neighborhood: z
          .string()
          .optional()
          .describe('Filter to a barrio, e.g. "Palermo".'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Max films (default 40).'),
      },
      outputSchema: {
        window: z.string(),
        windowLabel: z.string(),
        filters: z.object({
          cinema_id: z.string().nullable(),
          neighborhood: z.string().nullable(),
        }),
        filmCount: z.number(),
        truncated: z.boolean(),
        films: z.array(
          z.object({
            slug: z.string(),
            title: z.string(),
            director: z.string().nullable(),
            year: z.number().nullable(),
            country: z.string().nullable(),
            url: z.string(),
            venues: z.array(venueSchema),
          }),
        ),
      },
    },
    async ({ window, cinema_id, neighborhood, limit }) =>
      safe(async () => {
        const now = new Date();
        const win = window as WindowKey;
        const groups = await getWindowScreeningsByFilm(win, now);
        const nbNeedle = neighborhood ? normalizeForSearch(neighborhood) : null;

        const films: Array<{
          slug: string;
          title: string;
          director: string | null;
          year: number | null;
          country: string | null;
          url: string;
          venues: ReturnType<typeof toVenue>[];
        }> = [];

        for (const g of groups) {
          if (!g.film.slug) continue; // unlinkable — skip (AC: every film has a usable slug)
          const venues: ReturnType<typeof toVenue>[] = [];
          for (const v of g.byVenue) {
            if (cinema_id && v.cinema.id !== cinema_id) continue;
            if (
              nbNeedle &&
              !(
                v.cinema.neighborhood &&
                normalizeForSearch(v.cinema.neighborhood).includes(nbNeedle)
              )
            ) {
              continue;
            }
            const live = catchable(v.screenings, now);
            if (live.length === 0) continue;
            venues.push(toVenue(v.cinema, live));
          }
          if (venues.length === 0) continue;
          films.push({
            slug: g.film.slug,
            title: g.film.title,
            director: g.film.director,
            year: g.film.year,
            country: g.film.country,
            url: `${SITE_URL}/pelicula/${g.film.slug}`,
            venues,
          });
        }

        const cap = limit ?? 40;
        const truncated = films.length > cap;
        const shown = films.slice(0, cap);
        const structured = {
          window: win,
          windowLabel: getWindowDef(win).label,
          filters: { cinema_id: cinema_id ?? null, neighborhood: neighborhood ?? null },
          filmCount: shown.length,
          truncated,
          films: shown,
        };
        const body = shown.length
          ? shown
              .map(
                (f) =>
                  `- ${f.title}${f.year ? ` (${f.year})` : ''} @ ${f.venues.map((v) => v.cinema.name).join(', ')}`,
              )
              .join('\n')
          : 'nada en cartelera para ese filtro.';
        return {
          structuredContent: structured,
          content: [
            text(
              `${getWindowDef(win).label}: ${shown.length} película(s)${truncated ? ` (de ${films.length}, recortado)` : ''}\n${body}`,
            ),
          ],
        };
      }),
  );

  // -------------------------------------------------------------------------
  // get_film
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_film',
    {
      title: 'Detalle de película',
      description:
        'Full detail for one film by its slug (from search_films or whats_on): director, year, country, ' +
        'runtime, synopsis (es), genres, cast, plus every still-catchable upcoming showtime grouped by venue. ' +
        'Unknown slug → { found: false }. In the catalog but nothing upcoming → { found: true, showtimeCount: 0 }.',
      inputSchema: {
        slug: z.string().describe('The film slug, e.g. "blue-velvet".'),
      },
      outputSchema: {
        found: z.boolean(),
        slug: z.string(),
        film: filmDetailSchema.optional(),
        showtimeCount: z.number(),
        venues: z.array(venueSchema),
      },
    },
    async ({ slug }) =>
      safe(async () => {
        const now = new Date();
        const res = await getUpcomingScreeningsByFilm(slug, now);
        const live = res ? catchable(res.screenings, now) : [];
        const film = res?.film ?? (await getFilmBySlug(slug));

        if (!film) {
          return {
            structuredContent: { found: false, slug, showtimeCount: 0, venues: [] },
            content: [text(`No conozco ninguna película con el slug "${slug}".`)],
          };
        }

        const venues = toVenues(live);
        const dto = toFilmDTO(film);
        const structured = {
          found: true,
          slug,
          film: dto,
          showtimeCount: live.length,
          venues,
        };
        const when =
          live.length === 0
            ? 'sin funciones próximas.'
            : venues
                .map(
                  (v) =>
                    `- ${v.cinema.name}: ${v.showtimes.map((s) => s.label).join(' / ')}`,
                )
                .join('\n');
        return {
          structuredContent: structured,
          content: [
            text(
              `${dto.title}${dto.year ? ` (${dto.year})` : ''}${dto.director ? ` · ${dto.director}` : ''}\n${live.length} función(es) próxima(s):\n${when}`,
            ),
          ],
        };
      }),
  );

  // -------------------------------------------------------------------------
  // list_cinemas
  // -------------------------------------------------------------------------
  server.registerTool(
    'list_cinemas',
    {
      title: 'Salas',
      description:
        'The directory of Buenos Aires indie cinemas afiche tracks — id (slug), name, neighborhood, ' +
        'address, type. Use it to discover valid cinema_id / neighborhood values for whats_on.',
      inputSchema: {},
      outputSchema: {
        count: z.number(),
        cinemas: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            neighborhood: z.string().nullable(),
            address: z.string().nullable(),
            type: z.string(),
            ticketingBaseUrl: z.string().nullable(),
          }),
        ),
      },
    },
    async () =>
      safe(async () => {
        const cinemas = await listCinemas();
        const structured = { count: cinemas.length, cinemas };
        const body = cinemas
          .map(
            (c) => `- ${c.id}: ${c.name}${c.neighborhood ? ` (${c.neighborhood})` : ''}`,
          )
          .join('\n');
        return {
          structuredContent: structured,
          content: [text(`${cinemas.length} salas:\n${body}`)],
        };
      }),
  );
}
