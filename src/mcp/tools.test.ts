import { describe, it, expect, beforeEach, vi } from 'vitest';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ScreeningRow, FilmGroup } from '@/db/queries';

// Mock the DB layer; shaping (format.ts) + windows stay real.
const q = vi.hoisted(() => ({
  getWindowScreeningsByFilm: vi.fn(),
  getUpcomingScreeningsByFilm: vi.fn(),
  getFilmBySlug: vi.fn(),
  listCinemas: vi.fn(),
  searchUpcomingFilms: vi.fn(),
}));
vi.mock('@/db/queries', () => q);

const { registerAficheTools } = await import('./tools');

// --- fixtures --------------------------------------------------------------
const future = new Date(Date.now() + 2 * 86_400_000);

function film(over: Partial<ScreeningRow['film']> = {}): ScreeningRow['film'] {
  return {
    id: 1,
    title: 'Blue Velvet',
    titleOriginal: 'Blue Velvet',
    director: 'David Lynch',
    year: 1986,
    country: 'US',
    runtimeMin: 120,
    synopsisEs: 'Un misterio.',
    posterUrl: null,
    backdropUrl: null,
    slug: 'blue-velvet',
    cast: null,
    genres: [18],
    popularity: null,
    voteAverage: null,
    voteCount: null,
    createdAt: new Date(),
    ...over,
  };
}
const cinema = {
  id: 'malba',
  name: 'MALBA',
  neighborhood: 'Palermo',
  address: null,
  type: 'indie' as const,
};
function row(over: Partial<ScreeningRow> = {}): ScreeningRow {
  return {
    id: 7,
    startsAtUtc: future,
    tags: ['vos'],
    sourceUrl: null,
    programName: null,
    film: film(),
    cinema,
    ...over,
  };
}
function filmGroup(): FilmGroup {
  return {
    film: film(),
    byVenue: [{ cinema, screenings: [row()] }],
    screenings: [row()],
    nextCatchableUtc: future.getTime(),
    totalCount: 1,
  };
}

// Fake server that captures registered tools.
interface Captured {
  config: { outputSchema: z.ZodRawShape };
  cb: (args: Record<string, unknown>) => Promise<{
    content: { type: string; text: string }[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
  }>;
}
function buildTools(): Record<string, Captured> {
  const reg: Record<string, Captured> = {};
  const server = {
    registerTool: (name: string, config: Captured['config'], cb: Captured['cb']) => {
      reg[name] = { config, cb };
    },
  } as unknown as McpServer;
  registerAficheTools(server);
  return reg;
}

let tools: Record<string, Captured>;
beforeEach(() => {
  vi.clearAllMocks();
  tools = buildTools();
});

describe('registerAficheTools', () => {
  it('registers exactly the 4 tools, each with input + output schema', () => {
    expect(Object.keys(tools).sort()).toEqual([
      'get_film',
      'list_cinemas',
      'search_films',
      'whats_on',
    ]);
    for (const name of Object.keys(tools)) {
      const cfg = tools[name].config as { inputSchema?: unknown; outputSchema?: unknown };
      expect(cfg.inputSchema).toBeDefined();
      expect(cfg.outputSchema).toBeDefined();
    }
  });
});

/** Assert structuredContent conforms to the tool's declared outputSchema (AC #8). */
function expectValidOutput(name: string, structured: unknown) {
  z.object(tools[name].config.outputSchema).parse(structured);
}

describe('whats_on', () => {
  it('returns catchable films grouped by venue, valid against outputSchema', async () => {
    q.getWindowScreeningsByFilm.mockResolvedValue([filmGroup()]);
    const res = await tools.whats_on.cb({ window: 'hoy' });
    expect(res.isError).toBeFalsy();
    expectValidOutput('whats_on', res.structuredContent);
    const sc = res.structuredContent as { filmCount: number; films: { slug: string }[] };
    expect(sc.filmCount).toBe(1);
    expect(sc.films[0].slug).toBe('blue-velvet');
    expect(res.content[0].text).toContain('Blue Velvet');
  });

  it('filters by an unknown cinema_id to empty and echoes the filter', async () => {
    q.getWindowScreeningsByFilm.mockResolvedValue([filmGroup()]);
    const res = await tools.whats_on.cb({ window: 'hoy', cinema_id: 'nope' });
    const sc = res.structuredContent as {
      filmCount: number;
      filters: { cinema_id: string | null };
    };
    expect(sc.filmCount).toBe(0);
    expect(sc.filters.cinema_id).toBe('nope');
  });

  it('matches neighborhood accent-insensitively', async () => {
    q.getWindowScreeningsByFilm.mockResolvedValue([filmGroup()]);
    const res = await tools.whats_on.cb({ window: 'hoy', neighborhood: 'palermo' });
    expect((res.structuredContent as { filmCount: number }).filmCount).toBe(1);
  });
});

describe('get_film', () => {
  it('found with catchable showtimes', async () => {
    q.getUpcomingScreeningsByFilm.mockResolvedValue({
      film: film(),
      screenings: [row()],
    });
    const res = await tools.get_film.cb({ slug: 'blue-velvet' });
    expectValidOutput('get_film', res.structuredContent);
    const sc = res.structuredContent as { found: boolean; showtimeCount: number };
    expect(sc.found).toBe(true);
    expect(sc.showtimeCount).toBe(1);
  });

  it('known film but nothing catchable → found:true, showtimeCount:0', async () => {
    q.getUpcomingScreeningsByFilm.mockResolvedValue(null);
    q.getFilmBySlug.mockResolvedValue(film());
    const res = await tools.get_film.cb({ slug: 'blue-velvet' });
    const sc = res.structuredContent as { found: boolean; showtimeCount: number };
    expect(sc.found).toBe(true);
    expect(sc.showtimeCount).toBe(0);
  });

  it('unknown slug → found:false', async () => {
    q.getUpcomingScreeningsByFilm.mockResolvedValue(null);
    q.getFilmBySlug.mockResolvedValue(null);
    const res = await tools.get_film.cb({ slug: 'ghost' });
    expectValidOutput('get_film', res.structuredContent);
    expect((res.structuredContent as { found: boolean }).found).toBe(false);
  });
});

describe('search_films', () => {
  it('shapes hits and validates against outputSchema', async () => {
    q.searchUpcomingFilms.mockResolvedValue([
      {
        slug: 'blue-velvet',
        title: 'Blue Velvet',
        titleOriginal: 'Blue Velvet',
        director: 'David Lynch',
        year: 1986,
        country: 'US',
        nextShowtimeUtc: future,
        venueCount: 1,
        screeningCount: 2,
      },
    ]);
    const res = await tools.search_films.cb({ query: 'velvet' });
    expectValidOutput('search_films', res.structuredContent);
    expect((res.structuredContent as { count: number }).count).toBe(1);
  });

  it('returns isError (not a throw) when the DB layer fails', async () => {
    q.searchUpcomingFilms.mockRejectedValue(new Error('turso down'));
    const res = await tools.search_films.cb({ query: 'velvet' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/no pude completar/i);
  });
});

describe('list_cinemas', () => {
  it('lists venues and validates against outputSchema', async () => {
    q.listCinemas.mockResolvedValue([
      {
        id: 'malba',
        name: 'MALBA',
        neighborhood: 'Palermo',
        address: null,
        type: 'indie',
        ticketingBaseUrl: null,
      },
    ]);
    const res = await tools.list_cinemas.cb({});
    expectValidOutput('list_cinemas', res.structuredContent);
    expect((res.structuredContent as { count: number }).count).toBe(1);
  });
});
