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
import { films, cinemas, screenings } from '@/db/schema';

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
  titleOriginal?: string | null;
  director?: string | null;
}): Promise<number> {
  const [row] = await testDb
    .insert(films)
    .values({
      title: args.scrapedTitle,
      scrapedTitle: args.scrapedTitle,
      year: args.year,
      titleOriginal: args.titleOriginal ?? null,
      director: args.director ?? null,
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
    expect(enrichFilmMock).toHaveBeenCalledWith('Tempestad de pasiones', 1952, {
      titleOriginal: undefined,
      director: undefined,
    });
    expect(await getMatchSource(resetId)).toBe('auto');
  });

  // Regression: films seeded with titleOriginal + director (e.g. Lugones
  // provider) must forward those hints to enrichFilm so TMDB can search
  // by the original title and fall back to a director-confirmed match.
  it('passes titleOriginal + director hints from films row through to enrichFilm', async () => {
    await seedFilm({
      scrapedTitle: 'Los inadaptados',
      year: 1961,
      titleOriginal: 'The Misfits',
      director: 'John Huston',
      matchSource: 'none',
    });
    enrichFilmMock.mockResolvedValue({
      delta: {
        tmdbId: 887,
        imdbId: 'tt0055184',
        title: 'Vidas rebeldes',
        titleOriginal: 'The Misfits',
        director: 'John Huston',
        country: 'US',
        year: 1961,
        runtimeMin: 124,
        posterUrl: 'https://image.tmdb.org/t/p/w342/misfits.jpg',
        matchConfidence: 0.92,
        matchSource: 'auto',
      },
      reason: 'ok',
    });

    await enrichPendingFilms([]);

    expect(enrichFilmMock).toHaveBeenCalledWith('Los inadaptados', 1961, {
      titleOriginal: 'The Misfits',
      director: 'John Huston',
    });
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

// ---------------------------------------------------------------------------
// Merge-on-collision (regression for 2026-04-20 Lumiton bug)
//
// Year-less providers create rows with year=NULL. SQLite's UNIQUE on
// (scraped_title, year) treats NULL as distinct, so a NULL-year row can
// coexist with an existing (same_title, known_year) row. When TMDB then
// resolves our row's year, the naïve UPDATE would trip the unique
// constraint and crash the whole scrape. enrichPendingFilms must detect
// this and merge: re-point screenings to the existing row, delete ours.
// ---------------------------------------------------------------------------
describe('enrichPendingFilms — merge on (scrapedTitle, year) collision', () => {
  beforeEach(async () => {
    testDb = await makeInMemoryDb();
    enrichFilmMock.mockReset();
    await seedCinema();
  });

  it('merges a null-year pending row into an existing year-known row when TMDB resolves the year', async () => {
    // The existing row that was enriched in a prior run.
    const existingId = await seedFilm({
      scrapedTitle: 'LAWRENCE DE ARABIA',
      year: 1962,
      matchSource: 'auto',
    });
    // Our year-less pending row created by a year-less provider this run.
    const pendingId = await seedFilm({
      scrapedTitle: 'LAWRENCE DE ARABIA',
      year: null,
      matchSource: 'none',
    });
    // Two screenings pointing at the pending row — must survive the merge.
    await testDb.insert(screenings).values([
      {
        filmId: pendingId,
        cinemaId: 'lugones',
        startsAtUtc: new Date('2026-04-23T21:00:00Z'),
        tags: [],
      },
      {
        filmId: pendingId,
        cinemaId: 'lugones',
        startsAtUtc: new Date('2026-04-24T21:00:00Z'),
        tags: [],
      },
    ]);

    enrichFilmMock.mockResolvedValue({
      delta: {
        tmdbId: 947,
        imdbId: 'tt0056172',
        title: 'Lawrence de Arabia',
        titleOriginal: 'Lawrence of Arabia',
        director: 'David Lean',
        country: 'GB',
        year: 1962,
        runtimeMin: 228,
        posterUrl: '/posters/947.jpg',
        matchConfidence: 1.0,
        matchSource: 'auto' as const,
      },
      reason: 'ok',
    });

    const warnings: string[] = [];
    const result = await enrichPendingFilms(warnings);

    expect(result.merged).toBe(1);
    expect(result.enriched).toBe(0);

    // The pending row is gone.
    const pendingStillThere = await testDb
      .select()
      .from(films)
      .where(eq(films.id, pendingId));
    expect(pendingStillThere).toHaveLength(0);

    // The existing row is UNCHANGED — the merge never UPDATEs it; it
    // only re-points screenings and deletes the pending row.
    const existingAfter = await testDb
      .select()
      .from(films)
      .where(eq(films.id, existingId));
    expect(existingAfter).toHaveLength(1);
    expect(existingAfter[0].matchSource).toBe('auto');
    expect(existingAfter[0].year).toBe(1962);

    // Screenings now point at the existing row instead of the deleted one.
    const repointedScreenings = await testDb
      .select()
      .from(screenings)
      .where(eq(screenings.filmId, existingId));
    expect(repointedScreenings).toHaveLength(2);
    const orphanedScreenings = await testDb
      .select()
      .from(screenings)
      .where(eq(screenings.filmId, pendingId));
    expect(orphanedScreenings).toHaveLength(0);

    // Merge event is surfaced as a warning for observability.
    expect(warnings.some((w) => w.includes('merged'))).toBe(true);
    expect(warnings.some((w) => w.includes(`id=${existingId}`))).toBe(true);
  });

  it('normal UPDATE (no merge) when TMDB resolves the year but no collision exists', async () => {
    const id = await seedFilm({
      scrapedTitle: 'Some Brand New Film',
      year: null,
      matchSource: 'none',
    });
    enrichFilmMock.mockResolvedValue({
      delta: {
        tmdbId: 12345,
        imdbId: 'tt0000001',
        title: 'Some Brand New Film',
        titleOriginal: 'Some Brand New Film',
        director: 'A Director',
        country: 'AR',
        year: 2024,
        runtimeMin: 95,
        posterUrl: null,
        matchConfidence: 0.9,
        matchSource: 'auto' as const,
      },
      reason: 'ok',
    });

    const warnings: string[] = [];
    const result = await enrichPendingFilms(warnings);

    expect(result.enriched).toBe(1);
    expect(result.merged).toBe(0);
    const [row] = await testDb.select().from(films).where(eq(films.id, id));
    expect(row.year).toBe(2024);
    expect(row.tmdbId).toBe(12345);
    expect(row.matchSource).toBe('auto');
  });

  it('no merge when the pending row already has a year (known-year path)', async () => {
    // A film with known year gets enriched normally — merge logic must
    // not fire even if another row with the same (title, year) exists,
    // because that would be an illegal state we shouldn't have created.
    // (Defensive: the test seeds only the pending row. No collision row.)
    const id = await seedFilm({
      scrapedTitle: 'Known-Year Film',
      year: 1990,
      matchSource: 'none',
    });
    enrichFilmMock.mockResolvedValue({
      delta: {
        tmdbId: 777,
        imdbId: null,
        title: 'Known-Year Film',
        titleOriginal: null,
        director: null,
        country: null,
        year: 1990,
        runtimeMin: null,
        posterUrl: null,
        matchConfidence: 0.88,
        matchSource: 'auto' as const,
      },
      reason: 'ok',
    });

    const result = await enrichPendingFilms([]);

    expect(result.enriched).toBe(1);
    expect(result.merged).toBe(0);
    const [row] = await testDb.select().from(films).where(eq(films.id, id));
    expect(row.tmdbId).toBe(777);
  });

  it('merges when TMDB changes a wrong year into a colliding row (Tardes de soledad case)', async () => {
    // Regression: observed live on 2026-04-23.
    //   Scraper emits "TARDES DE SOLEDAD" with year=2024 (its best guess
    //   from surrounding context). Inserts as new row since
    //   (scrapedTitle, year) doesn't match any existing row.
    //   Earlier scrape had inserted same title with year=2025 (TMDB had
    //   already enriched it). Now the 2024 row enriches — TMDB returns
    //   year=2025 — UPDATE collides with the 2025 row's unique index.
    // The merge check used to only fire when f.year === null. Broadened
    // to any year change that would collide.
    const existingId = await seedFilm({
      scrapedTitle: 'TARDES DE SOLEDAD',
      year: 2025,
      matchSource: 'auto',
    });
    const pendingId = await seedFilm({
      scrapedTitle: 'TARDES DE SOLEDAD',
      year: 2024,
      matchSource: 'none',
    });
    // A screening pointing at the pending (wrong-year) row — must survive
    // the merge by getting re-pointed to the existing row.
    // (Uses 'lugones' because seedCinema only seeds that one.)
    await testDb.insert(screenings).values({
      filmId: pendingId,
      cinemaId: 'lugones',
      startsAtUtc: new Date('2026-05-01T18:00:00Z'),
      tags: ['cycle'],
    });
    enrichFilmMock.mockResolvedValue({
      delta: {
        tmdbId: 975324,
        imdbId: 'tt26245982',
        title: 'Tardes de soledad',
        titleOriginal: 'Tardes de soledad',
        director: 'Albert Serra',
        country: 'ES',
        year: 2025,
        runtimeMin: 126,
        posterUrl: 'https://image.tmdb.org/t/p/w342/x.jpg',
        matchConfidence: 1,
        matchSource: 'auto' as const,
      },
      reason: 'ok',
    });

    const warnings: string[] = [];
    const result = await enrichPendingFilms(warnings);

    expect(result.merged).toBe(1);
    // The wrong-year row is gone.
    const dropped = await testDb.select().from(films).where(eq(films.id, pendingId));
    expect(dropped).toHaveLength(0);
    // The existing row is untouched — merge never UPDATEs it.
    const [kept] = await testDb.select().from(films).where(eq(films.id, existingId));
    expect(kept.year).toBe(2025);
    // Screenings re-pointed to the existing row, not collateral-deleted.
    const reparented = await testDb
      .select()
      .from(screenings)
      .where(eq(screenings.filmId, existingId));
    expect(reparented).toHaveLength(1);
    // Warning surfaces the year transition, not "no year".
    expect(warnings.some((w) => w.includes('year=2024') && w.includes('year=2025'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regression: ingest used to throw "No values to set" when a provider emitted
// screenings with only a filmTitle (MALBA S2 single-event pages). The set
// clause of onConflictDoUpdate was all-undefined, and Drizzle's mapUpdateSet
// strips those at SQL-build time and throws on the empty object. Whole MALBA
// ingest blew up on the first such cycle.
// ---------------------------------------------------------------------------
const { ingest } = await import('./ingest');

describe('ingest — bare-metadata films (regression for MALBA S2 crash)', () => {
  beforeEach(async () => {
    testDb = await makeInMemoryDb();
    enrichFilmMock.mockReset();
    enrichFilmMock.mockResolvedValue({ delta: null, reason: 'no-candidates' });
    await testDb
      .insert(cinemas)
      .values({ id: 'malba', name: 'MALBA', type: 'indie' });
  });

  it('ingests screenings whose film has no metadata beyond title (year undefined, no director/country/runtime)', async () => {
    const result = await ingest({
      cinemaId: 'malba',
      success: true,
      warnings: [],
      screenings: [
        {
          cinemaId: 'malba',
          filmTitle: 'El diablo viste a la moda 2',
          startsAtUtc: new Date('2026-04-29T20:45:00Z'),
          tags: ['premiere'],
          sourceUrl: 'https://malba.org.ar/evento/moda-2/',
        },
        {
          cinemaId: 'malba',
          filmTitle: 'El diablo viste a la moda 2',
          startsAtUtc: new Date('2026-04-30T00:00:00Z'),
          tags: ['premiere'],
          sourceUrl: 'https://malba.org.ar/evento/moda-2/',
        },
      ],
    });

    expect(result.filmsUpserted).toBe(1);
    expect(result.screeningsInserted).toBe(2);
    expect(result.success).toBe(true);
  });

  it('re-ingesting a bare-metadata film does not throw (regardless of row dedup)', async () => {
    // NOTE: year=undefined becomes NULL in SQLite, which the unique index
    // treats as distinct — so re-ingests create a separate row. That's a
    // pre-existing design behavior (see ingest.ts comments); the TMDB
    // enrichment merge-on-collision path consolidates the duplicates once
    // a year is resolved. This test locks the crash behavior only: the
    // second ingest must NOT throw "No values to set".
    const input = {
      cinemaId: 'malba',
      success: true as const,
      warnings: [],
      screenings: [
        {
          cinemaId: 'malba',
          filmTitle: 'Blue Heron',
          startsAtUtc: new Date('2026-05-02T21:00:00Z'),
          tags: ['cycle' as const],
          sourceUrl: 'https://malba.org.ar/evento/blue-heron/',
        },
      ],
    };

    await expect(ingest(input)).resolves.toBeDefined();
    await expect(ingest(input)).resolves.toBeDefined();
  });

  it('still refreshes metadata on conflict when the scrape DOES provide new fields (year-known path)', async () => {
    // First ingest: year known, bare director.
    await ingest({
      cinemaId: 'malba',
      success: true,
      warnings: [],
      screenings: [
        {
          cinemaId: 'malba',
          filmTitle: 'Padre',
          year: 2026,
          startsAtUtc: new Date('2026-05-10T20:00:00Z'),
          tags: [],
          sourceUrl: 'https://malba.org.ar/evento/padre/',
        },
      ],
    });

    // Second ingest: same title+year, but now director is known. Conflict
    // target (scraped_title, year=2026) hits — onConflictDoUpdate refreshes.
    await ingest({
      cinemaId: 'malba',
      success: true,
      warnings: [],
      screenings: [
        {
          cinemaId: 'malba',
          filmTitle: 'Padre',
          year: 2026,
          director: 'Mariano Luque',
          startsAtUtc: new Date('2026-05-10T20:00:00Z'),
          tags: [],
          sourceUrl: 'https://malba.org.ar/evento/padre/',
        },
      ],
    });

    const [row] = await testDb
      .select()
      .from(films)
      .where(eq(films.scrapedTitle, 'Padre'));
    expect(row.director).toBe('Mariano Luque');
  });
});
