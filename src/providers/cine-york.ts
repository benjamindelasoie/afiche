/**
 * Cine York provider. Thin wrapper around the shared Lumiton agenda
 * parser — see lumiton-agenda.ts for the full parsing logic.
 *
 * Cine York is Lumiton's rep cinema in Olivos.
 */

import { fetchAndParse, parseAgenda as parseLumitonAgenda } from './lumiton-agenda';
import type { Provider, ProviderRunResult, ScrapedScreening } from './types';

const CONFIG = {
  cinemaId: 'cine-york',
  displayName: 'Cine York',
  locationSlug: 'cine-york',
} as const;

export const cineYorkProvider: Provider = {
  id: CONFIG.cinemaId,
  name: CONFIG.displayName,
  fetch(): Promise<ProviderRunResult> {
    return fetchAndParse(CONFIG);
  },
};

// Re-export for tests that were written against the old parseAgenda
// export. New tests should prefer importing parseAgenda from
// ./lumiton-agenda directly.
export function parseAgenda(html: string, warnings: string[]): ScrapedScreening[] {
  return parseLumitonAgenda(html, CONFIG, warnings);
}
