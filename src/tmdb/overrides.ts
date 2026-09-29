/**
 * Overrides — maps (scraped_title, year?) to a TMDB ID, checked before search.
 *
 * Two layers, unioned: the git-committed tmdb-overrides.json (human seed) and
 * the tmdb_overrides DB table (machine-written by the self-healing agent). The
 * JSON file wins on conflict, so a hand correction always beats a machine one.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { db, tmdbOverrides } from '@/db';
import { normalizeTitle } from './similarity';

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

/**
 * Insert or update a machine override, keyed on (scraped_title, year), then
 * invalidate the cache. A null year is the year-agnostic slot.
 */
export async function upsertOverride(entry: {
  scrapedTitle: string;
  year?: number | null;
  tmdbId: number;
  note?: string | null;
  source?: string;
  confidence?: number | null;
}): Promise<void> {
  const year = entry.year ?? null;
  const row = {
    scrapedTitle: entry.scrapedTitle,
    year,
    tmdbId: entry.tmdbId,
    note: entry.note ?? null,
    source: entry.source ?? 'manual',
    confidence: entry.confidence ?? null,
  };
  // SQLite treats NULLs as distinct in a unique index, so onConflictDoUpdate
  // won't fire for the null-year slot. Check-then-write keeps both slots idempotent.
  const existing = await db
    .select({ id: tmdbOverrides.id })
    .from(tmdbOverrides)
    .where(
      and(
        eq(tmdbOverrides.scrapedTitle, entry.scrapedTitle),
        year === null ? isNull(tmdbOverrides.year) : eq(tmdbOverrides.year, year),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(tmdbOverrides)
      .set({
        tmdbId: row.tmdbId,
        note: row.note,
        source: row.source,
        confidence: row.confidence,
      })
      .where(eq(tmdbOverrides.id, existing[0].id));
  } else {
    await db.insert(tmdbOverrides).values(row);
  }
  cache = null;
}

async function loadOverrides(): Promise<Map<string, number>> {
  const map = new Map<string, number>();

  // DB table first, so the JSON seed can overlay and win on conflict.
  try {
    const rows = await db
      .select({
        scrapedTitle: tmdbOverrides.scrapedTitle,
        year: tmdbOverrides.year,
        tmdbId: tmdbOverrides.tmdbId,
      })
      .from(tmdbOverrides);
    for (const r of rows) {
      map.set(makeKey(r.scrapedTitle, r.year ?? undefined), r.tmdbId);
    }
  } catch {
    // Table missing or DB unavailable — fall back to the JSON seed alone.
  }

  // JSON seed, overlaid last → wins on conflict.
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = resolve(here, '..', '..', 'tmdb-overrides.json');
    const parsed = JSON.parse(await readFile(path, 'utf8')) as OverridesFile;
    for (const entry of parsed.overrides ?? []) {
      if (entry.scrapedTitle && entry.tmdbId) {
        map.set(makeKey(entry.scrapedTitle, entry.year), entry.tmdbId);
      }
    }
  } catch {
    // File missing or malformed → DB-only overrides.
  }

  return map;
}

/**
 * Was plain `title.toLowerCase().trim()` — accent-sensitive, so a seeded
 * override for "LA INVITACIÓN" silently missed a re-scrape of the same film
 * spelled "LA INVITACION" (no accent), which providers do inconsistently.
 * `normalizeTitle` is the exact equivalence `src/tmdb/match.ts`'s
 * deterministic matcher already uses (ADR-0002 calls for this override/
 * decision-key to use the same normalized match key; this had drifted from
 * that since the self-healing rewrite). One title, one key, everywhere.
 */
function makeKey(title: string, year: number | undefined): string {
  return `${normalizeTitle(title)}::${year ?? 'any'}`;
}

/** Reset the cache — useful in tests. */
export function _resetOverridesCache(): void {
  cache = null;
}
