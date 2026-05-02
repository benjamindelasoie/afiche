/**
 * Provider health row management.
 *
 * The `providers` table is "latest state" observability: one row per cinema,
 * holding lastRunAt / lastSuccessAt / lastError / screeningCount. Two phases
 * per ingest:
 *
 *   1. `recordProviderRun` — always runs first, even when the scrape failed.
 *      Stamps lastRunAt + lastError so the dashboard reflects "we tried."
 *   2. `markProviderSuccess` — runs at the end of a successful ingest. Stamps
 *      lastSuccessAt + screeningCount + clears lastError.
 *
 * The two-phase shape exists because we want a failed scrape's error message
 * recorded immediately (in case a later step throws), but the success-side
 * counters only become accurate after screenings + enrichment finish.
 */

import { eq } from 'drizzle-orm';
import { db, providers } from '@/db';

/**
 * Phase 1: record that the provider ran. Always called, even on failure.
 * On failure, `error` is written to `lastError` so the row reflects the
 * cause without depending on log scraping.
 */
export async function recordProviderRun(
  cinemaId: string,
  runAt: Date,
  success: boolean,
  error: string | undefined,
): Promise<void> {
  await db
    .insert(providers)
    .values({
      id: cinemaId,
      lastRunAt: runAt,
      lastError: success ? null : (error ?? 'unknown error'),
    })
    .onConflictDoUpdate({
      target: providers.id,
      set: {
        lastRunAt: runAt,
        lastError: success ? null : (error ?? 'unknown error'),
      },
    });
}

/**
 * Phase 2: stamp success-side counters after screenings + enrichment finish
 * cleanly. Sets lastSuccessAt = runAt, screeningCount = inserted, and
 * clears lastError (in case a previous run left one behind).
 */
export async function markProviderSuccess(
  cinemaId: string,
  runAt: Date,
  screeningsInserted: number,
): Promise<void> {
  await db
    .update(providers)
    .set({
      lastSuccessAt: runAt,
      screeningCount: screeningsInserted,
      lastError: null,
    })
    .where(eq(providers.id, cinemaId));
}
