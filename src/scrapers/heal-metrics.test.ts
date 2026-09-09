import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeInMemoryDb, type TestDb } from '../../test/helpers/in-memory-db';
import { healRuns } from '@/db/schema';

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

const { recordHealRun, healTrend } = await import('./heal-metrics');

beforeEach(async () => {
  testDb = await makeInMemoryDb();
});

describe('heal metrics', () => {
  it('records a run and reads it back in the trend', async () => {
    await recordHealRun({
      stuck: 20,
      applied: 2,
      queued: 5,
      noCandidate: 13,
      declined: 0,
      errored: 0,
      issuesOpened: 1,
      alerts: 0,
    });
    const t = await healTrend(new Date());
    expect(t.runs).toBe(1);
    expect(t.applied).toBe(2);
    expect(t.issuesOpened).toBe(1);
  });

  it('sums the trailing window and excludes older runs', async () => {
    const now = new Date('2026-09-08T12:00:00Z');
    // Two recent runs.
    await testDb.insert(healRuns).values([
      { ranAt: new Date('2026-09-08T09:00:00Z'), applied: 1, queued: 2 },
      { ranAt: new Date('2026-09-05T09:00:00Z'), applied: 3, queued: 1 },
      // Older than 7 days — excluded.
      { ranAt: new Date('2026-08-20T09:00:00Z'), applied: 9, queued: 9 },
    ]);
    const t = await healTrend(now, 7);
    expect(t.runs).toBe(2);
    expect(t.applied).toBe(4);
    expect(t.queued).toBe(3);
  });
});
