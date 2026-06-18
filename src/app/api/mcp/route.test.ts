/**
 * HTTP-layer tests for the MCP route: method handling (GET→405, OPTIONS→204),
 * CORS headers, and a POST initialize smoke (proves mcp-handler is wired and
 * answers JSON-RPC). The MCP protocol itself is exercised in server.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock the DB layer so importing the route (→ tools → @/db/queries → db client)
// doesn't require DATABASE_URL.
const q = vi.hoisted(() => ({
  getWindowScreeningsByFilm: vi.fn().mockResolvedValue([]),
  getUpcomingScreeningsByFilm: vi.fn().mockResolvedValue(null),
  getFilmBySlug: vi.fn().mockResolvedValue(null),
  listCinemas: vi.fn().mockResolvedValue([]),
  searchUpcomingFilms: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/db/queries', () => q);

const { GET, POST, OPTIONS } = await import('./route');

function mcpRequest(method: string, body?: unknown): Request {
  return new Request('https://afiche.ar/api/mcp', {
    method,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('GET /api/mcp', () => {
  it('returns 405 (no server-initiated stream in stateless mode) with CORS', async () => {
    const res = await GET(mcpRequest('GET'));
    expect(res.status).toBe(405);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('OPTIONS /api/mcp', () => {
  it('answers the CORS preflight with 204', () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });
});

describe('POST /api/mcp — initialize', () => {
  it('responds 200 with afiche serverInfo and CORS', async () => {
    const res = await POST(
      mcpRequest('POST', {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const textBody = await res.text();
    expect(textBody).toContain('afiche');
  });
});
