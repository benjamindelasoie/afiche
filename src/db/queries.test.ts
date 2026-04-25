/**
 * Regression tests for the cartelera tier queries — specifically the
 * BA-midnight boundary that just bit us in prod (2026-04-24).
 *
 * Symptom: yesterday's screenings still appeared on the home page after
 * BA midnight rolled over. Root cause was route-level static caching
 * freezing `new Date()` in src/app/page.tsx (fixed there with
 * `export const dynamic = 'force-dynamic'`). The DB-layer filter was
 * already correct — these tests pin that contract so a future refactor
 * can't quietly reintroduce the bug from this side.
 *
 * Test strategy: in-memory libSQL with real Drizzle migrations (same
 * pattern as src/scrapers/ingest.test.ts) so the SQL filter runs for
 * real, not mocked.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { makeInMemoryDb, type TestDb } from '../../test/helpers/in-memory-db';
import { films, cinemas, screenings } from '@/db/schema';

// ---------------------------------------------------------------------------
// Mocks — replace @/db before the subject imports it.
// ---------------------------------------------------------------------------
let testDb: TestDb;

import { vi } from 'vitest';
vi.mock('@/db', async () => {
  const schema = await vi.importActual<typeof import('@/db/schema')>('@/db/schema');
  return {
    ...schema,
    get db() {
      return testDb;
    },
  };
});

// Import AFTER mocks so queries.ts picks up the in-memory db.
const { getThisWeekScreenings } = await import('./queries');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function seed(): Promise<{ filmId: number }> {
  await testDb.insert(cinemas).values({ id: 'malba', name: 'MALBA', type: 'indie' });
  const [row] = await testDb
    .insert(films)
    .values({
      title: 'Test Film',
      scrapedTitle: 'Test Film',
      matchSource: 'none',
    })
    .returning({ id: films.id });
  return { filmId: row.id };
}

async function insertScreening(filmId: number, startsAtUtc: Date): Promise<void> {
  await testDb.insert(screenings).values({
    filmId,
    cinemaId: 'malba',
    startsAtUtc,
  });
}

// BA is fixed UTC-3 (no DST). When BA wall clock says 00:00 on a date,
// UTC says 03:00 same calendar day. Used as the request-time `now` in tests.
function baMidnightUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 3));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('getThisWeekScreenings — BA-midnight boundary', () => {
  beforeEach(async () => {
    testDb = await makeInMemoryDb();
  });

  it('excludes a screening that started 30 minutes before BA midnight', async () => {
    const { filmId } = await seed();
    // Apr 23, 23:30 BA = Apr 24, 02:30 UTC (BA is UTC-3).
    await insertScreening(filmId, new Date(Date.UTC(2026, 3, 24, 2, 30)));

    // `now` = Apr 24, 00:00 BA exactly.
    const now = baMidnightUtc(2026, 4, 24);
    const week = await getThisWeekScreenings(now);

    const all = week.flatMap((d) => d.screenings);
    expect(all).toHaveLength(0);
  });

  it('includes a screening that starts 30 minutes after BA midnight', async () => {
    const { filmId } = await seed();
    // Apr 24, 00:30 BA = Apr 24, 03:30 UTC.
    await insertScreening(filmId, new Date(Date.UTC(2026, 3, 24, 3, 30)));

    const now = baMidnightUtc(2026, 4, 24);
    const week = await getThisWeekScreenings(now);

    const all = week.flatMap((d) => d.screenings);
    expect(all).toHaveLength(1);
    expect(week[0].dateKey).toBe('2026-04-24');
    expect(week[0].isToday).toBe(true);
  });

  it('lower bound is inclusive: a screening exactly at BA midnight is kept', async () => {
    const { filmId } = await seed();
    // Apr 24, 00:00 BA = Apr 24, 03:00 UTC.
    await insertScreening(filmId, baMidnightUtc(2026, 4, 24));

    const now = baMidnightUtc(2026, 4, 24);
    const week = await getThisWeekScreenings(now);

    const all = week.flatMap((d) => d.screenings);
    expect(all).toHaveLength(1);
  });
});
