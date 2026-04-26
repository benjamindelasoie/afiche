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
  type TmdbMovieSummary,
} from './client';
import { pickBestMatch, scoreCandidates, MATCH_CONFIDENCE_THRESHOLD } from './match';
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
    });
    if (match) {
      const details = await getMovie(match.candidate.id);
      const delta = await buildDelta(details, 'auto', match.confidence);
      return { delta, reason: 'ok' };
    }

    // 4. Director fallback — for films whose string similarity is below
    // the 0.85 threshold (localized titles that drift significantly from
    // both the scrape and the TMDB entry), fetch credits for the top-3
    // candidates and accept any whose credited director matches.
    // This costs 1–3 extra API calls per low-confidence film, only.
    if (hints.director) {
      const sorted = scoreCandidates(candidates, scrapedTitle, year, {
        titleOriginal: hints.titleOriginal,
      });
      for (const { candidate, confidence } of sorted.slice(0, 3)) {
        const details = await getMovie(candidate.id);
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
 * Accepts comma-separated names in the scraped string (co-directed films),
 * normalizes accents + case, and requires at least one pair to match
 * exactly. Last-name fuzzy match is intentionally not attempted — prefer
 * a missed fallback over a false positive.
 */
function directorsMatch(scraped: string, tmdbDirectors: string[]): boolean {
  const normalize = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  const scrapedNames = scraped
    .split(/\s*,\s*/)
    .map(normalize)
    .filter(Boolean);
  const tmdbNames = tmdbDirectors.map(normalize);
  return scrapedNames.some((s) => tmdbNames.some((t) => t === s));
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
    synopsisEs,
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
