/**
 * Lumiton (the flagship venue) provider. Thin wrapper around the shared
 * Lumiton agenda parser — see lumiton-agenda.ts.
 *
 * Lumiton is the cinema/studio museum's own screen in Vicente López,
 * separate from Cine York (their Olivos venue) and Centro Cultural
 * Munro (their Munro venue). All three share the same agenda page.
 */

import { fetchAndParse } from './lumiton-agenda';
import type { Provider, ProviderRunResult } from './types';

const CONFIG = {
  cinemaId: 'lumiton',
  displayName: 'Lumiton',
  locationSlug: 'lumiton',
} as const;

export const lumitonProvider: Provider = {
  id: CONFIG.cinemaId,
  name: CONFIG.displayName,
  fetch(): Promise<ProviderRunResult> {
    return fetchAndParse(CONFIG);
  },
};
