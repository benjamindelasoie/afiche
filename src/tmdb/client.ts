/**
 * TMDB v3 API client — minimal surface.
 *
 * Auth: uses a v4 "Read Access Token" (the long JWT-looking thing at
 * themoviedb.org → Settings → API → Read Access Token). Passed as
 * Authorization: Bearer <token>.
 *
 * Why v4 token for v3 endpoints: TMDB officially supports this combo, and
 * v4 tokens don't expire + are the recommended long-term approach. The
 * "API Key (v3 auth)" field in the dashboard is the older scheme.
 *
 * This module is deliberately thin. Fuzzy matching lives in match.ts;
 * poster caching lives in enrich.ts.
 */

const BASE = 'https://api.themoviedb.org/3';

export interface TmdbMovieSummary {
  id: number;
  title: string;
  original_title: string;
  original_language: string;
  release_date: string;    // 'YYYY-MM-DD' or ''
  overview: string;
  poster_path: string | null;
  popularity: number;
  vote_count: number;
}

export interface TmdbMovieDetails extends TmdbMovieSummary {
  imdb_id: string | null;
  runtime: number | null;
  genres: Array<{ id: number; name: string }>;
  production_countries: Array<{ iso_3166_1: string; name: string }>;
  tagline: string;
  credits?: {
    cast: Array<{ id: number; name: string; order: number }>;
    crew: Array<{ id: number; name: string; job: string; department: string }>;
  };
}

export function hasTmdbToken(): boolean {
  return !!process.env.TMDB_API_TOKEN;
}

function authHeaders(): Record<string, string> {
  const token = process.env.TMDB_API_TOKEN;
  if (!token) {
    throw new Error(
      'TMDB_API_TOKEN is not set. Add it to .env.local (get one at themoviedb.org → Settings → API).',
    );
  }
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Search for a movie by title (+ optional year).
 * Uses language=es-AR so results prefer Spanish-language titles/overviews.
 * Returns up to 20 candidates ordered by TMDB's own relevance score.
 */
export async function searchMovies(
  title: string,
  year?: number,
): Promise<TmdbMovieSummary[]> {
  const params = new URLSearchParams({
    query: title,
    language: 'es-AR',
    include_adult: 'false',
  });
  if (year !== undefined) params.set('year', String(year));
  const res = await fetch(`${BASE}/search/movie?${params.toString()}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`TMDB search failed: HTTP ${res.status} for query "${title}"`);
  }
  const body = (await res.json()) as { results?: TmdbMovieSummary[] };
  return body.results ?? [];
}

/**
 * Fetch full movie details + credits by TMDB ID. Used after a match to
 * enrich with runtime, imdb_id, director, and (if desired) cast.
 */
export async function getMovie(id: number): Promise<TmdbMovieDetails> {
  const params = new URLSearchParams({
    language: 'es-AR',
    append_to_response: 'credits',
  });
  const res = await fetch(`${BASE}/movie/${id}?${params.toString()}`, {
    headers: authHeaders(),
  });
  if (!res.ok) {
    throw new Error(`TMDB movie fetch failed: HTTP ${res.status} for id ${id}`);
  }
  return (await res.json()) as TmdbMovieDetails;
}

/**
 * Poster image URL for a given poster_path and width.
 * Available widths: w92, w154, w185, w342, w500, w780, original
 * For the week view, w342 is the sweet spot (120px render slot @ 2x DPI).
 */
export function posterImageUrl(
  posterPath: string | null,
  width: 'w92' | 'w154' | 'w185' | 'w342' | 'w500' | 'w780' | 'original' = 'w342',
): string | null {
  if (!posterPath) return null;
  return `https://image.tmdb.org/t/p/${width}${posterPath}`;
}

/**
 * Download a poster as raw bytes. Used by the enrich layer to cache posters
 * on our own CDN instead of hotlinking image.tmdb.org.
 */
export async function downloadPoster(
  posterPath: string,
  width: 'w342' | 'w500' | 'original' = 'w342',
): Promise<Buffer> {
  const url = posterImageUrl(posterPath, width);
  if (!url) throw new Error('posterPath is null');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`poster download failed: HTTP ${res.status}`);
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

/**
 * Extract the director's name from credits. Returns the first person with
 * job = 'Director' in the crew. If multiple (co-directed), returns all.
 */
export function extractDirectors(details: TmdbMovieDetails): string[] {
  if (!details.credits?.crew) return [];
  return details.credits.crew
    .filter((c) => c.job === 'Director')
    .map((c) => c.name);
}
