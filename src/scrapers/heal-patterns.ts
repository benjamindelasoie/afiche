/**
 * Layer 2 — cause grouping for the self-heal loop.
 *
 * Layer 1 heals the DATA (auto-applies overrides). Layer 2 looks at the films
 * that STILL missed and asks: is there a repeating, fixable-in-code cause? When
 * one cause explains >= 2 films it becomes a GitHub `matcher-pattern` issue so
 * the deterministic scraper/matcher can be improved and the tail shrinks for
 * good.
 *
 * This module is pure: it classifies and groups. The harness (scripts) opens
 * the issues — issue creation is a write credential and stays off the agent
 * (self-healing Decision #9). "Not in TMDB" is NOT a code bug, so films with no
 * fixable cause never become issues (Decision: fixable-in-code only).
 */

import { stripSearchNoise } from '@/tmdb/similarity';

/** A film that Layer 1 could not match (no candidate, or the judge declined). */
export interface Miss {
  id: number;
  scrapedTitle: string;
  scrapedYear: number | null;
  director: string | null;
}

export type MissCauseKey =
  | 'container-or-placeholder'
  | 'localized-title-miss'
  | 'unfixable';

export interface PatternGroup {
  cause: MissCauseKey;
  /** Stable marker embedded in the issue body for dedup across runs. */
  signature: string;
  title: string;
  body: string;
  /** Triage labels (always includes `matcher-pattern`). */
  labels: string[];
  films: Miss[];
}

/** A cause becomes an issue only once this many films share it. */
export const PATTERN_MIN_FILMS = 2;

/**
 * Broad container/placeholder shape — deliberately wider than the production
 * `isNonFilmContainer` classifier. A MISS that matches this shape is a false
 * negative of that classifier: a title we should have skipped but did not.
 * Tested on the noise-stripped title so a stripped festival prefix does not
 * drag a real film in.
 */
const CONTAINER_SHAPE: RegExp[] = [
  /\bFESTIVAL\b/i,
  /\bMUESTRA\b/i,
  /\bRETROSPECTIVA\b/i,
  /\bCICLO\b/i,
  /\bSEMANA\s+DE(?:L)?\s+CINE\b/i,
  /\bCORTOS?\b/i,
  /\bCORTOMETRAJES?\b/i,
  /\bCONVOCATORIA\b/i,
  /\bCOMPETENCIA\b/i,
  /\bPROGRAMA\s+(?:\d+|I{1,3}|IV|VI{0,3}|IX|XI{0,3}|X|DOBLE)\b/i,
  // Placeholders: "Película sorpresa", "Función sorpresa", "Preestreno sorpresa".
  /\b(?:PEL[IÍ]CULA|FUNCI[OÓ]N|PREESTRENO|FILM)\b[^.]{0,20}\bSORPRESA\b/i,
  /\bSORPRESA\b/i,
];

function looksLikeContainerOrPlaceholder(title: string): boolean {
  // Test the raw title AND the noise-stripped title: the shape word may live in
  // the tail that stripSearchNoise removes ("SMOF 2026 — CORTOS GANADORES").
  const stripped = stripSearchNoise(title);
  return CONTAINER_SHAPE.some((re) => re.test(title) || re.test(stripped));
}

/**
 * Classify one miss. Container/placeholder shape wins first (a container that
 * also has a director is still a container). A miss WITH a director is a
 * localized-title miss: the film is real (we have its director) but the Spanish
 * title did not resolve — a fixable matcher gap. Everything else is unfixable
 * (likely not in TMDB), which never becomes an issue.
 */
export function classifyMiss(m: Miss): MissCauseKey {
  if (looksLikeContainerOrPlaceholder(m.scrapedTitle)) return 'container-or-placeholder';
  if (m.director && m.director.trim().length > 0) return 'localized-title-miss';
  return 'unfixable';
}

interface CauseTemplate {
  signature: string;
  labels: string[];
  title: (n: number) => string;
  intro: string;
  fix: string;
}

const TEMPLATES: Record<Exclude<MissCauseKey, 'unfixable'>, CauseTemplate> = {
  'container-or-placeholder': {
    signature: 'container-or-placeholder',
    labels: ['matcher-pattern', 'ready-for-agent'],
    title: (n) => `matcher: ${n} container/placeholder titles not classified to skipTmdb`,
    intro:
      'These scraped titles look like programme containers or placeholders ' +
      '(festival, cycle, shorts block, "surprise film"), not single films, but ' +
      'the deterministic classifier `isNonFilmContainer` (`src/tmdb/container.ts`) ' +
      'does not catch them. They re-enter enrichment every scrape and never match.',
    fix: 'Extend `CONTAINER_PATTERNS` in `src/tmdb/container.ts` to cover these shapes, then re-run `npm run db:classify-containers`.',
  },
  'localized-title-miss': {
    signature: 'localized-title-miss',
    labels: ['matcher-pattern', 'ready-for-human'],
    title: (n) => `matcher: ${n} films with a known director return no TMDB candidate`,
    intro:
      'These films have a scraped director, so they are real, but a TMDB search ' +
      'by the Spanish title returns zero candidates — the localized title diverges ' +
      'from what TMDB carries and the director axis did not rescue the match.',
    fix: 'Investigate the director-axis search in `src/tmdb/match.ts` / `searchByDirector` (`src/tmdb/client.ts`); consider a title-alias or a director-first search for these.',
  },
};

function filmList(films: Miss[]): string {
  return films
    .map((f) => {
      const yr = f.scrapedYear ? ` (${f.scrapedYear})` : '';
      const dir = f.director ? ` — dir. ${f.director}` : '';
      return `- ${f.id} — ${f.scrapedTitle}${yr}${dir}`;
    })
    .join('\n');
}

/**
 * Group misses into fixable-in-code patterns. Only causes that explain
 * >= PATTERN_MIN_FILMS films are returned; `unfixable` is always dropped.
 * The returned order is stable (container patterns first).
 */
export function groupMisses(misses: Miss[]): PatternGroup[] {
  const byCause = new Map<MissCauseKey, Miss[]>();
  for (const m of misses) {
    const cause = classifyMiss(m);
    const arr = byCause.get(cause) ?? [];
    arr.push(m);
    byCause.set(cause, arr);
  }

  const groups: PatternGroup[] = [];
  for (const cause of ['container-or-placeholder', 'localized-title-miss'] as const) {
    const films = byCause.get(cause) ?? [];
    if (films.length < PATTERN_MIN_FILMS) continue;
    const t = TEMPLATES[cause];
    const body =
      `<!-- afiche-pattern-sig: ${t.signature} -->\n\n` +
      `**Pattern:** ${t.intro}\n\n` +
      `**Suspected fix:** ${t.fix}\n\n` +
      `**Example films (id — title):**\n${filmList(films)}\n\n` +
      `**Reproduce:** these show as no-candidate / declined in \`npm run db:self-heal:prod\`.\n\n` +
      `_Auto-filed by self-heal Layer 2. Dedup key: \`${t.signature}\`._`;
    groups.push({
      cause,
      signature: t.signature,
      title: t.title(films.length),
      body,
      labels: t.labels,
      films,
    });
  }
  return groups;
}
