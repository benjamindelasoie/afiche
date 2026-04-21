/**
 * Regression tests for enrichPendingFilms — the re-enrichment filter
 * behavior in src/scrapers/ingest.ts.
 *
 * Context: prior to 2026-04-20, films that failed TMDB match stayed at
 * match_source='none' forever, so every scraper run re-queried TMDB for
 * every persistent miss. The fix distinguishes 'none' (never attempted,
 * try me) from 'none-attempted' (tried and failed, skip me). These tests
 * lock that behavior down against future refactors.
 *
 * Test strategy: in-memory libSQL with real Drizzle migrations, so the
 * SQL filter is exercised for real (not mocked). The external enrichFilm
 * call is stubbed via vi.mock so we don't hit the TMDB network.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeInMemoryDb, type TestDb } from '../../test/helpers/in-memory-db';
import { films, cinemas } from '@/db/schema';

// ---------------------------------------------------------------------------
// Mocks — replace @/db and @/tmdb/enrich before the subject imports them.
// ---------------------------------------------------------------------------
let testDb: TestDb;

vi.mock('@/db', async () => {
  const schema = await vi.importActual<typeof import('@/db/schema')>(
    '@/db/schema',
  );
  return {
    ...schema,
    get db() {
      return testDb;
    },
  };
});

const enrichFilmMock = vi.fn();
vi.mock('@/tmdb/enrich', () => ({
  enrichFilm: (...args: unknown[]) => enrichFilmMock(...args),
}));

vi.mock('@/tmdb/client', () => ({
  hasTmdbToken: () => true,
}));

// Import AFTER mocks so ingest picks them up.
const { enrichPendingFilms } = await import('./ingest');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function seedCinema(): Promise<void> {
  await testDb
    .insert(cinemas)
    .values({ id: 'lugones', name: 'Sala Lugones', type: 'indie' });
}

async function seedFilm(args: {
  scrapedTitle: string;
  year: number | null;
  matchSource: 'auto' | 'override' | 'none' | 'none-attempted';
}): Promise<number> {
  const [row] = await testDb
    .insert(films)
    .values({
      title: args.scrapedTitle,
      scrapedTitle: args.scrapedTitle,
      year: args.year,
      matchSource: args.matchSource,
    })
    .returning({ id: films.id });
  return row.id;
}

async function getMatchSource(id: number): Promise<string | null> {
  const [row] = await testDb
    .select({ matchSource: films.matchSource })
    .from(films)
    .where(eq(films.id, id));
  return row?.matchSource ?? null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('enrichPendingFilms — retry semantics (regression)', () => {
  beforeEach(async () => {
    testDb = await makeInMemoryDb();
    enrichFilmMock.mockReset();
    await seedCinema();
  });

  // T10 — CRITICAL REGRESSION
  it('does NOT re-enrich films whose match_source is "none-attempted"', async () => {
    const attemptedId = await seedFilm({
      scrapedTitle: 'Mientras la ciudad duerme',
      year: 1950,
      matchSource: 'none-attempted',
    });
    const matchedId = await seedFilm({
      scrapedTitle: 'Already Matched',
      year: 2020,
      matchSource: 'auto',
    });

    const warnings: string[] = [];
    const result = await enrichPendingFilms(warnings);

    expect(result.enriched).toBe(0);
    expect(result.skipped).toBe(0);
    expect(enrichFilmMock).not.toHaveBeenCalled();
    // State unchanged:
    expect(await getMatchSource(attemptedId)).toBe('none-attempted');
    expect(await getMatchSource(matchedId)).toBe('auto');
  });

  // T11 — CRITICAL REGRESSION
  it('DOES re-enrich films after a manual reset to match_source="none"', async () => {
    const resetId = await seedFilm({
      scrapedTitle: 'Tempestad de pasiones',
      year: 1952,
      matchSource: 'none', // manual SQL reset would produce this state
    });
    enrichFilmMock.mockResolvedValue({
      delta: {
        tmdbId: 1766802,
        imdbId: 'tt0044568',
        title: 'Clash by Night',
        titleOriginal: 'Clash by Night',
        director: 'Fritz Lang',
        country: 'US',
        year: 1952,
        runtimeMin: 105,
        posterUrl: '/posters/1766802.jpg',
        matchConfidence: 0.92,
        matchSource: 'auto' as const,
      },
      reason: 'ok',
    });

    const warnings: string[] = [];
    const result = await enrichPendingFilms(warnings);

    expect(result.enriched).toBe(1);
    expect(enrichFilmMock).toHaveBeenCalledWith('Tempestad de pasiones', 1952);
    expect(await getMatchSource(resetId)).toBe('auto');
  });

  it('marks a deterministic miss (no-candidates) as "none-attempted"', async () => {
    const id = await seedFilm({
      scrapedTitle: 'Obscure Short Film',
      year: 2019,
      matchSource: 'none',
    });
    enrichFilmMock.mockResolvedValue({
      delta: null,
      reason: 'no-candidates',
    });

    const warnings: string[] = [];
    const result = await enrichPendingFilms(warnings);

    expect(result.enriched).toBe(0);
    expect(result.skipped).toBe(1);
    expect(await getMatchSource(id)).toBe('none-attempted');
  });

  it('marks a deterministic miss (low-confidence) as "none-attempted"', async () => {
    const id = await seedFilm({
      scrapedTitle: 'Ambiguous Title',
      year: 1960,
      matchSource: 'none',
    });
    enrichFilmMock.mockResolvedValue({
      delta: null,
      reason: 'low-confidence',
    });

    await enrichPendingFilms([]);

    expect(await getMatchSource(id)).toBe('none-attempted');
  });

  it('leaves match_source at "none" on transient error so it retries', async () => {
    const id = await seedFilm({
      scrapedTitle: 'Network Failure',
      year: 2023,
      matchSource: 'none',
    });
    enrichFilmMock.mockResolvedValue({
      delta: null,
      reason: 'error',
      error: 'ECONNRESET',
    });

    const warnings: string[] = [];
    const result = await enrichPendingFilms(warnings);

    expect(result.skipped).toBe(1);
    expect(await getMatchSource(id)).toBe('none'); // not locked out
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Network Failure');
    expect(warnings[0]).toContain('ECONNRESET');
  });
});
