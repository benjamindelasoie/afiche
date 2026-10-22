/**
 * Heal-run metrics — persist one row per self-heal write so the loop is
 * observable: the tail should shrink over time, and a spike in errored/queued
 * or a stall in applied is visible in a trend instead of scrolling a log.
 */

import { and, gte, lt, sql } from 'drizzle-orm';
import { db, healRuns } from '@/db';
import type { HealRunInsert } from '@/db';

export type HealRunCounts = Omit<HealRunInsert, 'id' | 'ranAt'>;

export async function recordHealRun(counts: HealRunCounts): Promise<void> {
  await db.insert(healRuns).values(counts);
}

export interface HealTrend {
  runs: number;
  applied: number;
  queued: number;
  issuesOpened: number;
  errored: number;
}

/** Totals over the trailing window (inclusive of any run already recorded). */
export async function healTrend(now: Date, days = 7): Promise<HealTrend> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const [agg] = await db
    .select({
      runs: sql<number>`count(*)`,
      applied: sql<number>`coalesce(sum(${healRuns.applied}), 0)`,
      queued: sql<number>`coalesce(sum(${healRuns.queued}), 0)`,
      issuesOpened: sql<number>`coalesce(sum(${healRuns.issuesOpened}), 0)`,
      errored: sql<number>`coalesce(sum(${healRuns.errored}), 0)`,
    })
    .from(healRuns)
    .where(
      and(gte(healRuns.ranAt, since), lt(healRuns.ranAt, new Date(now.getTime() + 1000))),
    );
  return {
    runs: Number(agg.runs),
    applied: Number(agg.applied),
    queued: Number(agg.queued),
    issuesOpened: Number(agg.issuesOpened),
    errored: Number(agg.errored),
  };
}
