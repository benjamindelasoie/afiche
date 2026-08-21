/**
 * Markdown content-negotiation endpoint (the acceptmarkdown.com convention).
 *
 * NOT meant to be linked or crawled directly — it's the rewrite target the
 * proxy (proxy.ts) sends a request to when the client sent `Accept:
 * text/markdown` for a negotiable public page. The original path rides in `?p=`;
 * the visible URL the agent sees stays the clean one (e.g. `/`), because the
 * proxy rewrites rather than redirects.
 *
 * Contract (acceptmarkdown.com / RFC 9110 content negotiation):
 *   - Content-Type: text/markdown; charset=utf-8
 *   - Vary: Accept, Accept-Encoding  ← so a CDN never serves the HTML variant
 *     to a markdown request (or vice-versa) off a shared cache key.
 *
 * The page bodies are built by pure functions in src/lib/site-markdown.ts; this
 * handler only maps a path to the DB reads that feed them.
 */

import { getWindowScreeningsByFilm, listCinemas } from '@/db/queries';
import {
  renderHomeMarkdown,
  renderCarteleraMarkdown,
  renderAcercaMarkdown,
  render404Markdown,
} from '@/lib/site-markdown';

// The homepage/cartelera are anchored to BA "now" (like the HTML pages), so the
// markdown must render per-request, never bake a stale window into a build.
export const dynamic = 'force-dynamic';

const MARKDOWN_HEADERS: Record<string, string> = {
  'Content-Type': 'text/markdown; charset=utf-8',
  // The load-bearing header for this whole feature: the same URL serves HTML or
  // markdown depending on Accept, so caches MUST key on it.
  Vary: 'Accept, Accept-Encoding',
  // Short shared-cache TTL with SWR: fresh enough for a daily-scraped cartelera,
  // cheap enough that agents don't hammer the DB.
  'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
};

/** Normalize a rewritten path: strip a trailing slash (except root) so `/acerca/` == `/acerca`. */
function normalizePath(p: string | null): string {
  if (!p) return '/';
  if (p.length > 1 && p.endsWith('/')) return p.slice(0, -1);
  return p;
}

export async function GET(request: Request): Promise<Response> {
  // Prefer the forwarded header the proxy sets (survives the rewrite reliably);
  // fall back to the ?p= query for direct/manual calls to this route.
  const url = new URL(request.url);
  const path = normalizePath(
    request.headers.get('x-md-path') ?? url.searchParams.get('p'),
  );
  const now = new Date();

  let body: string;
  let status = 200;

  switch (path) {
    case '/': {
      const [hoy, semana] = await Promise.all([
        getWindowScreeningsByFilm('hoy', now),
        getWindowScreeningsByFilm('semana', now),
      ]);
      body = renderHomeMarkdown({ hoy, semana, now });
      break;
    }
    case '/cartelera': {
      const [semana, prox] = await Promise.all([
        getWindowScreeningsByFilm('semana', now),
        getWindowScreeningsByFilm('prox', now),
      ]);
      body = renderCarteleraMarkdown({ semana, prox, now });
      break;
    }
    case '/acerca': {
      const cinemas = await listCinemas();
      body = renderAcercaMarkdown(cinemas);
      break;
    }
    default: {
      body = render404Markdown(path);
      status = 404;
      break;
    }
  }

  return new Response(body, { status, headers: MARKDOWN_HEADERS });
}
