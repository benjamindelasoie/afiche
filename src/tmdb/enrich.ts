/**
 * TMDB enrichment — the public entry point.
 *
 * Given a scraped (title, year), returns a full enrichment delta:
 *   { tmdbId, imdbId, title, titleOriginal, director, runtime, country,
 *     posterUrl, confidence, matchSource }
 *
 * Or null if: no TMDB token set, the search returned no candidates, or
 * the fuzzy match fell below the confidence threshold and no override exists.
 *
 * NEVER throws — TMDB errors are converted to nulls so ingest can proceed
 * without the enrichment rather than failing the whole run.
 *
 * Poster strategy: we hotlink directly to TMDB's CDN
 * (image.tmdb.org/t/p/w342{posterPath}). No local caching. Previously the
 * enrich layer downloaded posters to /public/posters/*.jpg, but that
 * directory is read-only at runtime on Vercel deployments, so production
 * would have crashed on every miss. Hotlinking is also what TMDB
 * recommends for client-side rendering and matches what next/image
 * optimizes against via `remotePatterns: ['image.tmdb.org']`.
 */

import {
  hasTmdbToken,
  searchMovies,
  getMovie,
  posterImageUrl,
  extractDirectors,
  type TmdbMovieDetails,
} from './client';
import { pickBestMatch, MATCH_CONFIDENCE_THRESHOLD } from './match';
import { findOverride } from './overrides';

export interface EnrichmentDelta {
  tmdbId: number;
  imdbId: string | null;
  title: string;
  titleOriginal: string | null;
  director: string | null;
  country: string | null;
  year: number | null;
  runtimeMin: number | null;
  posterUrl: string | null;
  matchConfidence: number | null;
  matchSource: 'auto' | 'override';
}

export interface EnrichResult {
  delta: EnrichmentDelta | null;
  reason: 'ok' | 'no-token' | 'no-candidates' | 'low-confidence' | 'error';
  error?: string;
}

export async function enrichFilm(
  scrapedTitle: string,
  year: number | undefined,
): Promise<EnrichResult> {
  if (!hasTmdbToken()) {
    return { delta: null, reason: 'no-token' };
  }

  try {
    // 1. Manual override check
    const overrideId = await findOverride(scrapedTitle, year);
    if (overrideId !== null) {
      const details = await getMovie(overrideId);
      const delta = await buildDelta(details, 'override', null);
      return { delta, reason: 'ok' };
    }

    // 2. TMDB search
    const candidates = await searchMovies(scrapedTitle, year);
    if (candidates.length === 0) {
      return { delta: null, reason: 'no-candidates' };
    }

    // 3. Fuzzy match
    const match = pickBestMatch(candidates, scrapedTitle, year);
    if (!match) {
      return { delta: null, reason: 'low-confidence' };
    }

    // 4. Full details
    const details = await getMovie(match.candidate.id);
    const delta = await buildDelta(details, 'auto', match.confidence);
    return { delta, reason: 'ok' };
  } catch (err) {
    return {
      delta: null,
      reason: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function buildDelta(
  details: TmdbMovieDetails,
  matchSource: 'auto' | 'override',
  confidence: number | null,
): Promise<EnrichmentDelta> {
  const directors = extractDirectors(details);
  const country =
    details.production_countries.length > 0
      ? details.production_countries[0].iso_3166_1
      : null;
  const year = details.release_date
    ? parseInt(details.release_date.slice(0, 4), 10)
    : null;

  return {
    tmdbId: details.id,
    imdbId: details.imdb_id ?? null,
    title: details.title,
    titleOriginal: details.original_title ?? null,
    director: directors.length > 0 ? directors.join(', ') : null,
    country,
    year: Number.isNaN(year) ? null : year,
    runtimeMin: details.runtime ?? null,
    // Hotlinked TMDB CDN URL. next/image handles optimization via the
    // image.tmdb.org remotePattern in next.config.ts.
    posterUrl: posterImageUrl(details.poster_path, 'w342'),
    matchConfidence: confidence,
    matchSource,
  };
}

export { MATCH_CONFIDENCE_THRESHOLD };
