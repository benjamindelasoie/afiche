/**
 * Regression tests for the cartelera tier queries — specifically the
 * BA-midnight boundary that bit us in prod (2026-04-24).
 *
 * Symptom: yesterday's screenings still appeared on the home page after
 * BA midnight rolled over. Root cause was route-level static caching
 * freezing `new Date()` in src/app/page.tsx (fixed there with
 * `export const dynamic = 'force-dynamic'`). The DB-layer filter was
 * already correct — these tests pin that contract so a future refactor
 * can't quietly reintroduce the bug from this side.
 *
 * 2026-05-02: migrated from `getThisWeekScreenings` (1-7 day, ISO-week
 * upper bound) to `getTwoWeeksScreenings` (14-day rolling). The
 * BA-midnight LOWER bound is identical in both — these tests still pin
 * exactly the same contract. Two extra tests pin the new upper bound
 * (today+14 exclusive) and the new `groupByWeek` helper used by
 * Próximamente.
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
const {
  getTwoWeeksScreenings,
  getUpcomingScreenings,
  searchUpcomingFilms,
  getFilmBySlug,
  listCinemas,
} = await import('./queries');

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
describe('getTwoWeeksScreenings — BA-midnight boundary', () => {
  beforeEach(async () => {
    testDb = await makeInMemoryDb();
  });

  it('excludes a screening that started 30 minutes before BA midnight', async () => {
    const { filmId } = await seed();
    // Apr 23, 23:30 BA = Apr 24, 02:30 UTC (BA is UTC-3).
    await insertScreening(filmId, new Date(Date.UTC(2026, 3, 24, 2, 30)));

    // `now` = Apr 24, 00:00 BA exactly.
    const now = baMidnightUtc(2026, 4, 24);
    const window = await getTwoWeeksScreenings(now);

    const all = window.flatMap((d) => d.screenings);
    expect(all).toHaveLength(0);
  });

  it('includes a screening that starts 30 minutes after BA midnight', async () => {
    const { filmId } = await seed();
    // Apr 24, 00:30 BA = Apr 24, 03:30 UTC.
    await insertScreening(filmId, new Date(Date.UTC(2026, 3, 24, 3, 30)));

    const now = baMidnightUtc(2026, 4, 24);
    const window = await getTwoWeeksScreenings(now);

    const all = window.flatMap((d) => d.screenings);
    expect(all).toHaveLength(1);
    expect(window[0].dateKey).toBe('2026-04-24');
    expect(window[0].isToday).toBe(true);
  });

  it('lower bound is inclusive: a screening exactly at BA midnight is kept', async () => {
    const { filmId } = await seed();
    // Apr 24, 00:00 BA = Apr 24, 03:00 UTC.
    await insertScreening(filmId, baMidnightUtc(2026, 4, 24));

    const now = baMidnightUtc(2026, 4, 24);
    const window = await getTwoWeeksScreenings(now);

    const all = window.flatMap((d) => d.screenings);
    expect(all).toHaveLength(1);
  });
});

describe('getTwoWeeksScreenings — 14-day upper bound', () => {
  beforeEach(async () => {
    testDb = await makeInMemoryDb();
  });

  it('includes a screening on day 13 (last full day in the window)', async () => {
    const { filmId } = await seed();
    // Apr 24, 00:00 BA + 13 days = May 7, 00:00 BA. Insert a screening
    // at May 7, 23:00 BA to confirm "day 13" (today + 13) is fully included.
    // May 7, 23:00 BA = May 8, 02:00 UTC.
    await insertScreening(filmId, new Date(Date.UTC(2026, 4, 8, 2, 0)));

    const now = baMidnightUtc(2026, 4, 24);
    const window = await getTwoWeeksScreenings(now);

    const all = window.flatMap((d) => d.screenings);
    expect(all).toHaveLength(1);
  });

  it('excludes a screening on day 14 (first day past the window)', async () => {
    const { filmId } = await seed();
    // Apr 24, 00:00 BA + 14 days = May 8, 00:00 BA. The window is
    // exclusive at this boundary — a screening at May 8 00:00 BA must
    // NOT appear. May 8, 00:00 BA = May 8, 03:00 UTC.
    await insertScreening(filmId, new Date(Date.UTC(2026, 4, 8, 3, 0)));

    const now = baMidnightUtc(2026, 4, 24);
    const window = await getTwoWeeksScreenings(now);

    const all = window.flatMap((d) => d.screenings);
    expect(all).toHaveLength(0);
  });

  it('always returns 14 day groups, padding empty days with empty screenings arrays', async () => {
    // Insert one screening on day 0 (today) and another on day 13. The
    // 12 days between should still appear in the result with empty
    // screenings — date strip needs every chip for the rolling window.
    const { filmId } = await seed();
    // Day 0: Apr 24, 19:00 BA = Apr 24, 22:00 UTC.
    await insertScreening(filmId, new Date(Date.UTC(2026, 3, 24, 22, 0)));
    // Day 13: May 7, 19:00 BA = May 7, 22:00 UTC.
    await insertScreening(filmId, new Date(Date.UTC(2026, 4, 7, 22, 0)));

    const now = baMidnightUtc(2026, 4, 24);
    const window = await getTwoWeeksScreenings(now);

    expect(window).toHaveLength(14);
    expect(window[0].dateKey).toBe('2026-04-24');
    expect(window[0].isToday).toBe(true);
    expect(window[0].screenings).toHaveLength(1);
    expect(window[13].dateKey).toBe('2026-05-07');
    expect(window[13].screenings).toHaveLength(1);
    // Middle days are padded with empty screenings.
    for (let i = 1; i <= 12; i++) {
      expect(window[i].screenings).toHaveLength(0);
      expect(window[i].label).toBeTruthy();
    }
  });
});

describe('getUpcomingScreenings — week-grouped Próximamente', () => {
  beforeEach(async () => {
    testDb = await makeInMemoryDb();
  });

  it('starts at today+14 (matches the upper bound of getTwoWeeksScreenings)', async () => {
    const { filmId } = await seed();
    // May 8, 00:00 BA = May 8, 03:00 UTC. This is the FIRST instant of
    // Próximamente when `now` = Apr 24 00:00 BA.
    await insertScreening(filmId, new Date(Date.UTC(2026, 4, 8, 3, 0)));

    const now = baMidnightUtc(2026, 4, 24);
    const upcoming = await getUpcomingScreenings(now);

    const all = upcoming.flatMap((w) => w.screenings);
    expect(all).toHaveLength(1);
  });

  it('groups multi-week cycles into per-week buckets', async () => {
    // A "Continúa" cycle scenario: same film, screenings on May 8 (Fri)
    // + May 15 (Fri) — different ISO weeks. Each goes into its own
    // week group. The week-grouping logic uses the Monday of the
    // screening's ISO week as the bucket key.
    const { filmId } = await seed();
    // May 8 19:00 BA → 22:00 UTC. ISO week starting Mon May 4.
    await insertScreening(filmId, new Date(Date.UTC(2026, 4, 8, 22, 0)));
    // May 15 19:00 BA → 22:00 UTC. ISO week starting Mon May 11.
    await insertScreening(filmId, new Date(Date.UTC(2026, 4, 15, 22, 0)));

    const now = baMidnightUtc(2026, 4, 24);
    const upcoming = await getUpcomingScreenings(now);

    expect(upcoming).toHaveLength(2);
    expect(upcoming[0].weekKey).toBe('2026-05-04');
    expect(upcoming[1].weekKey).toBe('2026-05-11');
    expect(upcoming[0].screenings).toHaveLength(1);
    expect(upcoming[1].screenings).toHaveLength(1);
  });

  it('formats week labels with month-crossing handled correctly', async () => {
    // Week of Mon Apr 27 → Sun May 3 crosses a month boundary.
    // Expected label: "Semana del 27 de abril al 3 de mayo".
    const { filmId } = await seed();
    // Need this screening to land in Próximamente, so push `now` further back.
    // `now` = Apr 13 00:00 BA → window upper = Apr 27 00:00 BA. Apr 30 19:00
    // BA falls in Próximamente, in the ISO week starting Mon Apr 27.
    await insertScreening(filmId, new Date(Date.UTC(2026, 3, 30, 22, 0)));

    const now = baMidnightUtc(2026, 4, 13);
    const upcoming = await getUpcomingScreenings(now);

    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].label).toBe('Semana del 27 de abril al 3 de mayo');
  });

  it('formats week labels with same-month range', async () => {
    // Week of Mon May 11 → Sun May 17, all in May.
    // Expected label: "Semana del 11 al 17 de mayo".
    const { filmId } = await seed();
    await insertScreening(filmId, new Date(Date.UTC(2026, 4, 13, 22, 0)));

    const now = baMidnightUtc(2026, 4, 24);
    const upcoming = await getUpcomingScreenings(now);

    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].label).toBe('Semana del 11 al 17 de mayo');
  });
});

// ---------------------------------------------------------------------------
// MCP read queries
// ---------------------------------------------------------------------------
describe('searchUpcomingFilms (MCP)', () => {
  beforeEach(async () => {
    testDb = await makeInMemoryDb();
    await testDb.insert(cinemas).values({ id: 'malba', name: 'MALBA', type: 'indie' });
  });

  async function addFilm(opts: {
    title: string;
    director?: string;
    slug: string | null;
  }) {
    const [row] = await testDb
      .insert(films)
      .values({
        title: opts.title,
        scrapedTitle: opts.title,
        director: opts.director ?? null,
        slug: opts.slug,
        matchSource: 'auto',
      })
      .returning({ id: films.id });
    return row.id;
  }

  it('matches accent-insensitively and counts only still-catchable screenings', async () => {
    const id = await addFilm({
      title: 'Hable con ella',
      director: 'Pedro Almodóvar',
      slug: 'hable-con-ella',
    });
    const now = baMidnightUtc(2026, 4, 24); // Apr 24 00:00 BA
    // Future (today 19:00 BA = 22:00 UTC) — catchable.
    await insertScreening(id, new Date(Date.UTC(2026, 3, 24, 22, 0)));
    // Yesterday 22:00 BA = Apr 24 01:00 UTC — already expired vs `now`.
    await insertScreening(id, new Date(Date.UTC(2026, 3, 24, 1, 0)));

    const hits = await searchUpcomingFilms('almodovar', now, 20);
    expect(hits).toHaveLength(1);
    expect(hits[0].slug).toBe('hable-con-ella');
    expect(hits[0].screeningCount).toBe(1); // expired one excluded
    expect(hits[0].venueCount).toBe(1);
  });

  it('excludes films with a null slug (unlinkable)', async () => {
    const id = await addFilm({ title: 'Sin Aficheo', slug: null });
    const now = baMidnightUtc(2026, 4, 24);
    await insertScreening(id, new Date(Date.UTC(2026, 3, 24, 22, 0)));
    expect(await searchUpcomingFilms('aficheo', now, 20)).toHaveLength(0);
  });

  it('returns nothing when the query is under 2 chars', async () => {
    const id = await addFilm({ title: 'Z', slug: 'z' });
    await insertScreening(id, new Date(Date.UTC(2026, 3, 24, 22, 0)));
    expect(await searchUpcomingFilms('z', baMidnightUtc(2026, 4, 24), 20)).toHaveLength(
      0,
    );
  });

  it('respects the limit', async () => {
    const now = baMidnightUtc(2026, 4, 24);
    for (const n of [1, 2, 3]) {
      const id = await addFilm({ title: `Western ${n}`, slug: `western-${n}` });
      await insertScreening(id, new Date(Date.UTC(2026, 3, 24, 22, 0)));
    }
    expect(await searchUpcomingFilms('western', now, 2)).toHaveLength(2);
  });
});

describe('getFilmBySlug (MCP)', () => {
  beforeEach(async () => {
    testDb = await makeInMemoryDb();
  });

  it('returns the film for a known slug, null for an unknown one', async () => {
    await testDb.insert(films).values({
      title: 'Stalker',
      scrapedTitle: 'Stalker',
      slug: 'stalker',
      matchSource: 'auto',
      year: 1979,
    });
    const found = await getFilmBySlug('stalker');
    expect(found?.title).toBe('Stalker');
    expect(found?.year).toBe(1979);
    expect(await getFilmBySlug('nope')).toBeNull();
  });
});

describe('listCinemas (MCP)', () => {
  beforeEach(async () => {
    testDb = await makeInMemoryDb();
  });

  it('returns every cinema ordered by name', async () => {
    await testDb.insert(cinemas).values({ id: 'zeta', name: 'Zeta', type: 'indie' });
    await testDb.insert(cinemas).values({ id: 'alpha', name: 'Alpha', type: 'indie' });
    const list = await listCinemas();
    expect(list.map((c) => c.name)).toEqual(['Alpha', 'Zeta']);
  });
});
