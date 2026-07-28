import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';
import { listCinemas, listSitemapFilms } from '@/db/queries';

/**
 * sitemap.xml (Next 16 file convention → /sitemap.xml).
 *
 * afiche is a discovery product, and until 1.0 its ~500 `/pelicula` pages were
 * reachable only by following links off the cartelera — which by design shows
 * just the current window. Anything not screening this week was effectively
 * invisible to search.
 *
 * Generated per request rather than at build: the film set turns over with
 * every scrape, and a sitemap baked at deploy time would go stale within a day.
 *
 * `listSitemapFilms` returns only films with a still-upcoming screening and
 * excludes hidden ones — both because `/pelicula/<slug>` 404s otherwise, and
 * a sitemap full of 404s is worse than a smaller honest one.
 */
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [cinemaRows, filmRows] = await Promise.all([listCinemas(), listSitemapFilms()]);
  const now = new Date();

  // The cartelera changes daily, so the static entries carry today's date.
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: 'daily', priority: 1 },
    {
      url: `${SITE_URL}/cartelera`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/acerca`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ];

  const venueRoutes: MetadataRoute.Sitemap = cinemaRows.map((c) => ({
    url: `${SITE_URL}/sala/${c.id}`,
    lastModified: now,
    changeFrequency: 'daily',
    priority: 0.8,
  }));

  const filmRoutes: MetadataRoute.Sitemap = filmRows.map((f) => ({
    url: `${SITE_URL}/pelicula/${f.slug}`,
    lastModified: f.lastModified,
    changeFrequency: 'weekly',
    priority: 0.6,
  }));

  return [...staticRoutes, ...venueRoutes, ...filmRoutes];
}
