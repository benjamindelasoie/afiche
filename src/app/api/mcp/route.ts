/**
 * afiche MCP server — hosted, read-only Model Context Protocol endpoint.
 *
 * Streamable HTTP, stateless (no Redis). Mounted at a LITERAL route so the
 * dynamic-segment catch-all problem is avoided: `mcp-handler` only responds
 * when `url.pathname === basePath + "/mcp"` (i.e. `/api/mcp`); any other
 * `/api/<x>` has no route here and gets Next's natural 404. SSE is disabled —
 * only Streamable HTTP is exposed, which is what stateless clients use.
 *
 *   POST   /api/mcp   → JSON-RPC (initialize / tools/list / tools/call)
 *   GET    /api/mcp   → 405 (no server-initiated stream in stateless mode)
 *   OPTIONS /api/mcp  → 204 + CORS preflight
 *
 * CORS is permissive: the data is already public and read-only, and browser /
 * Inspector clients need it (server-side connectors like Claude Desktop don't).
 *
 * Tools live in src/mcp/tools.ts (transport-agnostic), shaping in src/mcp/format.ts.
 */

import { createMcpHandler } from 'mcp-handler';
import { version as APP_VERSION } from '../../../../package.json';
import { registerAficheTools } from '@/mcp/tools';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, mcp-protocol-version',
};

const handler = createMcpHandler(
  (server) => registerAficheTools(server),
  { serverInfo: { name: 'afiche', version: APP_VERSION } },
  { basePath: '/api', maxDuration: 60, disableSse: true },
);

/** Pass the request through mcp-handler, then stamp CORS headers on the response. */
async function withCors(req: Request): Promise<Response> {
  const res = await handler(req);
  const headers = new Headers(res.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export { withCors as GET, withCors as POST };

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
