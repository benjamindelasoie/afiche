/**
 * Display-layer smart-casing for films that have not been TMDB-matched.
 *
 * Background: scrapers store `films.title` as the venue rendered it. Some
 * venues (notably Cine Lorca) use all-caps; others occasionally emit
 * curator-prefixed shouting ("FUNCIÓN ESPECIAL: …"). Once a film matches
 * TMDB, `films.title` gets overwritten with the canonical casing, so this
 * problem self-resolves for the majority of rows. But for the unmatched
 * tail (`match_source ∈ ('none', 'none-attempted')`, or `skip_tmdb=true`)
 * the cartelera would otherwise shout the title in the user's face.
 *
 * Per the matcher-normalization decision (session 2026-05-19), we do NOT
 * re-case `scraped_title` at scrape time — it's the audit trail of "what
 * the scraper saw". This helper is render-only.
 *
 * Trigger: the row is unmatched AND the title is detectably all-caps.
 * Strategy: sentence case (capitalize first letter + first letter after a
 * sentence terminator). Colon ":" is intentionally NOT a sentence
 * terminator — Spanish typography keeps the post-colon word lowercase
 * ("Función especial: un buen día"). Acronym + proper-noun preservation
 * is out of scope; titles like "BLADE RUNNER" → "Blade runner" are an
 * acceptable degradation since matched rows take TMDB's canonical form.
 */

export interface FilmTitleInputs {
  title: string;
  matchSource: 'auto' | 'override' | 'manual' | 'none' | 'none-attempted';
  skipTmdb: boolean;
}

export function displayFilmTitle(film: FilmTitleInputs): string {
  const unmatched =
    film.skipTmdb ||
    film.matchSource === 'none' ||
    film.matchSource === 'none-attempted';
  if (!unmatched) return film.title;
  if (!isAllCaps(film.title)) return film.title;
  return toSentenceCase(film.title);
}

/**
 * True when the string has at least two cased letters and every cased
 * letter is uppercase. Mixed-case strings (anything with a single
 * lowercase letter) return false — we don't touch titles that look
 * already-cased. Titles in scripts without case (Japanese, Arabic) also
 * return false: their letters are equal to both their upper and lower
 * forms.
 */
function isAllCaps(s: string): boolean {
  const letters = s.match(/\p{L}/gu);
  if (!letters || letters.length < 2) return false;
  return letters.every(
    (c) =>
      c === c.toLocaleUpperCase('es') && c !== c.toLocaleLowerCase('es'),
  );
}

function toSentenceCase(s: string): string {
  const lower = s.toLocaleLowerCase('es');
  // First letter of the string (skipping any leading non-letter chars
  // like «, ¡, ¿, ") gets uppercased.
  const leading = lower.replace(
    /^([^\p{L}]*)(\p{L})/u,
    (_, lead: string, ch: string) => lead + ch.toLocaleUpperCase('es'),
  );
  // Subsequent sentence terminators (.!?) start a new sentence; uppercase
  // the next letter, skipping any whitespace + Spanish opening punctuation
  // ("¿Quién? ¡Sí!" — both clauses get capitalized). Excludes ":" by design.
  return leading.replace(
    /([.!?])([^\p{L}]+)(\p{L})/gu,
    (_, p: string, gap: string, ch: string) =>
      p + gap + ch.toLocaleUpperCase('es'),
  );
}
