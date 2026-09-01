/**
 * Jaro-Winkler string similarity + supporting normalization helpers.
 *
 * Returns a score in [0, 1]: 1 = identical, 0 = no similarity.
 * Particularly good for short strings like film titles where typos,
 * accents, and diacritics matter but word order doesn't.
 *
 * See: https://en.wikipedia.org/wiki/Jaro%E2%80%93Winkler_distance
 *
 * We case-fold and strip accents before comparing, so "La Máscara" and
 * "la mascara" are treated as equal. This is important because TMDB's
 * Spanish titles often drop or add accents vs. the CTBA scrape.
 *
 * Extended-Latin handling (Polish ł, Danish ø, German ß, Turkish ı, etc.):
 * NFD doesn't decompose precomposed letters that lack a base + combining-mark
 * representation. "Żuławski" under NFD + combining-strip becomes "Zuławski"
 * (Ż decomposes; ł survives). For matcher purposes that's still a mismatch
 * against TMDB's anglicized "Zulawski". `stripDiacritics` applies a small
 * extended-Latin → ASCII map BEFORE NFD so both layers are covered.
 */

/**
 * Precomposed-Latin letters NFD doesn't decompose, mapped to their closest
 * ASCII equivalent. Small audit-able table; extend as new films expose new
 * characters in director credits or original titles.
 *
 * `ß → ss` and `æ → ae` are intentional multi-char substitutions (these
 * letters are conventionally Romanized that way; preserves match-ability
 * against TMDB's anglicized credits).
 */
const EXTENDED_LATIN_MAP: Record<string, string> = {
  ł: 'l',
  Ł: 'L',
  ø: 'o',
  Ø: 'O',
  æ: 'ae',
  Æ: 'AE',
  đ: 'd',
  Đ: 'D',
  ı: 'i',
  İ: 'I',
  ß: 'ss',
};

const EXTENDED_LATIN_RE = /[łŁøØæÆđĐıİß]/g;

/**
 * Strip both NFD-decomposable diacritics AND precomposed extended-Latin
 * letters. Order matters: apply the extended-Latin map BEFORE NFD so that
 * letters NFD won't decompose (Polish ł, Danish ø, etc.) become ASCII first,
 * then NFD handles the decomposable rest (Cyrillic-romanized accents, Spanish
 * tildes, etc.).
 *
 * Exported for callers that need the diacritic-stripping semantics without
 * the case-folding + punctuation-stripping that `normalize()` adds on top —
 * e.g. directorsMatch, which keeps punctuation in director names.
 */
export function stripDiacritics(s: string): string {
  return s
    .replace(EXTENDED_LATIN_RE, (ch) => EXTENDED_LATIN_MAP[ch] ?? ch)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function jaroWinkler(a: string, b: string): number {
  const s1 = normalize(a);
  const s2 = normalize(b);
  if (s1.length === 0 && s2.length === 0) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  // Jaro similarity
  const matchWindow = Math.max(0, Math.floor(Math.max(s1.length, s2.length) / 2) - 1);
  const s1Matches = new Array<boolean>(s1.length).fill(false);
  const s2Matches = new Array<boolean>(s2.length).fill(false);

  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  const jaro =
    (matches / s1.length + matches / s2.length + (matches - transpositions) / matches) /
    3;

  // Winkler boost: up to 4 characters of common prefix, scaled by 0.1.
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Predicate: are two strings within Levenshtein edit distance 1 of each
 * other? Returns true when 0 edits (identical) or exactly 1 edit (single
 * insertion, deletion, or substitution) transforms `a` into `b`.
 *
 * Used by directorsMatch as a fallback when exact normalized comparison
 * fails — catches scraper-side typos like "Vsevolov" vs TMDB's "Vsevolod"
 * (single-char substitution) without inviting the false positives Jaro-
 * Winkler would (Lee/Lea/Roy/Rob class). Callers MUST length-guard before
 * invoking: short strings produce too many true distance-1 collisions for
 * a fuzzy match to be safe (see directorsMatch's MIN_FUZZY_LEN guard).
 *
 * O(min(len(a), len(b))) — two-pointer walk with early termination, no DP
 * matrix. Distance > 1 returns false on first second-edit detection.
 */
export function levenshteinAtMostOne(a: string, b: string): boolean {
  const lenA = a.length;
  const lenB = b.length;
  if (Math.abs(lenA - lenB) > 1) return false;
  if (a === b) return true;

  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < lenA && j < lenB) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (lenA === lenB) {
      // Substitution: advance both pointers past the mismatch.
      i++;
      j++;
    } else if (lenA > lenB) {
      // Deletion from `a`: skip the extra char in `a`.
      i++;
    } else {
      // Insertion into `a` (i.e. extra char in `b`): skip the char in `b`.
      j++;
    }
  }
  // Trailing chars after the shorter ran out count as one more edit.
  if (i < lenA || j < lenB) edits++;
  return edits <= 1;
}

/**
 * Strip venue-appended noise from a title for TMDB SEARCH ONLY — never for
 * storage (`scraped_title` is immutable; see ADR-0002 and CONTEXT.md). Removes
 * parentheticals and common exhibition tags (format "en 35mm", live-music "con
 * música en vivo", "versión restaurada", language "doblada"/"vos",
 * "estreno"/"preestreno") that make TMDB's search return zero candidates for a
 * film it actually has — e.g. "LA QUIMERA DEL ORO CON MÚSICA EN VIVO" →
 * "LA QUIMERA DEL ORO" → The Gold Rush (1925). Returns the original title
 * unchanged if stripping would empty it.
 */
const SEARCH_NOISE_RE =
  /\b(?:con\s+m[uú]sica\s+en\s+vivo|m[uú]sica\s+en\s+vivo|en\s+\d+\s?mm|\d+\s?mm|copia\s+(?:nueva|restaurada|en\s+\d+\s?mm)|versi[oó]n\s+restaurada|preestreno|avant[\s-]?premi[eè]re|[uú]nica\s+funci[oó]n|funci[oó]n\s+[uú]nica|estreno|4k|doblada|subtitulada|vose?|vos)\b/gi;

/**
 * Trailing festival / cycle tag, joined to the real title by a dash — e.g.
 * "Tierra que habla - 8° FINCA", "TU ROSTRO - DOC BSAS". Venues append the
 * festival label to every film in a competition; TMDB has the film but not
 * the tagged form, so search returns zero candidates.
 *
 * Deliberately conservative: the tail must be ALL-CAPS (optionally led by an
 * ordinal like "8°"). The uppercase-only character class means a mixed-case
 * subtitle — "Algo ha cambiado - Un viaje quijotesco" — can't reach the `$`
 * anchor and is left untouched, so we only ever strip shout-cased festival
 * labels, never a legitimate lowercase subtitle. Bounded length keeps it from
 * eating a long trailing clause. (Discovered 2026-08-16 on the FINCA and
 * DOC BSAS cycles; see MATCHER_VERSION history.)
 */
const FESTIVAL_SUFFIX_RE =
  /\s*[-–—]\s*(?:\d+\s*[°ºªo]\s*)?[A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ0-9.°º]*(?:\s+[A-ZÁÉÍÓÚÜÑ0-9.°º]+){0,4}\s*$/u;

/**
 * Leading festival/cycle prefix, the mirror of FESTIVAL_SUFFIX_RE. Fires only
 * when the title opens with a cycle keyword and consumes up to the first colon,
 * so "FESTIVAL ESCENARIO: WE ARE THE SHAGS" → "WE ARE THE SHAGS" but a real
 * "Kill Bill: Volume 1" survives untouched.
 */
const FESTIVAL_PREFIX_RE =
  /^\s*(?:FESTIVAL|CONVOCATORIA|CICLO|MUESTRA|RETROSPECTIVA|COMPETENCIA|SEMANA|PROGRAMA|CORTOS|CORTOMETRAJES?)\b[^:]{0,40}:\s*/iu;

export function stripSearchNoise(title: string): string {
  const cleaned = title
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(FESTIVAL_PREFIX_RE, ' ')
    .replace(FESTIVAL_SUFFIX_RE, ' ')
    .replace(SEARCH_NOISE_RE, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s\-–—:,]+$/g, '')
    .trim();
  return cleaned.length > 0 ? cleaned : title;
}

function normalize(s: string): string {
  // stripDiacritics handles both NFD-decomposable accents AND precomposed
  // extended-Latin letters (Polish \u0142, Danish \u00f8, etc.) \u2014 see the helper's
  // module-level docstring above for why both layers matter.
  return stripDiacritics(s.toLowerCase())
    .replace(/[^\w\s]/g, '') // strip punctuation
    .replace(/\s+/g, ' ')
    .trim();
}
