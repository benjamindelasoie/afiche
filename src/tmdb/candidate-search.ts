/**
 * Candidate search for the judge — the multi-query shaping the self-heal loop
 * and the judge eval both use, so the eval measures the judge against the SAME
 * candidate sets production feeds it (no drift between the two).
 *
 * It runs the scraped title, the original title, and the noise-stripped title
 * as separate TMDB searches and dedups by id, because the localized listing
 * title, the original, and the de-noised title each surface different results.
 */

import { searchMovies } from './client';
import { stripSearchNoise } from './similarity';
import type { TmdbMovieSummary } from './client';

export interface SearchableFilm {
  scrapedTitle: string;
  scrapedYear: number | null;
  titleOriginal: string | null;
}

/** The distinct search queries for a film, in priority order. */
function candidateQueries(f: SearchableFilm): string[] {
  const queries = [f.scrapedTitle];
  if (f.titleOriginal && f.titleOriginal !== f.scrapedTitle)
    queries.push(f.titleOriginal);
  const cleaned = stripSearchNoise(f.scrapedTitle);
  if (cleaned !== f.scrapedTitle) queries.push(cleaned);
  return queries;
}

export async function searchCandidates(f: SearchableFilm): Promise<TmdbMovieSummary[]> {
  const year = f.scrapedYear ?? undefined;
  // The 2-3 queries are independent — run them together, then dedup by id in
  // query-priority order (the same order a sequential loop would produce).
  const perQuery = await Promise.all(
    candidateQueries(f).map((q) => searchMovies(q, year)),
  );
  const seen = new Set<number>();
  const out: TmdbMovieSummary[] = [];
  for (const results of perQuery) {
    for (const r of results) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        out.push(r);
      }
    }
  }
  return out;
}
