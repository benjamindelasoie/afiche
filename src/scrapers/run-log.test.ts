/**
 * Tests for src/scrapers/run-log.ts.
 *
 * Uses the same in-memory libSQL + real-migrations pattern as ingest.test.ts.
 * Each test starts with a fresh DB and a seeded cinema row so the foreign
 * key on scrape_runs.cinema_id is satisfiable.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq, desc } from 'drizzle-orm';
import { makeInMemoryDb, type TestDb } from '../../test/helpers/in-memory-db';
import { cinemas, scrapeRuns } from '@/db/schema';
import type { IngestSummary } from './ingest';

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

const { startRun, finishRun, failRun } = await import('./run-log');

async function seedCinema(): Promise<void> {
  await testDb.insert(cinemas).values({
    id: 'lugones',
    name: 'Sala Lugones',
    type: 'indie',
  });
}

async function getRun(id: number) {
  const [row] = await testDb.select().from(scrapeRuns).where(eq(scrapeRuns.id, id));
  return row;
}

function makeSummary(overrides?: Partial<IngestSummary>): IngestSummary {
  return {
    cinemaId: 'lugones',
    success: true,
    screeningsScraped: 40,
    screeningsInserted: 38,
    filmsUpserted: 12,
    filmsEnriched: 5,
    filmsMerged: 0,
    enrichSkipped: 7,
    warnings: [],
    ...overrides,
  };
}

describe('run-log', () => {
  beforeEach(async () => {
    testDb = await makeInMemoryDb();
    await seedCinema();
  });

  describe('startRun', () => {
    it('inserts a row with status=in-progress and started_at set', async () => {
      // SQLite timestamps round to whole seconds, so widen the window by 1s
      // on each side to absorb the precision loss in the round-trip.
      const before = Date.now() - 1000;
      const id = await startRun('lugones');
      const after = Date.now() + 1000;

      expect(id).not.toBeNull();
      const row = await getRun(id!);
      expect(row).toBeDefined();
      expect(row.status).toBe('in-progress');
      expect(row.cinemaId).toBe('lugones');
      expect(row.startedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(row.startedAt.getTime()).toBeLessThanOrEqual(after);
      expect(row.finishedAt).toBeNull();
      expect(row.durationMs).toBeNull();
    });

    it('returns null on failure (e.g. missing cinema) without throwing', async () => {
      const id = await startRun('nonexistent-cinema');
      expect(id).toBeNull();
    });

    it('allocates distinct ids across successive calls', async () => {
      const a = await startRun('lugones');
      const b = await startRun('lugones');
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(a).not.toBe(b);
    });
  });

  describe('finishRun', () => {
    it('updates the row to status=success with aggregate counts', async () => {
      const id = await startRun('lugones');
      const summary = makeSummary({
        warnings: ['TMDB error for "Foo" (1950): 503'],
      });

      await finishRun(id, summary, 1234);

      const row = await getRun(id!);
      expect(row.status).toBe('success');
      expect(row.finishedAt).not.toBeNull();
      expect(row.durationMs).toBe(1234);
      expect(row.screeningsScraped).toBe(40);
      expect(row.screeningsInserted).toBe(38);
      expect(row.filmsUpserted).toBe(12);
      expect(row.filmsEnriched).toBe(5);
      expect(row.enrichSkipped).toBe(7);
      expect(row.warnings).toEqual(['TMDB error for "Foo" (1950): 503']);
    });

    it('marks status=failure when the summary reports unsuccessful', async () => {
      const id = await startRun('lugones');
      const summary = makeSummary({ success: false });

      await finishRun(id, summary, 500);

      const row = await getRun(id!);
      expect(row.status).toBe('failure');
    });

    it('is a no-op when runId is null (startRun failed earlier)', async () => {
      // No row to update. Should not throw.
      await expect(finishRun(null, makeSummary(), 100)).resolves.toBeUndefined();
    });

    it('does not throw when the run row does not exist (e.g. deleted)', async () => {
      await expect(finishRun(99999, makeSummary(), 100)).resolves.toBeUndefined();
    });
  });

  describe('failRun', () => {
    it('updates the row to status=failure with the error text', async () => {
      const id = await startRun('lugones');

      await failRun(id, 'TypeError: Cannot read property', 250);

      const row = await getRun(id!);
      expect(row.status).toBe('failure');
      expect(row.error).toBe('TypeError: Cannot read property');
      expect(row.durationMs).toBe(250);
      expect(row.finishedAt).not.toBeNull();
      // Counts stay null — the uncaught error happened before we had counts.
      expect(row.screeningsScraped).toBeNull();
    });

    it('is a no-op when runId is null', async () => {
      await expect(failRun(null, 'err', 100)).resolves.toBeUndefined();
    });
  });

  describe('observability — queryable history', () => {
    it('preserves history across multiple runs, sortable by started_at', async () => {
      const first = await startRun('lugones');
      await finishRun(first, makeSummary({ screeningsInserted: 10 }), 100);
      // Tiny wait to ensure started_at ordering is stable.
      await new Promise((r) => setTimeout(r, 5));
      const second = await startRun('lugones');
      await finishRun(second, makeSummary({ screeningsInserted: 20 }), 200);

      const rows = await testDb
        .select()
        .from(scrapeRuns)
        .orderBy(desc(scrapeRuns.startedAt));

      expect(rows).toHaveLength(2);
      expect(rows[0].screeningsInserted).toBe(20); // most recent
      expect(rows[1].screeningsInserted).toBe(10);
    });
  });
});
