/**
 * Manual overrides — maps (scraped_title, year?) to a TMDB ID.
 *
 * When fuzzy match fails (rare BA indies, Argentine films with different
 * titles on TMDB, restored prints with non-standard titling), add an
 * entry to tmdb-overrides.json at the project root. The ingest pipeline
 * checks overrides FIRST before hitting the search API.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

interface OverrideEntry {
  scrapedTitle: string;
  year?: number;
  tmdbId: number;
  note?: string;
}

interface OverridesFile {
  overrides: OverrideEntry[];
}

let cache: Map<string, number> | null = null;

export async function findOverride(
  scrapedTitle: string,
  year: number | undefined,
): Promise<number | null> {
  if (!cache) {
    cache = await loadOverrides();
  }
  const key = makeKey(scrapedTitle, year);
  const idFull = cache.get(key);
  if (idFull !== undefined) return idFull;
  // Fall back: key without year (in case the scrape has no year)
  const keyNoYear = makeKey(scrapedTitle, undefined);
  const idNoYear = cache.get(keyNoYear);
  return idNoYear ?? null;
}

async function loadOverrides(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    // Project root is two levels up from src/tmdb/
    const here = dirname(fileURLToPath(import.meta.url));
    const path = resolve(here, '..', '..', 'tmdb-overrides.json');
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as OverridesFile;
    for (const entry of parsed.overrides ?? []) {
      if (entry.scrapedTitle && entry.tmdbId) {
        map.set(makeKey(entry.scrapedTitle, entry.year), entry.tmdbId);
      }
    }
  } catch {
    // File missing or malformed → empty overrides, not a fatal error.
  }
  return map;
}

function makeKey(title: string, year: number | undefined): string {
  return `${title.toLowerCase().trim()}::${year ?? 'any'}`;
}

/** Reset the cache — useful in tests. */
export function _resetOverridesCache(): void {
  cache = null;
}
