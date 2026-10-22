/**
 * Post-scrape audit — the deterministic Phase 1 of the self-healing loop.
 *
 * Reads recent scrape_runs and the film catalog and produces a JSON brief:
 *   - hard-signal alerts (a provider failed, a run is stuck in-progress, or the
 *     ingest circuit breaker fired), and
 *   - the active-stuck film pool the agent should try to enrich.
 *
 * Writes nothing. The agent (Actor 1) consumes the brief; the harness applies.
 */

import { and, eq, gt, gte, isNull, lt, sql } from 'drizzle-orm';
import { db, films, screenings, cinemas, scrapeRuns } from '@/db';
import type { ScrapeRun } from '@/db';

/** A run in-progress longer than this is treated as stuck (crashed mid-run). */
export const STUCK_IN_PROGRESS_MINUTES = 30;

export type AlertKind = 'failure' | 'stuck-in-progress' | 'circuit-breaker';

export interface AuditAlert {
  cinemaId: string;
  kind: AlertKind;
  detail: string;
  runId: number | null;
}

export interface StuckFilm {
  id: number;
  scrapedTitle: string;
  scrapedYear: number | null;
  year: number | null;
  director: string | null;
  titleOriginal: string | null;
  venues: string[];
  /**
   * Venue-scraped plot summary, when the provider captures one (Cacodelphia's
   * adro.studio API does; most HTML/OCR scrapers don't). The single strongest
   * disambiguation signal available: it corroborates or contradicts a
   * candidate's TMDB overview independent of title/director/year, which is
   * exactly the axis a same-title collision (multiple TMDB entries sharing a
   * localized title) has nothing else to lean on. See judge.ts's prompt.
   */
  synopsisEs: string | null;
  /** Venue-scraped runtime in minutes, same availability caveat as above. */
  runtimeMin: number | null;
}

export interface AuditBrief {
  generatedAt: string;
  runsConsidered: number;
  alerts: AuditAlert[];
  stuckFilms: StuckFilm[];
}

interface AuditOptions {
  /** Freeze point; defaults to now. Injectable for tests. */
  now?: Date;
  /** Look back this far for runs to audit. Default 24h. */
  sinceHours?: number;
}

/**
 * The latest run per cinema within the window. scrape_runs has one row per
 * provider per invocation with no batch id (Decision #8), so "the just-finished
 * run" is approximated as the most recent run per cinema in the window.
 */
function latestRunPerCinema(runs: ScrapeRun[]): ScrapeRun[] {
  const byCinema = new Map<string, ScrapeRun>();
  for (const r of runs) {
    const prev = byCinema.get(r.cinemaId);
    if (!prev || r.startedAt > prev.startedAt) byCinema.set(r.cinemaId, r);
  }
  return [...byCinema.values()];
}

export function detectAlerts(runs: ScrapeRun[], now: Date): AuditAlert[] {
  const stuckBefore = new Date(now.getTime() - STUCK_IN_PROGRESS_MINUTES * 60_000);
  const alerts: AuditAlert[] = [];
  for (const r of latestRunPerCinema(runs)) {
    if (r.status === 'failure') {
      alerts.push({
        cinemaId: r.cinemaId,
        kind: 'failure',
        detail: r.error ?? 'provider run failed',
        runId: r.id,
      });
    } else if (r.status === 'in-progress' && r.startedAt < stuckBefore) {
      alerts.push({
        cinemaId: r.cinemaId,
        kind: 'stuck-in-progress',
        detail: `run started ${r.startedAt.toISOString()} never finished`,
        runId: r.id,
      });
    }
    for (const w of r.warnings ?? []) {
      if (w.toLowerCase().includes('circuit breaker')) {
        alerts.push({
          cinemaId: r.cinemaId,
          kind: 'circuit-breaker',
          detail: w,
          runId: r.id,
        });
      }
    }
  }
  return alerts;
}

/**
 * The active-stuck pool: films with no TMDB match, at least one future
 * screening, and NOT excluded from enrichment. The canonical predicate
 * excludes skip_tmdb AND hidden_at (Decision #5) — real enrichment excludes
 * both, so judging a hidden/non-film row would be wasted work.
 */
export async function activeStuckFilms(now: Date): Promise<StuckFilm[]> {
  const rows = await db
    .select({
      id: films.id,
      scrapedTitle: films.scrapedTitle,
      scrapedYear: films.scrapedYear,
      year: films.year,
      director: films.director,
      titleOriginal: films.titleOriginal,
      synopsisEs: films.synopsisEs,
      runtimeMin: films.runtimeMin,
      venues: sql<string | null>`group_concat(distinct ${cinemas.name})`,
    })
    .from(films)
    .innerJoin(screenings, eq(screenings.filmId, films.id))
    .innerJoin(cinemas, eq(cinemas.id, screenings.cinemaId))
    .where(
      and(
        isNull(films.tmdbId),
        eq(films.skipTmdb, false),
        isNull(films.hiddenAt),
        gt(screenings.startsAtUtc, now),
      ),
    )
    .groupBy(films.id)
    .orderBy(films.scrapedTitle);

  return rows.map((r) => ({
    id: r.id,
    scrapedTitle: r.scrapedTitle,
    scrapedYear: r.scrapedYear,
    year: r.year,
    director: r.director,
    titleOriginal: r.titleOriginal,
    synopsisEs: r.synopsisEs,
    runtimeMin: r.runtimeMin,
    venues: r.venues ? r.venues.split(',') : [],
  }));
}

export async function computeAuditBrief(opts: AuditOptions = {}): Promise<AuditBrief> {
  const now = opts.now ?? new Date();
  const sinceHours = opts.sinceHours ?? 24;
  const cutoff = new Date(now.getTime() - sinceHours * 3_600_000);

  const runs = await db
    .select()
    .from(scrapeRuns)
    .where(and(gte(scrapeRuns.startedAt, cutoff), lt(scrapeRuns.startedAt, now)));

  return {
    generatedAt: now.toISOString(),
    runsConsidered: runs.length,
    alerts: detectAlerts(runs, now),
    stuckFilms: await activeStuckFilms(now),
  };
}
