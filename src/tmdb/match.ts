/**
 * Fuzzy-match a scraped film against TMDB search results.
 *
 * Strategy:
 *   1. Score each candidate against the scraped title (and optionally the
 *      scraped original title) using Jaro-Winkler on BOTH the candidate's
 *      localized title AND original_title, taking the max across all
 *      combinations. This handles cases where:
 *        - The scrape gave us the Spanish title but TMDB stores the entry
 *          under the original (e.g. "Los inadaptados" vs "The Misfits").
 *        - TMDB's es-AR localized title differs from the Argentinian
 *          release name (e.g. "Vidas Rebeldes" vs "Los Inadaptados").
 *   2. Year must match within ±1 (some TMDB release dates are slightly
 *      different from the theatrical release in Argentina).
 *   3. Confidence threshold: 0.85. Below that, pickBestMatch returns null
 *      and enrich.ts's director fallback path takes over.
 *
 * Tunable knobs are exported as constants so we can revisit after seeing
 * real match quality.
 */

import { jaroWinkler } from './similarity';
import type { TmdbMovieSummary } from './client';

export const MATCH_CONFIDENCE_THRESHOLD = 0.85;
export const YEAR_TOLERANCE = 1;
/**
 * Two candidates whose confidence scores are within this band are considered
 * tied on title — the matcher cannot disambiguate them by title similarity
 * alone. When such a tie occurs AND both tied candidates clear the confidence
 * threshold, `pickBestMatch` refuses to auto-pick (returns null) so the
 * director-fallback rescue in `enrich.ts` can disambiguate via TMDB credits.
 *
 * Same numeric band as the existing tiebreak (line ~82): below this delta
 * the original sort uses popularity to break ties. Popularity is the wrong
 * signal when we have a director hint that can actually disambiguate — the
 * Nosferatu case (TODOS.md #18) silently picked Eggers 2024 over Herzog 1979
 * because both scored ≈1.0 on title-only similarity and Eggers had vastly
 * higher TMDB popularity.
 */
export const TITLE_AMBIGUITY_EPSILON = 0.01;

export interface MatchHints {
  /** Original-language title from the scrape (e.g. "The Misfits"). */
  titleOriginal?: string;
  /**
   * Venue-noise-stripped form of the scraped title (`stripSearchNoise`), used
   * to also score candidates found via the cleaned search query — e.g. the
   * TMDB entry for "La quimera del oro" should score 1.0 against the cleaned
   * "LA QUIMERA DEL ORO", not the noisy "…CON MÚSICA EN VIVO". Never stored.
   */
  cleanedTitle?: string;
}

export interface MatchResult {
  candidate: TmdbMovieSummary;
  confidence: number;
  /** For debugging / logging: which variant scored highest */
  matchedAgainst: 'title' | 'original_title';
}

/**
 * Score every candidate and return them sorted best-first. Exposed so
 * enrich.ts can walk the top-N for director-fallback rescue even when
 * no candidate cleared the confidence threshold.
 *
 * Ties (within 0.01) are broken by TMDB popularity.
 */
export function scoreCandidates(
  candidates: TmdbMovieSummary[],
  scrapedTitle: string,
  scrapedYear?: number,
  hints?: MatchHints,
): MatchResult[] {
  const queries: string[] = [scrapedTitle];
  if (hints?.titleOriginal && hints.titleOriginal !== scrapedTitle) {
    queries.push(hints.titleOriginal);
  }
  if (hints?.cleanedTitle && hints.cleanedTitle !== scrapedTitle) {
    queries.push(hints.cleanedTitle);
  }

  const out: MatchResult[] = [];
  for (const c of candidates) {
    if (!yearAcceptable(c.release_date, scrapedYear)) continue;

    let bestScore = 0;
    let matchedAgainst: 'title' | 'original_title' = 'title';
    for (const q of queries) {
      const titleScore = jaroWinkler(q, c.title ?? '');
      const origScore = jaroWinkler(q, c.original_title ?? '');
      if (titleScore > bestScore) {
        bestScore = titleScore;
        matchedAgainst = 'title';
      }
      if (origScore > bestScore) {
        bestScore = origScore;
        matchedAgainst = 'original_title';
      }
    }
    out.push({ candidate: c, confidence: bestScore, matchedAgainst });
  }

  out.sort((a, b) => {
    if (Math.abs(a.confidence - b.confidence) > 0.01) return b.confidence - a.confidence;
    return (b.candidate.popularity ?? 0) - (a.candidate.popularity ?? 0);
  });
  return out;
}

export function pickBestMatch(
  candidates: TmdbMovieSummary[],
  scrapedTitle: string,
  scrapedYear?: number,
  hints?: MatchHints,
): MatchResult | null {
  const sorted = scoreCandidates(candidates, scrapedTitle, scrapedYear, hints);
  const best = sorted[0];
  if (!best || best.confidence < MATCH_CONFIDENCE_THRESHOLD) return null;

  // Title-ambiguity guard: if a runner-up clears the confidence threshold
  // AND ties the top within TITLE_AMBIGUITY_EPSILON, the matcher cannot
  // disambiguate by title similarity alone. Return null so enrich.ts's
  // director-fallback rescue can resolve via TMDB credits. When no director
  // hint is provided, the caller surfaces this as 'low-confidence' (visible
  // operator-actionable miss), which beats silently mismatching on
  // popularity (the Nosferatu / Eggers vs Herzog bug class — TODOS.md #18).
  const runnerUp = sorted[1];
  if (
    runnerUp &&
    runnerUp.confidence >= MATCH_CONFIDENCE_THRESHOLD &&
    best.confidence - runnerUp.confidence <= TITLE_AMBIGUITY_EPSILON
  ) {
    return null;
  }

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
