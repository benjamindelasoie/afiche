/**
 * Pre-write circuit breaker for replaceFutureScreenings.
 *
 * The delete+insert is destructive; an empty fetch from a broken scraper must
 * NOT wipe a cinema's live future schedule. These tests exercise the breaker
 * against a real in-memory DB.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, count, eq, gt } from 'drizzle-orm';
import { makeInMemoryDb, type TestDb } from '../../../test/helpers/in-memory-db';
import { cinemas, films, screenings } from '@/db/schema';
import type { ScrapedScreening } from '@/providers/types';

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

const { replaceFutureScreenings } = await import('./screenings');
const { filmKey } = await import('./films');

const NOW = new Date('2026-09-01T12:00:00Z');
const CINEMA = 'testville';

async function seed(): Promise<number> {
  await testDb.insert(cinemas).values({ id: CINEMA, name: 'Testville', type: 'indie' });
  const [f] = await testDb
    .insert(films)
    .values({ title: 'Test Film', scrapedTitle: 'Test Film' })
    .returning({ id: films.id });
  return f.id;
}

async function insertFuture(filmId: number, ...offsetsHours: number[]): Promise<void> {
  await testDb.insert(screenings).values(
    offsetsHours.map((h) => ({
      filmId,
      cinemaId: CINEMA,
      startsAtUtc: new Date(NOW.getTime() + h * 3600_000),
      tags: [],
      sourceUrl: 'https://example.test',
    })),
  );
}

async function futureCount(): Promise<number> {
  const [{ n }] = await testDb
    .select({ n: count() })
    .from(screenings)
    .where(and(eq(screenings.cinemaId, CINEMA), gt(screenings.startsAtUtc, NOW)));
  return n;
}

beforeEach(async () => {
  testDb = await makeInMemoryDb();
});

describe('replaceFutureScreenings — pre-write circuit breaker', () => {
  it('refuses to wipe a live schedule when the fetch is empty', async () => {
    const filmId = await seed();
    await insertFuture(filmId, 48, 72, 96); // 3 future screenings

    const res = await replaceFutureScreenings(CINEMA, NOW, [], new Map());

    expect(res.circuitBroke).toBe(true);
    expect(res.preservedFuture).toBe(3);
    expect(res.inserted).toBe(0);
    // The live schedule is untouched.
    expect(await futureCount()).toBe(3);
  });

  it('does NOT break when there is no live schedule to protect', async () => {
    await seed();
    const res = await replaceFutureScreenings(CINEMA, NOW, [], new Map());
    expect(res.circuitBroke).toBe(false);
    expect(res.preservedFuture).toBe(0);
    expect(res.inserted).toBe(0);
  });

  it('replaces normally when the fetch is non-empty', async () => {
    const filmId = await seed();
    await insertFuture(filmId, 24, 48); // 2 stale future rows

    const scraped: ScrapedScreening[] = [
      {
        cinemaId: CINEMA,
        filmTitle: 'Test Film',
        year: 2024,
        startsAtUtc: new Date(NOW.getTime() + 120 * 3600_000),
        tags: [],
        sourceUrl: 'https://example.test/new',
      },
    ];
    const map = new Map([[filmKey('Test Film', 2024), filmId]]);

    const res = await replaceFutureScreenings(CINEMA, NOW, scraped, map);

    expect(res.circuitBroke).toBe(false);
    expect(res.inserted).toBe(1);
    // The 2 stale rows were replaced by the 1 new one.
    expect(await futureCount()).toBe(1);
  });
});
