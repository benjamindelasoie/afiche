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
 * Version of the matching logic, stamped onto `films.match_attempt_version`
 * whenever a row lands in 'none-attempted'. Rows stamped with an older
 * version (or null, predating the column) re-enter the enrichment pool
 * automatically, so a matcher improvement gets a pass at the backlog it was
 * written to rescue.
 *
 * BUMP THIS whenever a change could turn a past miss into a hit — a scoring
 * change here, a query-shaping change in similarity.ts (stripSearchNoise),
 * a title-splitting change in a provider, a threshold move. Cheap to bump:
 * the pending pool only ever queries films with a future screening, so a
 * bump costs one TMDB call per still-showing stuck row, not per stuck row.
 *
 * History:
 *   1 — implicit baseline (everything before this column existed).
 *   2 — v0.3.9.0's self-healing: stripSearchNoise() venue-noise stripping,
 *       splitCiclo() for Cacodelphia, the MALBA bare-comma director split.
 *       These shipped without a way to re-open the rows they targeted, so
 *       the backlog stayed locked and the feature was a no-op in prod.
 *   3 — directorsMatch: split co-directors on Spanish conjunctions (y / e)
 *       as well as commas, and a surname-anchored tier that tolerates
 *       given-name hypocorisms (Charles/Charlie). Both were rejecting
 *       confidence-1.000 correct matches on prod.
 *   4 — director-pivot rescue: when title search returns zero candidates,
 *       look the director up on TMDB and accept a credit only when a scraped
 *       year exists and exactly one credit falls in the year window.
 *   5 — two independent rescues for the same stuck pool: `directorsComparable`
 *       (enrich.ts) makes director verification ABSTAIN instead of reject when
 *       TMDB credits the director in a non-Latin script, which was silently
 *       excluding effectively all Japanese/Chinese/Korean/Russian cinema; and
 *       `titleForms` scores the pre-subtitle form of a candidate title, so
 *       "Paprika, detective de los sueños" can win against a cartelera that
 *       says PAPRIKA.
 *   6 — three more unmatched-backlog rescues (measured on prod 2026-08-16):
 *       (a) the director-pivot now also fires after the title axis produced
 *           candidates but none verified — not only on zero candidates — so a
 *           film buried under wrong title hits is still findable by director:
 *           "Luca"/Espina (under Italian inspector serials), "Paprika"/Kon
 *           (outscored by "Paprika Western"). Still gated by scraped year +
 *           single-credit-in-window.
 *       (b) the pivot's uniqueness count now requires a CONCRETE in-window
 *           release date (`concreteYearWithin`), so an undated/unfinished
 *           project can't dilute "exactly one" — Kon's undated 夢みる機械 was
 *           blocking the Paprika rescue.
 *       (c) `stripSearchNoise` drops trailing ALL-CAPS festival tags
 *           (" - 8° FINCA", " - DOC BSAS") that returned zero candidates.
 *   7 — `stripSearchNoise` also drops the LEADING festival/cycle prefix
 *       ("FESTIVAL ESCENARIO: X" → "X"), the mirror of (6c). Bumping re-opens
 *       the none-attempted rows the prefix had stuck at zero candidates.
 */
export const MATCHER_VERSION = 7;
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

    const titleVariants = titleForms(c.title);
    const origVariants = titleForms(c.original_title);

    let bestScore = 0;
    let matchedAgainst: 'title' | 'original_title' = 'title';
    for (const q of queries) {
      for (const t of titleVariants) {
        const s = jaroWinkler(q, t);
        if (s > bestScore) {
          bestScore = s;
          matchedAgainst = 'title';
        }
      }
      for (const t of origVariants) {
        const s = jaroWinkler(q, t);
        if (s > bestScore) {
          bestScore = s;
          matchedAgainst = 'original_title';
        }
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

/**
 * Separator introducing a descriptive subtitle on a Spanish release title.
 * Comma, colon, or a spaced dash — never a bare space, which would let any
 * two-word title be truncated to its first word.
 */
const SUBTITLE_SEPARATOR_RE = /\s*(?:,|:|\s[-–—]\s).*$/;

/**
 * The forms of a TMDB title worth scoring against.
 *
 * Spanish-language TMDB releases routinely append a descriptive subtitle the
 * venue never writes: "Paprika, detective de los sueños" for a cartelera that
 * says PAPRIKA. Jaro-Winkler punishes that length gap hard — the correct
 * candidate scored 0.845 against a 0.85 threshold while the WRONG film
 * ("Paprika Western") scored 0.893 and won. Scoring the pre-subtitle form too
 * lifts the right one to 1.000.
 *
 * Deliberately anchored on real punctuation. "El ángel exterminador" has no
 * separator, so it is never truncated to "El ángel" — that containment is a
 * different film and must stay a miss. Where truncation DOES create a genuine
 * tie (Herzog's "Nosferatu, el vampiro" vs Eggers' "Nosferatu"), both reach
 * ~1.0, TITLE_AMBIGUITY_EPSILON fires and the director rescue disambiguates —
 * the guard still holds.
 */
export function titleForms(title: string | undefined): string[] {
  const full = (title ?? '').trim();
  if (!full) return [''];
  const main = full.replace(SUBTITLE_SEPARATOR_RE, '').trim();
  return main && main !== full ? [full, main] : [full];
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
