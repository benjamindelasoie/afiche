/**
 * Manual + machine overrides — maps (scraped_title, year?) to a TMDB ID.
 *
 * Two layers, unioned:
 *   1. tmdb-overrides.json (project root) — the HUMAN-curated seed. Committed
 *      to git, reviewable in a diff. Add an entry here for a hand-verified
 *      match. This layer WINS on key conflict — a human correction always
 *      beats a machine one.
 *   2. the `tmdb_overrides` DB table — the MACHINE-written layer. The
 *      self-healing agent (Actor 1) inserts here via `upsertOverride` so an
 *      auto-applied match survives a rescrape (`reset-programming` preserves
 *      the table). See the self-healing design doc.
 *
 * The ingest pipeline checks overrides FIRST, before hitting the search API.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { db, tmdbOverrides } from '@/db';

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
 * Insert or update a machine override in the `tmdb_overrides` table, then
 * invalidate the in-process cache so the next `findOverride` sees it.
 *
 * Keyed on (scraped_title, year) — matching the same (title, year?) pair
 * `findOverride` looks up. A null `year` is the year-agnostic slot.
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
  // SQLite treats NULLs as distinct in a unique index, so onConflict on
  // (scraped_title, year) won't fire for the year-agnostic (NULL) slot.
  // Do an explicit update-then-insert against the same key to stay
  // idempotent for both the year-specific and the year-agnostic case.
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
      .set({ tmdbId: row.tmdbId, note: row.note, source: row.source, confidence: row.confidence })
      .where(eq(tmdbOverrides.id, existing[0].id));
  } else {
    await db.insert(tmdbOverrides).values(row);
  }
  cache = null;
}

async function loadOverrides(): Promise<Map<string, number>> {
  const map = new Map<string, number>();

  // Layer 2 (machine): the DB table. Loaded first so the JSON seed can
  // overlay and win on any key conflict.
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
    // Table missing (pre-migration) or DB unavailable → fall back to the
    // JSON seed alone. Never fatal: a broken override table must not stop
    // enrichment.
  }

  // Layer 1 (human): tmdb-overrides.json. Overlaid last → wins on conflict.
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
    // File missing or malformed → DB-only overrides, not a fatal error.
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
