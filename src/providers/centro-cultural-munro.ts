/**
 * Centro Cultural Munro provider. Thin wrapper around the shared
 * Lumiton agenda parser — see lumiton-agenda.ts.
 *
 * Centro Cultural Munro is Lumiton's sister screen in Munro (north
 * of CABA, partido de Vicente López).
 */

import { fetchAndParse } from './lumiton-agenda';
import type { Provider, ProviderRunResult } from './types';

const CONFIG = {
  cinemaId: 'centro-cultural-munro',
  displayName: 'Centro Cultural Munro',
  locationSlug: 'centro-cultural-munro',
} as const;

export const centroCulturalMunroProvider: Provider = {
  id: CONFIG.cinemaId,
  name: CONFIG.displayName,
  fetch(): Promise<ProviderRunResult> {
    return fetchAndParse(CONFIG);
  },
};
