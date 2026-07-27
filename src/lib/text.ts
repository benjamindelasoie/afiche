/**
 * Text normalization helpers.
 */

/**
 * Fold a string for accent- and case-insensitive substring search.
 * "Pedro Almodóvar" -> "pedro almodovar". Used by `searchUpcomingFilms`
 * (src/db/queries.ts) so a query of "almodovar" matches "Almodóvar" — SQLite
 * `LIKE` only case-folds ASCII and can't strip diacritics, so the fold + match
 * happens in JS over the (small, BA-scale) candidate set.
 *
 * NFD decomposition splits an accented char into base + combining mark; the
 * U+0300–U+036F range (`̀-ͯ`) drops the marks, leaving the bare letter.
 */
export function normalizeForSearch(input: string): string {
  return input.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
