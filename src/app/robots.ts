import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

/**
 * robots.txt (Next 16 file convention → /robots.txt).
 *
 * Two jobs. First, point crawlers at the sitemap: afiche's value is discovery,
 * and until 1.0 the ~500 /pelicula pages were reachable only by following
 * links from the cartelera, which only ever shows the current window.
 *
 * Second, keep the operator surface and the machine API out of the index.
 * /admin pages already set `robots: { index: false }` in their metadata, but
 * that only suppresses indexing AFTER a fetch; a Disallow keeps well-behaved
 * crawlers from requesting them at all. /api is disallowed for the same
 * reason — /api/mcp is public and documented on /acerca, but it's a protocol
 * endpoint, not a page, and has nothing to offer a search index.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin', '/api'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
