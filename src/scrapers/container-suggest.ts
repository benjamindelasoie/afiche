/**
 * Actor 2 helper — suggest the container keywords a set of failing titles needs.
 *
 * The `container-or-placeholder` matcher-pattern issue is mechanical: the fix is
 * a new skip word in `CONTAINER_PATTERNS` (`src/tmdb/container.ts`). This module
 * picks, per failing title, the highest-priority container keyword the title
 * actually contains, and returns the word-boundary regex sources to add. It is
 * pure so Actor 2's write step is deterministic and testable; the harness does
 * the file edit, the suite run, and the match-diff safety check.
 */

/**
 * Priority-ordered container keywords. Order matters: a title with both
 * FESTIVAL and CORTOS is filed under FESTIVAL. Each entry is a single word (or
 * fixed phrase) matched on a word boundary, case-insensitive, accent-tolerant
 * via the caller's normalization is NOT used here — we match the raw token so
 * the generated regex is human-legible in the diff.
 */
const KEYWORDS: string[] = [
  'FESTIVAL',
  'RETROSPECTIVA',
  'MUESTRA',
  'CICLO',
  'SEMANA',
  'CONVOCATORIA',
  'COMPETENCIA',
  'SORPRESA',
  'CORTOMETRAJES',
  'CORTOS',
];

export interface ContainerSuggestion {
  keyword: string;
  /** The regex source to add to CONTAINER_PATTERNS, e.g. `\\bFESTIVAL\\b`. */
  regexSource: string;
}

function keywordRe(k: string): RegExp {
  return new RegExp(`\\b${k}\\b`, 'i');
}

/**
 * Given failing titles and a predicate for what the CURRENT classifier already
 * catches, return the new keyword regexes needed so every still-uncaught title
 * becomes a container. Titles the classifier already catches, and titles with
 * no known container keyword, are skipped (the latter are not this lane's job).
 * Deduped, returned in KEYWORDS priority order.
 */
export function suggestContainerPatterns(
  titles: string[],
  alreadyCaught: (title: string) => boolean,
): ContainerSuggestion[] {
  const needed = new Set<string>();
  for (const title of titles) {
    if (alreadyCaught(title)) continue;
    const hit = KEYWORDS.find((k) => keywordRe(k).test(title));
    if (hit) needed.add(hit);
  }
  return KEYWORDS.filter((k) => needed.has(k)).map((keyword) => ({
    keyword,
    regexSource: `\\b${keyword}\\b`,
  }));
}

/** Titles from the suggestion's keywords that still would NOT be caught. */
export function uncoveredTitles(
  titles: string[],
  alreadyCaught: (title: string) => boolean,
): string[] {
  return titles.filter((t) => {
    if (alreadyCaught(t)) return false;
    return !KEYWORDS.some((k) => keywordRe(k).test(t));
  });
}
