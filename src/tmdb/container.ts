/**
 * Container detector — is a scraped title a programme/competition CONTAINER
 * rather than a single film? Those (shorts blocks, "PROGRAMA I", competition
 * selections) have no TMDB entry, so they should be marked skip_tmdb and stop
 * re-queuing forever, not judged every run.
 *
 * Runs on the prefix/suffix-stripped title so "CONVOCATORIA DE CORTOS:
 * PROGRAMA I" reduces to "PROGRAMA I" (a container) while "FESTIVAL ESCENARIO:
 * WE ARE THE SHAGS" reduces to a real film and is NOT flagged.
 *
 * Deliberately conservative: marking skip_tmdb only stops enrichment (the film
 * still shows with its scraped title), and the classify script is dry-run by
 * default, so a false positive is low-harm and reviewable.
 */

import { stripSearchNoise } from './similarity';

const CONTAINER_PATTERNS: RegExp[] = [
  // "PROGRAMA I".."X", "PROGRAMA 1", "PROGRAMA DOBLE" — but NOT a film titled
  // "El Programa": the numeral/DOBLE token is required.
  /\bPROGRAMA\s+(?:\d+|I{1,3}|IV|VI{0,3}|IX|XI{0,3}|X|DOBLE)\b/i,
  /\bCORTOMETRAJES?\b/i,
  /\bCORTOS\b/i,
  /\bCOMPETENCIA\b/i,
  /\bCONVOCATORIA\b/i,
  /\bPROYECCIONES\s+DE\s+CORTOS\b/i,
  /\bMUESTRA\s+DE\b/i,
];

export function isNonFilmContainer(title: string): boolean {
  const stripped = stripSearchNoise(title);
  return CONTAINER_PATTERNS.some((re) => re.test(stripped));
}
