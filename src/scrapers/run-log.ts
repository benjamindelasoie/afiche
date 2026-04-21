/**
 * Scrape-run log — persistent history of every scraper invocation.
 *
 * Why it exists: local `npm run db:scrape` prints to stdout, which works fine
 * in your terminal. In production (Vercel cron), stdout is ephemeral and
 * truncated — you can't grep it after the fact to find which films missed,
 * which provider silently started returning empty, or how miss rates trend
 * over time. This module writes one row per run into the `scrape_runs` table,
 * so all of that is durable and query-able.
 *
 * Lifecycle:
 *
 *      startRun(cinemaId) ─────► INSERT (status='in-progress', started_at=now)
 *             │                          returns run_id
 *             │
 *     scraper does its thing
 *             │
 *             ├── success ─────► finishRun(run_id, summary, durationMs)
 *             │                    UPDATE status='success', counts, warnings[]
 *             │
 *             └── uncaught ────► failRun(run_id, errorText, durationMs)
 *                 throw           UPDATE status='failure', error
 *
 * If the process crashes between startRun and finish/fail, the row stays
 * at status='in-progress' — that's a useful "the scraper died silently"
 * signal when querying history.
 *
 * All writes are best-effort from the caller's perspective: the scraper's
 * actual work matters more than logging it. Failures here do NOT throw
 * (they log to stderr and swallow), so a broken log table never takes
 * down a scraping run.
 */

import { eq } from 'drizzle-orm';
import { db, scrapeRuns } from '@/db';
import type { IngestSummary } from './ingest';

/**
 * Start a new scrape-run row. Returns the row id so the caller can later
 * attach completion state via finishRun / failRun.
 */
export async function startRun(cinemaId: string): Promise<number | null> {
  try {
    const [row] = await db
      .insert(scrapeRuns)
      .values({
        cinemaId,
        startedAt: new Date(),
        status: 'in-progress',
      })
      .returning({ id: scrapeRuns.id });
    return row?.id ?? null;
  } catch (err) {
    console.error(
      `[run-log] failed to start run for ${cinemaId}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Mark a run as finished with the aggregate counts from ingest.
 * Status is 'success' if the provider's fetch succeeded, 'failure' if not —
 * we take this from the IngestSummary rather than re-deriving so it matches
 * what the existing `providers` health row records.
 */
export async function finishRun(
  runId: number | null,
  summary: IngestSummary,
  durationMs: number,
): Promise<void> {
  if (runId === null) return; // startRun failed silently; nothing to update
  try {
    await db
      .update(scrapeRuns)
      .set({
        finishedAt: new Date(),
        status: summary.success ? 'success' : 'failure',
        durationMs,
        screeningsScraped: summary.screeningsScraped,
        screeningsInserted: summary.screeningsInserted,
        filmsUpserted: summary.filmsUpserted,
        filmsEnriched: summary.filmsEnriched,
        enrichSkipped: summary.enrichSkipped,
        warnings: summary.warnings,
      })
      .where(eq(scrapeRuns.id, runId));
  } catch (err) {
    console.error(
      `[run-log] failed to finish run ${runId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Mark a run as failed with an uncaught error. Use this from the outer
 * try/catch in run.ts — NOT for provider-reported failures (those go via
 * finishRun with summary.success=false, carrying the counts that the
 * provider did manage to produce before failing).
 */
export async function failRun(
  runId: number | null,
  error: string,
  durationMs: number,
): Promise<void> {
  if (runId === null) return;
  try {
    await db
      .update(scrapeRuns)
      .set({
        finishedAt: new Date(),
        status: 'failure',
        durationMs,
        error,
      })
      .where(eq(scrapeRuns.id, runId));
  } catch (err) {
    console.error(
      `[run-log] failed to fail run ${runId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
