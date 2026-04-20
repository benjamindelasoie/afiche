/**
 * TMDB enrichment — the public entry point.
 *
 * Given a scraped (title, year), returns a full enrichment delta:
 *   { tmdbId, imdbId, title, titleOriginal, director, runtime, country,
 *     posterLocalUrl, confidence, matchSource }
 *
 * Or null if: no TMDB token set, the search returned no candidates, or
 * the fuzzy match fell below the confidence threshold and no override exists.
 *
 * NEVER throws — TMDB errors are converted to nulls so ingest can proceed
 * without the enrichment rather than failing the whole run.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  hasTmdbToken,
  searchMovies,
  getMovie,
  downloadPoster,
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

const POSTER_DIR_REL = 'public/posters';

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

  let posterUrl: string | null = null;
  if (details.poster_path) {
    try {
      posterUrl = await cachePoster(details.id, details.poster_path);
    } catch {
      // Poster download failure is non-fatal — leave posterUrl null, fall
      // back to typographic tile.
      posterUrl = null;
    }
  }

  return {
    tmdbId: details.id,
    imdbId: details.imdb_id ?? null,
    title: details.title,
    titleOriginal: details.original_title ?? null,
    director: directors.length > 0 ? directors.join(', ') : null,
    country,
    year: Number.isNaN(year) ? null : year,
    runtimeMin: details.runtime ?? null,
    posterUrl,
    matchConfidence: confidence,
    matchSource,
  };
}

/**
 * Download the poster into public/posters/{tmdbId}.jpg so Next.js serves
 * it from the same edge as the HTML. Returns the PUBLIC URL ('/posters/{id}.jpg').
 * If already cached, skips the download and returns the URL.
 */
async function cachePoster(tmdbId: number, posterPath: string): Promise<string> {
  const relPath = `/posters/${tmdbId}.jpg`;
  const fsPath = resolve(process.cwd(), POSTER_DIR_REL, `${tmdbId}.jpg`);

  if (existsSync(fsPath)) return relPath;

  await mkdir(resolve(process.cwd(), POSTER_DIR_REL), { recursive: true });
  const bytes = await downloadPoster(posterPath, 'w342');
  await writeFile(fsPath, bytes);
  return relPath;
}

export { MATCH_CONFIDENCE_THRESHOLD };
