/**
 * FilmLinks' pure view-model — turns a film's stored external identifiers into
 * the outbound links /pelicula renders.
 *
 * Split out from FilmLinks.tsx for the same reason film-row-model.ts is split
 * out of FilmRow.tsx: vitest runs in a node environment and collects only
 * *.test.ts, so the testable part of a component lives in a pure module beside
 * it.
 *
 * Both URL shapes are derived from ids already on the films row, never stored:
 *
 *   • letterboxd.com/tmdb/<tmdb_id>/ 302-redirects to the canonical film page.
 *     Letterboxd sources its film data from TMDB, so our tmdb_id is their key
 *     too — verified against all 86 TMDB-matched live films with zero misses.
 *   • imdb.com/title/<tconst>/ is IMDb's canonical URL shape, and tconst is
 *     exactly what films.imdb_id stores.
 *
 * Deriving rather than storing is what keeps this feature free: no table, no
 * migration, no scheduled job, no third-party request, and nothing that can go
 * stale independently of the match it came from.
 */

export interface FilmLinkTarget {
  /** Which mark to render. Switching on this rather than on the display label
   *  keeps the component's choice independent of user-facing copy. */
  source: 'letterboxd' | 'imdb';
  /** Brand name. Not rendered — the mark carries it — but it builds the
   *  accessible name and keeps the source human-readable in tests. */
  label: string;
  href: string;
  /** Spanish-native, names the destination rather than the action. */
  ariaLabel: string;
}

/**
 * Build the outbound links for a film. Returns [] when the film carries
 * neither identifier — 27 of 113 live films today, most of which are rows that
 * are not films at all (festival umbrella programs, "¡Película sorpresa!").
 * The caller renders nothing on an empty list: no label, no separator, no rule.
 */
export function buildFilmLinks(
  title: string,
  tmdbId: number | null,
  imdbId: string | null,
): FilmLinkTarget[] {
  const links: FilmLinkTarget[] = [];

  if (tmdbId !== null) {
    links.push({
      source: 'letterboxd',
      label: 'Letterboxd',
      href: `https://letterboxd.com/tmdb/${tmdbId}/`,
      ariaLabel: `Ver «${title}» en Letterboxd`,
    });
  }

  if (imdbId !== null) {
    links.push({
      source: 'imdb',
      label: 'IMDb',
      href: `https://www.imdb.com/title/${imdbId}/`,
      ariaLabel: `Ver «${title}» en IMDb`,
    });
  }

  return links;
}
