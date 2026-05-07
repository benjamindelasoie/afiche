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
import { sql } from 'drizzle-orm';
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
  composeCacheKey,
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

  it('rejects payloads exceeding film-count cap (DoS defense)', async () => {
    // Hostile JSON with 100 films would, post-validation, be fed to
    // expandScreenings and Cartesian-product across days × times.
    // Cap is 30 films per cycle (real Lorca cycles: 4-7).
    const exploded: ParsedCartelera = {
      validFrom: { year: 2026, month: 5, day: 7 },
      validTo: { year: 2026, month: 5, day: 13 },
      films: Array.from({ length: 100 }, (_, i) => ({
        title: `BOMB FILM ${i}`,
        times: [{ hour: 12, minute: 0 }],
      })),
    };
    await testDb
      .insert(await import('@/db/schema').then((m) => m.providers))
      .values({ id: 'lorca', lastImageSha256: 'too-many', lastImageParsed: exploded });
    expect(await readImageCache('too-many')).toBeNull();
  });

  it('rejects payloads exceeding times-per-film cap', async () => {
    const tooManyTimes: ParsedCartelera = {
      validFrom: { year: 2026, month: 5, day: 7 },
      validTo: { year: 2026, month: 5, day: 13 },
      films: [
        {
          title: 'TIME BOMB',
          times: Array.from({ length: 50 }, (_, i) => ({ hour: i % 24, minute: 0 })),
        },
      ],
    };
    await testDb
      .insert(await import('@/db/schema').then((m) => m.providers))
      .values({ id: 'lorca', lastImageSha256: 'too-many-times', lastImageParsed: tooManyTimes });
    expect(await readImageCache('too-many-times')).toBeNull();
  });

  it('rejects payloads with absurdly long titles', async () => {
    const longTitle: ParsedCartelera = {
      validFrom: { year: 2026, month: 5, day: 7 },
      validTo: { year: 2026, month: 5, day: 13 },
      films: [{ title: 'A'.repeat(500), times: [{ hour: 12, minute: 0 }] }],
    };
    await testDb
      .insert(await import('@/db/schema').then((m) => m.providers))
      .values({ id: 'lorca', lastImageSha256: 'long-title', lastImageParsed: longTitle });
    expect(await readImageCache('long-title')).toBeNull();
  });

  it('rejects payloads with out-of-range years (1990, 9999)', async () => {
    // Hostile validFrom with year 9999 would explode enumerateDays into
    // millions of iterations even with bounded films/times.
    const badPast: ParsedCartelera = {
      validFrom: { year: 1990, month: 5, day: 7 },
      validTo: { year: 2026, month: 5, day: 13 },
      films: [{ title: 'OK', times: [{ hour: 12, minute: 0 }] }],
    };
    const badFuture: ParsedCartelera = {
      validFrom: { year: 2026, month: 5, day: 7 },
      validTo: { year: 9999, month: 5, day: 13 },
      films: [{ title: 'OK', times: [{ hour: 12, minute: 0 }] }],
    };
    await testDb
      .insert(await import('@/db/schema').then((m) => m.providers))
      .values({ id: 'lorca', lastImageSha256: 'bad-past', lastImageParsed: badPast });
    expect(await readImageCache('bad-past')).toBeNull();
    // Switch to the future-bad row
    await testDb.run(
      sql`UPDATE providers SET last_image_sha256 = 'bad-future', last_image_parsed = ${JSON.stringify(badFuture)} WHERE id = 'lorca'`,
    );
    expect(await readImageCache('bad-future')).toBeNull();
  });

  it('rejects payloads with out-of-range month/day primitives', async () => {
    const badMonth: ParsedCartelera = {
      validFrom: { year: 2026, month: 13, day: 7 },
      validTo: { year: 2026, month: 5, day: 13 },
      films: [{ title: 'OK', times: [{ hour: 12, minute: 0 }] }],
    };
    await testDb
      .insert(await import('@/db/schema').then((m) => m.providers))
      .values({ id: 'lorca', lastImageSha256: 'bad-month', lastImageParsed: badMonth });
    expect(await readImageCache('bad-month')).toBeNull();
  });

  it('returns null when last_image_parsed contains invalid JSON (Drizzle hydration safety)', async () => {
    // Defense against the Drizzle JSON-mode hydration path. If a non-Drizzle
    // writer (Studio hand-edit, partial write, encoding corruption) puts
    // raw garbage text in the column, Drizzle's mode:'json' attempts to
    // JSON.parse it during row hydration and throws synchronously. Without
    // a try/catch around the SELECT, that would abort the whole scrape.
    // The wrapper in readImageCache turns this into a safe miss.
    //
    // Bypass Drizzle's JSON serializer and write raw garbage text directly
    // via libSQL's execute. The value `not-actually-json{` is unparseable.
    await testDb.run(sql`INSERT INTO providers (id, last_image_sha256, last_image_parsed) VALUES ('lorca', 'garbage-key', 'not-actually-json{')`);
    const result = await readImageCache('garbage-key');
    expect(result).toBeNull();
  });
});

describe('composeCacheKey', () => {
  it('produces a 64-char hex digest', () => {
    const key = composeCacheKey(Buffer.from('image-bytes'), 'haiku', 1);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same inputs always produce the same key', () => {
    const a = composeCacheKey(Buffer.from('image-bytes'), 'haiku', 1);
    const b = composeCacheKey(Buffer.from('image-bytes'), 'haiku', 1);
    expect(a).toBe(b);
  });

  it('changes when the model changes (model upgrade invalidates cache)', () => {
    const oldModel = composeCacheKey(Buffer.from('same-image'), 'haiku-4-5', 1);
    const newModel = composeCacheKey(Buffer.from('same-image'), 'haiku-4-7', 1);
    expect(oldModel).not.toBe(newModel);
  });

  it('changes when the prompt version changes (prompt revision invalidates cache)', () => {
    const v1 = composeCacheKey(Buffer.from('same-image'), 'haiku', 1);
    const v2 = composeCacheKey(Buffer.from('same-image'), 'haiku', 2);
    expect(v1).not.toBe(v2);
  });

  it('changes when the image changes (the original use case)', () => {
    const week1 = composeCacheKey(Buffer.from('week-1-poster'), 'haiku', 1);
    const week2 = composeCacheKey(Buffer.from('week-2-poster'), 'haiku', 1);
    expect(week1).not.toBe(week2);
  });
});
