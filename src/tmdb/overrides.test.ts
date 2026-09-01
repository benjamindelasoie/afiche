import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeInMemoryDb, type TestDb } from '../../test/helpers/in-memory-db';

let testDb: TestDb;

// Swap @/db for the in-memory test DB; keep the real schema exports.
vi.mock('@/db', async () => {
  const schema = await vi.importActual<typeof import('@/db/schema')>('@/db/schema');
  return {
    ...schema,
    get db() {
      return testDb;
    },
  };
});

const { findOverride, upsertOverride, _resetOverridesCache } =
  await import('./overrides');

beforeEach(async () => {
  testDb = await makeInMemoryDb();
  _resetOverridesCache();
});

describe('tmdb overrides — DB table layer', () => {
  it('finds a machine override written via upsertOverride', async () => {
    await upsertOverride({
      scrapedTitle: 'ZZZ Not In Json Film',
      year: 2020,
      tmdbId: 12345,
      source: 'self-heal-judge',
      confidence: 0.93,
    });
    expect(await findOverride('ZZZ Not In Json Film', 2020)).toBe(12345);
  });

  it('matches case-insensitively', async () => {
    await upsertOverride({ scrapedTitle: 'Mixed Case Title', year: 2019, tmdbId: 777 });
    expect(await findOverride('mixed case title', 2019)).toBe(777);
  });

  it('falls back to a year-agnostic (null-year) override', async () => {
    await upsertOverride({ scrapedTitle: 'Yearless Override', year: null, tmdbId: 888 });
    // Looked up with a concrete year — must fall back to the any-year slot.
    expect(await findOverride('Yearless Override', 2015)).toBe(888);
    expect(await findOverride('Yearless Override', undefined)).toBe(888);
  });

  it('is idempotent — a second upsert updates in place, not duplicates', async () => {
    await upsertOverride({ scrapedTitle: 'Corrected Film', year: 2021, tmdbId: 100 });
    await upsertOverride({ scrapedTitle: 'Corrected Film', year: 2021, tmdbId: 200 });
    expect(await findOverride('Corrected Film', 2021)).toBe(200);
  });

  it('returns null when no override exists in either layer', async () => {
    expect(await findOverride('Totally Unknown Film', 1999)).toBeNull();
  });
});

describe('tmdb overrides — union precedence', () => {
  it('lets the human JSON seed win over a conflicting DB row', async () => {
    // "Una historia sencilla" → 404 is a real seed entry in tmdb-overrides.json.
    await upsertOverride({
      scrapedTitle: 'Una historia sencilla',
      year: null,
      tmdbId: 999999,
      source: 'self-heal-judge',
    });
    expect(await findOverride('Una historia sencilla', undefined)).toBe(404);
  });
});
