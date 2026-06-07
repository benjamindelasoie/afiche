/**
 * Build the "Director · Year · Country · NN min" metadata line for a film row.
 *
 * Pure + isolated (no JSX, no DB) so the react-zero-and-render trap is unit-
 * tested directly: a film with `runtimeMin === 0` must NOT print "0 min". The
 * truthiness guard drops a 0 runtime cleanly — never use `{film.runtimeMin &&
 * ...}` in JSX, which would render a literal "0" (regression ISSUE-001).
 * Joining built parts also avoids leading separators when an earlier field
 * (e.g. director) is null.
 */
export interface FilmMetaFields {
  director: string | null;
  year: number | null;
  country: string | null;
  runtimeMin: number | null;
}

export function filmMetaLine(film: FilmMetaFields): string {
  const parts: string[] = [];
  if (film.director) parts.push(film.director);
  if (film.year) parts.push(String(film.year));
  if (film.country) parts.push(film.country);
  if (film.runtimeMin) parts.push(`${film.runtimeMin} min`);
  return parts.join(' · ');
}
