import { slugify } from './slug';

/**
 * Display-layer resolution of the title afiche should SHOW for a film.
 *
 * Two columns are in play. `films.scraped_title` is the title exactly as the
 * venue rendered it (the audit trail of "what the scraper saw"); `films.title`
 * starts equal to it but gets overwritten with TMDB's canonical title once the
 * film matches. The product rule: **honor the venue's title**, because a
 * cartelera's job is to get someone to the right box office — if afiche says
 * "El arquitecto" but Cine Lorca's marquee says "El gran arco", the tool
 * failed at the last step. TMDB stays the source of truth for everything else
 * (poster, synopsis, director, year, original title) and for *casing*.
 *
 * Resolution:
 *   - Unmatched (`match_source ∈ ('none','none-attempted')` or `skip_tmdb`):
 *     `title` === `scraped_title` (TMDB never wrote), so render the venue
 *     title, sentence-cased when it's all-caps.
 *   - Matched, venue title == TMDB title (modulo case/accents/punctuation):
 *     a pure casing/diacritic drift — prefer TMDB's clean form. This keeps
 *     proper nouns ("La reina Margot") that sentence-casing an all-caps venue
 *     title would destroy ("La reina margot").
 *   - Matched, venue title genuinely DIFFERS (a different translation, e.g.
 *     "El gran arco" vs TMDB "El arquitecto"): honor the venue title,
 *     sentence-cased when all-caps.
 *
 * We do NOT re-case `scraped_title` at scrape time — it stays raw (matcher
 * normalization decision, 2026-05-19). This helper is render-only.
 *
 * Sentence-casing strategy: capitalize the first letter + the first letter
 * after a sentence terminator (.!?). Colon ":" is intentionally NOT a
 * terminator — Spanish typography keeps the post-colon word lowercase
 * ("Función especial: un buen día"). Proper-noun preservation inside an
 * all-caps *differing* title is out of scope (rare; "EL ÚLTIMO TANGO EN
 * PARÍS" → "…en parís"). For Cine Lorca — the one venue whose titles arrive
 * all-caps from a vision model — that residual is reduced upstream by the
 * prompt asking for natural casing (see src/providers/cine-lorca.ts).
 */

export interface FilmTitleInputs {
  /** `films.title` — TMDB's canonical title once matched; else == scrapedTitle. */
  title: string;
  /** `films.scraped_title` — the title exactly as the venue rendered it. */
  scrapedTitle: string;
  matchSource: 'auto' | 'override' | 'manual' | 'none' | 'none-attempted';
  skipTmdb: boolean;
}

export function displayFilmTitle(film: FilmTitleInputs): string {
  const unmatched =
    film.skipTmdb || film.matchSource === 'none' || film.matchSource === 'none-attempted';
  // Unmatched → films.title was never overwritten, so it equals the scraped
  // venue title. Matched-but-the-venue-named-it-differently → honor the venue.
  if (unmatched || !sameTitle(film.scrapedTitle, film.title)) {
    return caseIfAllCaps(film.scrapedTitle);
  }
  // Matched and the venue agrees on the title — take TMDB's clean casing.
  return film.title;
}

/** Sentence-case the string only when it's detectably all-caps; else verbatim. */
function caseIfAllCaps(s: string): string {
  return isAllCaps(s) ? toSentenceCase(s) : s;
}

/**
 * True when two titles are the same film name modulo cosmetic drift — casing,
 * accents, punctuation, whitespace. Implemented as slug equality so "EL
 * DESPRECIO" ≈ "El desprecio" but "El gran arco" ≠ "El arquitecto". A real
 * word-level difference means the venue deliberately named the film
 * differently, which we honor.
 */
function sameTitle(a: string, b: string): boolean {
  return slugify(a) === slugify(b);
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
    (c) => c === c.toLocaleUpperCase('es') && c !== c.toLocaleLowerCase('es'),
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
    (_, p: string, gap: string, ch: string) => p + gap + ch.toLocaleUpperCase('es'),
  );
}
