/**
 * Tests for the Cine Lorca image-hash cache.
 *
 * The cache short-circuits the Anthropic vision call when the weekly
 * cartelera image is unchanged — the same image bytes always hash to the
 * same SHA-256, so we only burn an API call (and roll the title-drift
 * dice) on the Thursday a new poster goes up.
 *
 * Test strategy: in-memory libSQL with the real Drizzle schema, exercising
 * the actual SQL upsert and JSON round-trip the production path uses.
 * No vision-call mocking — readImageCache + writeImageCache are tested
 * in isolation. The full fetch()-level integration is covered by the
 * existing fixture-based tests in cine-lorca.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeInMemoryDb, type TestDb } from '../../test/helpers/in-memory-db';
import { cinemas } from '@/db/schema';

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

import {
  readImageCache,
  writeImageCache,
  type ParsedCartelera,
} from './cine-lorca';

const SAMPLE: ParsedCartelera = {
  validFrom: { year: 2026, month: 5, day: 7 },
  validTo: { year: 2026, month: 5, day: 13 },
  films: [
    {
      title: 'PADRE, MADRE, HERMANA, HERMANO',
      times: [
        { hour: 16, minute: 0 },
        { hour: 22, minute: 25 },
      ],
    },
    {
      title: 'GIOIA MIA: un verano en Sicilia',
      times: [{ hour: 16, minute: 15 }],
    },
  ],
};

describe('image-hash cache', () => {
  beforeEach(async () => {
    testDb = await makeInMemoryDb();
    // The providers row references cinemas via FK; the cinema must exist
    // before the cache write can persist.
    await testDb
      .insert(cinemas)
      .values({ id: 'lorca', name: 'Cine Lorca', type: 'indie' });
  });

  it('returns null when no cache row exists', async () => {
    const result = await readImageCache('any-hash');
    expect(result).toBeNull();
  });

  it('round-trips a parsed cartelera through write → read', async () => {
    await writeImageCache('hash-week-of-may-7', SAMPLE);
    const result = await readImageCache('hash-week-of-may-7');
    expect(result).toEqual(SAMPLE);
  });

  it('returns null on hash mismatch (next week, new poster)', async () => {
    await writeImageCache('hash-week-A', SAMPLE);
    const result = await readImageCache('hash-week-B');
    expect(result).toBeNull();
  });

  it('overwrites previous cache when a new image is parsed', async () => {
    const weekA: ParsedCartelera = {
      ...SAMPLE,
      films: [{ title: 'EARLIER FILM', times: [{ hour: 20, minute: 0 }] }],
    };
    const weekB: ParsedCartelera = {
      ...SAMPLE,
      validFrom: { year: 2026, month: 5, day: 14 },
      validTo: { year: 2026, month: 5, day: 20 },
      films: [{ title: 'LATER FILM', times: [{ hour: 18, minute: 30 }] }],
    };
    await writeImageCache('hash-A', weekA);
    await writeImageCache('hash-B', weekB);
    expect(await readImageCache('hash-A')).toBeNull();
    expect(await readImageCache('hash-B')).toEqual(weekB);
  });

  it('returns null when stored payload fails shape validation (defensive)', async () => {
    // Simulate a corrupted row — somebody hand-edited Studio with garbage,
    // or a future schema migration breaks the JSON shape. The cache should
    // miss safely rather than poisoning the scrape with malformed data.
    await testDb.insert(await import('@/db/schema').then((m) => m.providers)).values({
      id: 'lorca',
      lastImageSha256: 'corrupt-hash',
      // Wrong shape: no `validFrom` / `films` keys.
      lastImageParsed: { foo: 'bar' } as unknown as ParsedCartelera,
    });
    const result = await readImageCache('corrupt-hash');
    expect(result).toBeNull();
  });
});
