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
  backdropImageUrl,
  extractDirectors,
  extractTopCast,
  extractGenreIds,
  type TmdbMovieDetails,
  type TmdbMovieSummary,
} from './client';
import type { CastMember } from '@/db/schema';
import { pickBestMatch, scoreCandidates, MATCH_CONFIDENCE_THRESHOLD } from './match';
import { stripDiacritics, levenshteinAtMostOne, stripSearchNoise } from './similarity';
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
  /**
   * 16:9 cinematic still from TMDB. Stored at w1280 — sized for the
   * /pelicula editorial-still slot at 2x DPR. Null when TMDB has no
   * backdrop on file (common for shorts and long-tail festival titles).
   */
  backdropUrl: string | null;
  /**
   * Spanish synopsis sourced from TMDB. Resolved via es-AR → es fallback
   * chain (see `buildDelta` for details). null when both languages return
   * empty `overview` — TMDB has no Spanish coverage for that film.
   *
   * Precedence at ingest time: scraped-venue synopsis (Lumiton, MALBA,
   * Lugones detail-page enrichment) wins over the TMDB fallback. The
   * TMDB synopsis only writes through to films.synopsis_es when the row
   * currently has null. See `enrichPendingFilms` for the precedence guard.
   */
  synopsisEs: string | null;
  /**
   * Top-billed cast (up to 8) from TMDB credits, in billing order.
   * Empty array when TMDB has no credits for the film. Render layer treats
   * empty-character entries as name-only.
   */
  cast: CastMember[];
  /**
   * TMDB genre IDs (stable integers from /genre/movie/list). Empty array
   * when TMDB returns no genres. Render layer resolves to es-AR labels via
   * GENRE_LABELS_ES in @/db/schema.
   */
  genres: number[];
  /** TMDB popularity (recency/buzz-weighted). Ranks premiere + AR band slots. */
  popularity: number | null;
  /** TMDB vote average (0-10). Quality signal. */
  voteAverage: number | null;
  /** TMDB vote count (notability proxy). Ranks the classic band slot. */
  voteCount: number | null;
  /** TMDB tagline; null when blank. */
  tagline: string | null;
  matchConfidence: number | null;
  matchSource: 'auto' | 'override' | 'manual';
}

export interface EnrichResult {
  delta: EnrichmentDelta | null;
  reason: 'ok' | 'no-token' | 'no-candidates' | 'low-confidence' | 'error';
  error?: string;
}

/**
 * Optional hints from the scraper that help TMDB matching for films whose
 * Spanish title is ambiguous or unindexed. These fields are already pulled
 * by providers like Lugones (from the parenthesized "(Original; Country;
 * Year)" block) and Lumiton-family (from detail-page enrichment) — passing
 * them through rescues ~20% of films that title-only search misses.
 */
export interface EnrichHints {
  titleOriginal?: string;
  director?: string;
}

export async function enrichFilm(
  scrapedTitle: string,
  year: number | undefined,
  hints: EnrichHints = {},
): Promise<EnrichResult> {
  if (!hasTmdbToken()) {
    return { delta: null, reason: 'no-token' };
  }

  try {
    // 1. Manual override check — always takes precedence.
    const overrideId = await findOverride(scrapedTitle, year);
    if (overrideId !== null) {
      const details = await getMovie(overrideId);
      const delta = await buildDelta(details, 'override', null);
      return { delta, reason: 'ok' };
    }

    // 2. Union search across scrapedTitle AND titleOriginal (when distinct).
    // TMDB's search ranks partial matches liberally, so "Los inadaptados"
    // alone can miss "The Misfits" even with year=1961; adding the original
    // title query expands the candidate pool. Deduplicated by TMDB id.
    const queries: string[] = [scrapedTitle];
    if (hints.titleOriginal && hints.titleOriginal !== scrapedTitle) {
      queries.push(hints.titleOriginal);
    }
    // Retry-with-cleaned: venue noise ("… CON MÚSICA EN VIVO", "… EN 35 MM")
    // makes TMDB search return nothing for a film it has. Search the stripped
    // form too, and score against it (see MatchHints.cleanedTitle). ADR-0003.
    const cleanedTitle = stripSearchNoise(scrapedTitle);
    if (cleanedTitle !== scrapedTitle) {
      queries.push(cleanedTitle);
    }
    const seenIds = new Set<number>();
    const candidates: TmdbMovieSummary[] = [];
    for (const q of queries) {
      const results = await searchMovies(q, year);
      for (const r of results) {
        if (!seenIds.has(r.id)) {
          seenIds.add(r.id);
          candidates.push(r);
        }
      }
    }
    if (candidates.length === 0) {
      return { delta: null, reason: 'no-candidates' };
    }

    // 3. Fuzzy match with both title hints.
    const match = pickBestMatch(candidates, scrapedTitle, year, {
      titleOriginal: hints.titleOriginal,
      cleanedTitle,
    });

    // Cache the already-fetched top details so step 4 doesn't re-fetch
    // when director-verification fails and the rescue loop revisits the
    // same top candidate.
    let topDetails: TmdbMovieDetails | null = null;

    if (match) {
      topDetails = await getMovie(match.candidate.id);

      // Director verification — when the scraper provided a director hint,
      // the top title-match must agree before we accept it. This catches
      // the bug class where a single high-confidence title match is the
      // wrong film: e.g. the Nosferatu / Eggers vs Herzog case
      // (TODOS.md #18) where MALBA scraped just "Nosferatu" + "Werner
      // Herzog" but TMDB had Eggers 2024 with an exact title match
      // (score 1.0) AND Herzog 1979 with a longer localized title
      // (score ~0.87). pickBestMatch alone returned Eggers; director-
      // fallback never ran because the match wasn't low-confidence.
      // With this verification, mismatched director on the top match
      // falls through to step 4, which walks the sorted top-N and
      // accepts the first candidate whose director matches.
      const directorVerified =
        !hints.director || directorsMatch(hints.director, extractDirectors(topDetails));
      if (directorVerified) {
        const delta = await buildDelta(topDetails, 'auto', match.confidence);
        return { delta, reason: 'ok' };
      }
      // Fall through to step 4 — preserve topDetails for reuse.
    }

    // 4. Director fallback — fires when EITHER pickBestMatch returned
    // null (no candidate cleared threshold OR title was ambiguous per
    // the TITLE_AMBIGUITY_EPSILON guard in match.ts) OR the top match's
    // director failed verification above. Walks the sorted top-3 and
    // accepts the first whose credited director matches the hint.
    // This costs 1–3 extra API calls (minus 1 when topDetails is cached).
    if (hints.director) {
      const sorted = scoreCandidates(candidates, scrapedTitle, year, {
        titleOriginal: hints.titleOriginal,
        cleanedTitle,
      });
      for (const { candidate, confidence } of sorted.slice(0, 3)) {
        const details =
          match && candidate.id === match.candidate.id && topDetails
            ? topDetails
            : await getMovie(candidate.id);
        const tmdbDirectors = extractDirectors(details);
        if (directorsMatch(hints.director, tmdbDirectors)) {
          // Confidence boost: director match is a strong disambiguator,
          // so we credit this match at threshold level for traceability
          // even if the string score was below it.
          const boosted = Math.max(confidence, MATCH_CONFIDENCE_THRESHOLD);
          const delta = await buildDelta(details, 'auto', boosted);
          return { delta, reason: 'ok' };
        }
      }
    }

    return { delta: null, reason: 'low-confidence' };
  } catch (err) {
    return {
      delta: null,
      reason: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Compare a scraped director string against TMDB's credited directors.
 *
 * Two-tier match:
 *
 *   1. Exact (after normalize) — scraped name normalizes equal to a TMDB
 *      crew name. Catches the bulk of legitimate matches, including
 *      accent/case/extended-Latin variation (Polish ł, Danish ø, Turkish ı,
 *      German ß) via the shared `stripDiacritics` helper. Primary path.
 *
 *   2. Levenshtein-1 fuzzy fallback — if no exact match, compare each
 *      scraped × TMDB pair with `levenshteinAtMostOne`. Catches single-char
 *      scraper-side typos. Canonical case: Lugones-emitted "Vsevolov
 *      Pudovkin" vs TMDB's "Vsevolod Pudovkin". Gated by MIN_FUZZY_LEN on
 *      both sides — short names ("Lee", "Roy", "Cher") have too many true
 *      distance-1 collisions in the global director-name population for a
 *      fuzzy match to be safe (wrong matches are worse than misses —
 *      memory: feedback_afiche_metadata_quality).
 *
 * Comma-split for scraped co-director strings (e.g. "Lynch, Frost"); any
 * scraped name matching any TMDB name (exact OR fuzzy) wins.
 *
 * Exported for unit tests; the canonical caller is enrichFilm's director-
 * fallback rescue.
 */

/**
 * Minimum normalized length for Levenshtein-1 fuzzy matching to apply.
 * Below this, the density of distance-1 director-name collisions is too
 * high to fuzz safely. 6 admits "Pudovkin" (8 chars) and single-name
 * directors typo'd by one char while excluding 3-4 letter first names.
 */
export const MIN_FUZZY_LEN = 6;

/**
 * Co-director separators. Venues join names with a Spanish conjunction as
 * often as with a comma — "Juan Cabral y Santiago Franco", "Magrio González
 * e Iris Serrano" (Spanish swaps `y`→`e` before an i- sound). Splitting only
 * on commas left those as one 30-character blob compared against TMDB's
 * individual credits, so a correct film at confidence 1.000 was rejected on
 * director verification (measured on prod 2026-07-27: 2 of 20 live misses).
 *
 * Over-splitting is safe here: `directorsMatch` also keeps the unsplit form
 * and accepts if ANY variant matches, so a name that legitimately contains
 * a conjunction (the Spanish "Ortega y Gasset" pattern) still matches whole.
 * Splitting can only add candidate comparisons, never remove one.
 */
const DIRECTOR_SEPARATOR_RE = /\s*(?:,|\/|&|\+|\by\b|\be\b|\band\b)\s*/gi;

/**
 * Given-name equivalence classes for the surname-anchored tier.
 *
 * Deliberately a lookup table, NOT a similarity threshold. Measured
 * Jaro-Winkler on real pairs (2026-07-27) shows no cutoff can separate the
 * two populations — gender and inflection variants score HIGHER than the
 * hypocorisms we want:
 *
 *     want:   charles/charlie 0.943   steven/stephen 0.894
 *     avoid:  juan/juana      0.960   marco/marcos   0.967   maria/mario 0.920
 *
 * A 0.90 threshold would match "María González" to "Mario González" while
 * still missing Steven/Stephen. So: an explicit, auditable table, same
 * philosophy as EXTENDED_LATIN_MAP in similarity.ts. Extend as real venue
 * credits expose new pairs.
 *
 * Groups must stay DISJOINT — membership is looked up by name, so a name in
 * two groups would make the relation ambiguous. (This is why "alex" sits with
 * alexander only, and alejandro carries its own diminutives.)
 *
 * Single-char typos are NOT this tier's job: tier 2 already fuzzes the full
 * name, so "Dziga Vertov"/"Dzigha Vertov" is handled there.
 */
const GIVEN_NAME_ALIASES: readonly (readonly string[])[] = [
  // English
  ['charles', 'charlie', 'charley', 'chuck'],
  ['steven', 'stephen', 'steve'],
  ['william', 'will', 'bill', 'billy'],
  ['robert', 'bob', 'bobby', 'rob'],
  ['richard', 'rick', 'ricky', 'dick'],
  ['michael', 'mike', 'micky'],
  ['thomas', 'tom', 'tommy'],
  ['james', 'jim', 'jimmy'],
  ['joseph', 'joe', 'joey'],
  ['daniel', 'danny'],
  ['anthony', 'tony'],
  ['edward', 'eddie', 'ted'],
  ['alexander', 'alex'],
  ['nicholas', 'nick'],
  ['benjamin', 'ben'],
  ['samuel', 'sam'],
  ['catherine', 'katherine', 'kathryn', 'kate', 'cathy'],
  ['elizabeth', 'liz', 'beth', 'betty'],
  ['margaret', 'maggie', 'peggy'],
  // Spanish / Argentine — the corpus this matcher actually serves
  ['francisco', 'paco', 'pancho', 'curro'],
  ['jose', 'pepe'],
  ['ignacio', 'nacho'],
  ['enrique', 'quique'],
  ['manuel', 'manolo'],
  ['alejandro', 'jandro'],
  ['antonio', 'tono'],
  ['dolores', 'lola'],
  ['guadalupe', 'lupe'],
  ['concepcion', 'concha'],
];

/** name → index of its equivalence class in GIVEN_NAME_ALIASES. */
const GIVEN_NAME_GROUP = new Map<string, number>(
  GIVEN_NAME_ALIASES.flatMap((group, i) => group.map((n) => [n, i] as const)),
);

/** Same person's given name, allowing for a known diminutive/variant. */
function givenNamesEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  const ga = GIVEN_NAME_GROUP.get(a);
  return ga !== undefined && ga === GIVEN_NAME_GROUP.get(b);
}

/** Split "Charles Chaplin" into leading given name + trailing surname. */
function splitPersonName(n: string): { given: string; surname: string } | null {
  const toks = n.split(/\s+/).filter(Boolean);
  if (toks.length < 2) return null;
  return { given: toks[0], surname: toks.slice(1).join(' ') };
}

export function directorsMatch(scraped: string, tmdbDirectors: string[]): boolean {
  const normalize = (s: string) => stripDiacritics(s).toLowerCase().trim();
  // Both the split parts AND the unsplit whole — see DIRECTOR_SEPARATOR_RE.
  const scrapedNames = [...scraped.split(DIRECTOR_SEPARATOR_RE), scraped]
    .map(normalize)
    .filter(Boolean);
  const tmdbNames = tmdbDirectors.map(normalize);

  // Tier 1: exact match after normalize. Cheap; covers most cases.
  if (scrapedNames.some((s) => tmdbNames.some((t) => t === s))) return true;

  // Tier 2: Levenshtein-1 fuzzy fallback, gated by length floor on BOTH
  // sides of the comparison. Asymmetric guards (e.g. only-scraped >= 6) leak
  // false positives when TMDB carries a short name; require both >= N.
  if (
    scrapedNames.some(
      (s) =>
        s.length >= MIN_FUZZY_LEN &&
        tmdbNames.some((t) => t.length >= MIN_FUZZY_LEN && levenshteinAtMostOne(s, t)),
    )
  ) {
    return true;
  }

  // Tier 3: surname-anchored hypocorism. Surname must match EXACTLY; only the
  // given name is allowed to vary, and only via the curated alias table.
  // Catches what Levenshtein-1 can't reach — TMDB credits Chaplin as
  // "Charlie", venues scrape "Charles" (2 edits). Keeping the surname strict
  // preserves the Nosferatu protection (TODOS.md #18): Herzog and Eggers
  // share no surname, so this tier can never confuse them.
  return scrapedNames.some((s) => {
    const sp = splitPersonName(s);
    if (!sp) return false;
    return tmdbNames.some((t) => {
      const tp = splitPersonName(t);
      return (
        tp !== null && sp.surname === tp.surname && givenNamesEquivalent(sp.given, tp.given)
      );
    });
  });
}

async function buildDelta(
  details: TmdbMovieDetails,
  matchSource: 'auto' | 'override' | 'manual',
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

  // Synopsis fallback chain: es-AR (already in `details.overview`) → es →
  // null. The first `details` came from getMovie(id) which defaults to
  // language=es-AR. If that overview is empty, retry with language=es to
  // pick up peninsular-Spanish coverage that TMDB may have for films
  // without an Argentina-localized translation. Errors propagate (per
  // /plan-ceo-review D7: simple chain semantics — blank means "TMDB has
  // no Spanish overview", a fetch error means "we failed to talk to
  // TMDB", and we don't conflate the two).
  const synopsisEs = await resolveSpanishSynopsis(details);

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
    backdropUrl: backdropImageUrl(details.backdrop_path, 'w1280'),
    synopsisEs,
    cast: extractTopCast(details),
    genres: extractGenreIds(details),
    popularity: details.popularity ?? null,
    voteAverage: details.vote_average ?? null,
    voteCount: details.vote_count ?? null,
    tagline: details.tagline?.trim() ? details.tagline.trim() : null,
    matchConfidence: confidence,
    matchSource,
  };
}

/**
 * Resolve a Spanish synopsis with es-AR → es fallback.
 *
 * Returns the trimmed overview text, or null when neither language has
 * coverage. Errors propagate to the caller (enrichFilm wraps them).
 */
async function resolveSpanishSynopsis(details: TmdbMovieDetails): Promise<string | null> {
  const esArOverview = details.overview?.trim() ?? '';
  if (esArOverview.length > 0) return esArOverview;

  // es-AR returned blank — try the regional-stripped 'es' as a second pass.
  const esDetails = await getMovie(details.id, 'es');
  const esOverview = esDetails.overview?.trim() ?? '';
  return esOverview.length > 0 ? esOverview : null;
}

/**
 * Enrich by an explicitly-provided TMDB id. Used by the manual-patch path:
 * an operator sets `films.tmdb_id` in Drizzle Studio for a row whose auto
 * match failed, and the next enrichment pass calls this to skip search and
 * fetch the full delta directly. Returns matchSource='manual' so the row
 * is locked from re-search on subsequent runs.
 *
 * Errors propagate as { reason: 'error' } the same way enrichFilm does, so
 * callers can keep the row at the existing matchSource on transient failure
 * and retry on the next pass.
 */
export async function enrichByTmdbId(tmdbId: number): Promise<EnrichResult> {
  if (!hasTmdbToken()) {
    return { delta: null, reason: 'no-token' };
  }
  try {
    const details = await getMovie(tmdbId);
    const delta = await buildDelta(details, 'manual', null);
    return { delta, reason: 'ok' };
  } catch (err) {
    return {
      delta: null,
      reason: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export { MATCH_CONFIDENCE_THRESHOLD };
