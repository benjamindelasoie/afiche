// Post-scrape audit — anomaly detection + the canonical active-stuck predicate.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeInMemoryDb, type TestDb } from '../../test/helpers/in-memory-db';
import { cinemas, films, screenings, scrapeRuns } from '@/db/schema';
import type { ScrapeRun } from '@/db';

let testDb: TestDb;

vi.mock('@/db', async () => {
  const schema = await vi.importActual<typeof import('@/db/schema')>('@/db/schema');
  return {
    ...schema,
    get db() {
      return testDb;
    },
  };
});

const { detectAlerts, activeStuckFilms, computeAuditBrief, STUCK_IN_PROGRESS_MINUTES } =
  await import('./audit');

const NOW = new Date('2026-09-01T12:00:00Z');

function run(over: Partial<ScrapeRun>): ScrapeRun {
  return {
    id: 1,
    cinemaId: 'malba',
    startedAt: NOW,
    finishedAt: NOW,
    status: 'success',
    durationMs: 100,
    screeningsScraped: 10,
    screeningsInserted: 10,
    filmsUpserted: 5,
    filmsEnriched: 5,
    enrichSkipped: 0,
    error: null,
    warnings: [],
    ...over,
  };
}

describe('detectAlerts', () => {
  it('alerts on a failed run', () => {
    const alerts = detectAlerts([run({ status: 'failure', error: 'boom' })], NOW);
    expect(alerts).toEqual([
      { cinemaId: 'malba', kind: 'failure', detail: 'boom', runId: 1 },
    ]);
  });

  it('alerts on a run stuck in-progress past the threshold', () => {
    const stale = new Date(NOW.getTime() - (STUCK_IN_PROGRESS_MINUTES + 5) * 60_000);
    const alerts = detectAlerts([run({ status: 'in-progress', startedAt: stale })], NOW);
    expect(alerts.map((a) => a.kind)).toEqual(['stuck-in-progress']);
  });

  it('does NOT alert on a run that is in-progress but recent', () => {
    const recent = new Date(NOW.getTime() - 60_000);
    const alerts = detectAlerts([run({ status: 'in-progress', startedAt: recent })], NOW);
    expect(alerts).toEqual([]);
  });

  it('alerts on a circuit-breaker warning', () => {
    const alerts = detectAlerts(
      [run({ warnings: ['circuit breaker: "cine-york" returned 0 screenings ...'] })],
      NOW,
    );
    expect(alerts.map((a) => a.kind)).toEqual(['circuit-breaker']);
  });

  it('considers only the latest run per cinema', () => {
    const older = run({ id: 1, cinemaId: 'malba', startedAt: new Date('2026-09-01T09:00:00Z'), status: 'failure', error: 'old' });
    const newer = run({ id: 2, cinemaId: 'malba', startedAt: new Date('2026-09-01T11:00:00Z'), status: 'success' });
    expect(detectAlerts([older, newer], NOW)).toEqual([]);
  });
});

describe('activeStuckFilms — canonical predicate', () => {
  beforeEach(async () => {
    testDb = await makeInMemoryDb();
    await testDb.insert(cinemas).values({ id: 'malba', name: 'MALBA', type: 'indie' });
  });

  async function addFilm(over: Record<string, unknown>): Promise<number> {
    const [f] = await testDb
      .insert(films)
      .values({ title: 't', scrapedTitle: 't', ...over })
      .returning({ id: films.id });
    return f.id;
  }

  async function addFutureScreening(filmId: number): Promise<void> {
    await testDb.insert(screenings).values({
      filmId,
      cinemaId: 'malba',
      startsAtUtc: new Date(NOW.getTime() + 48 * 3_600_000),
      tags: [],
      sourceUrl: 'https://x',
    });
  }

  it('includes an unmatched film with a future screening', async () => {
    const id = await addFilm({ scrapedTitle: 'Stuck One', tmdbId: null });
    await addFutureScreening(id);
    const stuck = await activeStuckFilms(NOW);
    expect(stuck.map((s) => s.id)).toEqual([id]);
    expect(stuck[0].venues).toEqual(['MALBA']);
  });

  it('excludes a matched film', async () => {
    const id = await addFilm({ scrapedTitle: 'Matched', tmdbId: 42 });
    await addFutureScreening(id);
    expect(await activeStuckFilms(NOW)).toEqual([]);
  });

  it('excludes skip_tmdb and hidden films (Decision #5)', async () => {
    const skipped = await addFilm({ scrapedTitle: 'Skip', tmdbId: null, skipTmdb: true });
    await addFutureScreening(skipped);
    const hidden = await addFilm({ scrapedTitle: 'Hidden', tmdbId: null, hiddenAt: NOW });
    await addFutureScreening(hidden);
    expect(await activeStuckFilms(NOW)).toEqual([]);
  });

  it('excludes a film whose only screenings are in the past', async () => {
    const id = await addFilm({ scrapedTitle: 'Past', tmdbId: null });
    await testDb.insert(screenings).values({
      filmId: id,
      cinemaId: 'malba',
      startsAtUtc: new Date(NOW.getTime() - 3_600_000),
      tags: [],
      sourceUrl: 'https://x',
    });
    expect(await activeStuckFilms(NOW)).toEqual([]);
  });
});

describe('computeAuditBrief', () => {
  beforeEach(async () => {
    testDb = await makeInMemoryDb();
    await testDb.insert(cinemas).values({ id: 'malba', name: 'MALBA', type: 'indie' });
  });

  it('assembles runs, alerts, and stuck films', async () => {
    await testDb.insert(scrapeRuns).values({
      cinemaId: 'malba',
      startedAt: new Date(NOW.getTime() - 3_600_000),
      status: 'failure',
      error: 'boom',
      warnings: [],
    });
    const brief = await computeAuditBrief({ now: NOW });
    expect(brief.runsConsidered).toBe(1);
    expect(brief.alerts.map((a) => a.kind)).toEqual(['failure']);
    expect(brief.stuckFilms).toEqual([]);
  });
});
