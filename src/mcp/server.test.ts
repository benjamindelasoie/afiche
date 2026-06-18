/**
 * Integration test: drive the real MCP protocol over the SDK's in-memory
 * transport (no HTTP). Proves the initialize handshake, tools/list, and
 * tools/call all work end-to-end against registerAficheTools — the strongest
 * check that the tool contracts are wire-valid.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ScreeningRow, FilmGroup } from '@/db/queries';

const q = vi.hoisted(() => ({
  getWindowScreeningsByFilm: vi.fn(),
  getUpcomingScreeningsByFilm: vi.fn(),
  getFilmBySlug: vi.fn(),
  listCinemas: vi.fn(),
  searchUpcomingFilms: vi.fn(),
}));
vi.mock('@/db/queries', () => q);
const { registerAficheTools } = await import('./tools');

const future = new Date(Date.now() + 2 * 86_400_000);
const cinema = {
  id: 'malba',
  name: 'MALBA',
  neighborhood: 'Palermo',
  address: null,
  type: 'indie' as const,
};
function film(): ScreeningRow['film'] {
  return {
    id: 1,
    title: 'Blue Velvet',
    titleOriginal: 'Blue Velvet',
    director: 'David Lynch',
    year: 1986,
    country: 'US',
    runtimeMin: 120,
    synopsisEs: 'x',
    posterUrl: null,
    backdropUrl: null,
    slug: 'blue-velvet',
    cast: null,
    genres: [18],
    popularity: null,
    voteAverage: null,
    voteCount: null,
    createdAt: new Date(),
  };
}
function row(): ScreeningRow {
  return {
    id: 7,
    startsAtUtc: future,
    tags: [],
    sourceUrl: null,
    programName: null,
    film: film(),
    cinema,
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

async function connect(): Promise<Client> {
  const server = new McpServer({ name: 'afiche', version: 'test' });
  registerAficheTools(server);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientT);
  return client;
}

describe('MCP protocol (in-memory transport)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists exactly the 4 tools, each with input + output schema', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'get_film',
      'list_cinemas',
      'search_films',
      'whats_on',
    ]);
    for (const t of tools) {
      expect(t.inputSchema).toBeDefined();
      expect(t.outputSchema).toBeDefined();
    }
  });

  it('callTool whats_on returns a text block AND structuredContent', async () => {
    q.getWindowScreeningsByFilm.mockResolvedValue([filmGroup()]);
    const client = await connect();
    const res = await client.callTool({ name: 'whats_on', arguments: { window: 'hoy' } });
    expect(res.isError).toBeFalsy();
    expect(Array.isArray(res.content)).toBe(true);
    expect(res.structuredContent).toBeDefined();
    expect((res.structuredContent as { filmCount: number }).filmCount).toBe(1);
  });

  it('callTool get_film with an unknown slug returns found:false (no throw)', async () => {
    q.getUpcomingScreeningsByFilm.mockResolvedValue(null);
    q.getFilmBySlug.mockResolvedValue(null);
    const client = await connect();
    const res = await client.callTool({ name: 'get_film', arguments: { slug: 'ghost' } });
    expect((res.structuredContent as { found: boolean }).found).toBe(false);
  });
});
