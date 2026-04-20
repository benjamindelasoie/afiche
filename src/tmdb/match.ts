/**
 * Fuzzy-match a scraped film against TMDB search results.
 *
 * Strategy:
 *   1. Score each candidate against (scraped_title, year) using Jaro-Winkler
 *      on BOTH the candidate's localized title AND original_title, taking
 *      the max. This handles cases where the CTBA scrape gave us the
 *      Spanish title but TMDB stores the entry under the original.
 *   2. Year must match within ±1 (some TMDB release dates are slightly
 *      different from the theatrical release in Argentina).
 *   3. Confidence threshold: 0.85. Below that, report "no match" and let
 *      the typographic fallback render.
 *
 * Tunable knobs are exported as constants so we can revisit after seeing
 * real match quality.
 */

import { jaroWinkler } from './similarity';
import type { TmdbMovieSummary } from './client';

export const MATCH_CONFIDENCE_THRESHOLD = 0.85;
export const YEAR_TOLERANCE = 1;

export interface MatchResult {
  candidate: TmdbMovieSummary;
  confidence: number;
  /** For debugging / logging: which variant scored highest */
  matchedAgainst: 'title' | 'original_title';
}

export function pickBestMatch(
  candidates: TmdbMovieSummary[],
  scrapedTitle: string,
  scrapedYear?: number,
): MatchResult | null {
  if (candidates.length === 0) return null;

  let best: MatchResult | null = null;

  for (const c of candidates) {
    if (!yearAcceptable(c.release_date, scrapedYear)) continue;

    const titleScore = jaroWinkler(scrapedTitle, c.title ?? '');
    const origScore = jaroWinkler(scrapedTitle, c.original_title ?? '');
    const score = Math.max(titleScore, origScore);
    const matchedAgainst: 'title' | 'original_title' =
      titleScore >= origScore ? 'title' : 'original_title';

    // Small popularity tiebreaker: if scores are within 0.01, prefer more popular.
    if (!best || score > best.confidence + 0.01) {
      best = { candidate: c, confidence: score, matchedAgainst };
    } else if (Math.abs(score - best.confidence) < 0.01) {
      if ((c.popularity ?? 0) > (best.candidate.popularity ?? 0)) {
        best = { candidate: c, confidence: score, matchedAgainst };
      }
    }
  }

  if (!best || best.confidence < MATCH_CONFIDENCE_THRESHOLD) return null;
  return best;
}

function yearAcceptable(
  releaseDate: string | undefined,
  scrapedYear: number | undefined,
): boolean {
  // If we don't have a scraped year, accept any candidate.
  if (scrapedYear === undefined) return true;
  // If the candidate has no release date, be lenient.
  if (!releaseDate || releaseDate.length < 4) return true;
  const candYear = parseInt(releaseDate.slice(0, 4), 10);
  if (isNaN(candYear)) return true;
  return Math.abs(candYear - scrapedYear) <= YEAR_TOLERANCE;
}
