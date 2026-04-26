/**
 * URL slug generation for film records.
 *
 * Used to build `/pelicula/<slug>` URLs from `films.title` (or `scrapedTitle`
 * when no TMDB match exists) plus a year/id suffix. Stable across the project's
 * lifetime — slugs become URLs the moment a film is scraped, and changing
 * generation rules later breaks shared links.
 *
 * Algorithm:
 *   1. NFKD-normalize so combined chars (á = a + ́) split into base + diacritic
 *   2. Strip the diacritic codepoints (U+0300–U+036F)
 *   3. Lowercase
 *   4. Replace anything that isn't ASCII alphanum with a hyphen
 *   5. Collapse repeated hyphens
 *   6. Trim leading/trailing hyphens
 *
 * Spanish-aware behavior (verified by tests):
 *   - Tildes: á→a, é→e, í→i, ó→o, ú→u
 *   - ñ → n  (composed-form normalization handles this)
 *   - ü → u  (diéresis stripped)
 *   - Spanish punctuation ¿ ¡ « » " " — all become hyphens that collapse
 *   - Em-dash, en-dash, hyphen-minus all normalize to a single hyphen
 *
 * Empty-input behavior: returns ''. Callers MUST provide a fallback (typically
 * `films.id` as a numeric tail) so the final slug column is never empty.
 *
 * The function is pure and synchronous — safe to call inside Drizzle insert
 * payloads and SQL backfill scripts (when JS-driven).
 */

const MAX_SLUG_LENGTH = 80;

export function slugify(input: string): string {
  if (!input) return '';

  return (
    input
      .normalize('NFKD')
      // Strip combining diacritics (á → a, ñ → n, ü → u, etc.).
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      // Collapse anything that isn't ASCII letter/digit into a single hyphen.
      .replace(/[^a-z0-9]+/g, '-')
      // Trim leading/trailing hyphens that the previous step may have introduced.
      .replace(/^-+|-+$/g, '')
      // Cap length so URLs don't get unwieldy on long Spanish titles.
      .slice(0, MAX_SLUG_LENGTH)
      // Re-trim in case the slice landed on a trailing hyphen.
      .replace(/-+$/, '')
  );
}

/**
 * Build a film slug from title + a deterministic suffix.
 *
 * Suffix priority:
 *   1. year (e.g., `mulholland-drive-2001`) — preferred when known
 *   2. id    (e.g., `untitled-doc-1234`)    — fallback when year is null
 *
 * Caller is responsible for passing the right id at insert time. On UNIQUE
 * collision (rare — only when (slugify(title), year) matches an existing
 * row, e.g., re-releases or festival cuts), the upsert helper retries with
 * `${baseSlug}-${id}` as a deterministic tiebreaker.
 *
 * Returns a non-empty string. If slugify(title) is empty (title was all
 * punctuation), the suffix carries the slug alone.
 */
export function buildFilmSlug(
  title: string,
  options: { year: number | null; id?: number },
): string {
  const base = slugify(title);
  const suffix =
    options.year != null
      ? String(options.year)
      : options.id != null
        ? String(options.id)
        : '';

  if (!base && !suffix) {
    // Pathological case: empty title AND no year/id. Caller must supply id.
    return 'untitled';
  }
  if (!base) return suffix;
  if (!suffix) return base;
  return `${base}-${suffix}`;
}

/**
 * Apply the collision tiebreaker. Used by `upsertFilm()` after a UNIQUE
 * violation on the base slug.
 */
export function withIdSuffix(baseSlug: string, id: number): string {
  return `${baseSlug}-${id}`;
}
