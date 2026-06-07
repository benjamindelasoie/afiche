/**
 * Integration tests for assignTmdbIdAction.
 *
 * Coverage targets from the eng-review test diagram + design doc:
 *   - precondition gate: assign on already-patched row → redirect
 *     to ?error=already-patched, no DB mutation
 *   - no-collision happy path: assign writes the enrichment columns
 *     via writeEnrichmentToFilm
 *   - collision, current.id > existing.id: current is loser, screenings
 *     reparent to existing, current row deleted
 *   - collision, current.id < existing.id: existing is loser, screenings
 *     reparent to current, existing row deleted
 *   - collision without confirmMerge: redirect with ?collision= payload,
 *     no DB mutation
 *   - TMDB fetch failure: redirect with ?error=tmdb-fetch-failed
 *
 * Mocks: verifySession (no-op), next/cache.revalidatePath (no-op),
 * next/navigation.redirect (throws a tagged error so we can assert on
 * the destination URL), enrichByTmdbId (returns a fake delta).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeInMemoryDb, type TestDb } from '../../../../../../test/helpers/in-memory-db';
import { films, cinemas, screenings } from '@/db/schema';
import type { EnrichmentDelta } from '@/tmdb/enrich';

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

vi.mock('@/lib/admin-dal', () => ({
  verifySession: vi.fn(async () => ({ authenticated: true as const })),
}));

const revalidatePathMock = vi.fn();
vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

/**
 * `redirect()` in Next.js throws a tagged error to abort the current
 * render/action. We mimic that here by throwing a known shape, so the
 * test can catch + assert on the destination URL without depending on
 * Next.js internals.
 */
class TestRedirect extends Error {
  constructor(public destination: string) {
    super(`REDIRECT:${destination}`);
    this.name = 'TestRedirect';
  }
}
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new TestRedirect(url);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));

const enrichByTmdbIdMock = vi.fn();
vi.mock('@/tmdb/enrich', () => ({
  enrichByTmdbId: (...args: unknown[]) => enrichByTmdbIdMock(...args),
}));

// Import the action AFTER mocks.
const { assignTmdbIdAction } = await import('./actions');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function happyDelta(overrides: Partial<EnrichmentDelta> = {}): EnrichmentDelta {
  return {
    tmdbId: 12345,
    imdbId: 'tt0000123',
    title: 'Solaris',
    titleOriginal: 'Солярис',
    director: 'Andrei Tarkovsky',
    country: 'SU',
    year: 1972,
    runtimeMin: 167,
    posterUrl: '/posters/12345.jpg',
    backdropUrl: '/backdrops/12345.jpg',
    synopsisEs: 'Sinopsis de TMDB.',
    cast: [],
    genres: [878],
    matchConfidence: 1.0,
    matchSource: 'manual',
    ...overrides,
  };
}

async function seedUnmatchedFilm(args: {
  scrapedTitle?: string;
  scrapedYear?: number;
  director?: string | null;
  matchSource?: 'none' | 'none-attempted' | 'auto' | 'manual';
  synopsisEs?: string | null;
  tmdbId?: number | null;
  slug?: string | null;
}): Promise<number> {
  const [row] = await testDb
    .insert(films)
    .values({
      title: args.scrapedTitle ?? 'Unmatched',
      scrapedTitle: args.scrapedTitle ?? 'Unmatched',
      scrapedYear: args.scrapedYear ?? null,
      year: args.scrapedYear ?? null,
      director: args.director ?? null,
      synopsisEs: args.synopsisEs ?? null,
      tmdbId: args.tmdbId ?? null,
      matchSource: args.matchSource ?? 'none',
      slug: args.slug ?? null,
    })
    .returning({ id: films.id });
  return row.id;
}

// Stagger timestamps so collision-merge tests don't trip the
// (film_id, cinema_id, starts_at_utc) unique index. UPDATE OR IGNORE
// in mergeFilmInto would silently drop a reparent if a winner screening
// already existed at the same key, masking what we're trying to assert.
let screeningTimeOffsetMs = 0;
async function seedScreening(filmId: number): Promise<number> {
  screeningTimeOffsetMs += 3_600_000; // +1h per call
  const [row] = await testDb
    .insert(screenings)
    .values({
      filmId,
      cinemaId: 'lugones',
      startsAtUtc: new Date(Date.now() + 86_400_000 + screeningTimeOffsetMs),
      tags: [],
    })
    .returning({ id: screenings.id });
  return row.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('assignTmdbIdAction', () => {
  beforeEach(async () => {
    testDb = await makeInMemoryDb();
    enrichByTmdbIdMock.mockReset();
    revalidatePathMock.mockReset();
    await testDb
      .insert(cinemas)
      .values({ id: 'lugones', name: 'Sala Lugones', type: 'indie' });
  });

  it('no-collision happy path: writes the full enrichment column set', async () => {
    const filmId = await seedUnmatchedFilm({
      scrapedTitle: 'Solaris',
      scrapedYear: 1972,
    });
    await seedScreening(filmId);
    enrichByTmdbIdMock.mockResolvedValue({ delta: happyDelta(), reason: 'ok' });

    await expect(
      assignTmdbIdAction(form({ filmId: String(filmId), tmdbId: '12345' })),
    ).rejects.toThrow(/REDIRECT:\/admin\/unmatched$/);

    const [after] = await testDb.select().from(films).where(eq(films.id, filmId));
    expect(after.tmdbId).toBe(12345);
    expect(after.matchSource).toBe('manual');
    expect(after.director).toBe('Andrei Tarkovsky');
    expect(after.titleOriginal).toBe('Солярис');
    expect(after.posterUrl).toBe('/posters/12345.jpg');
    expect(after.runtimeMin).toBe(167);
    expect(after.imdbId).toBe('tt0000123');
    expect(after.matchConfidence).toBe(1.0);

    expect(enrichByTmdbIdMock).toHaveBeenCalledWith(12345);
    expect(revalidatePathMock).toHaveBeenCalledWith('/');
    expect(revalidatePathMock).toHaveBeenCalledWith('/cartelera');
    expect(revalidatePathMock).toHaveBeenCalledWith('/pelicula/[slug]', 'page');
    expect(revalidatePathMock).toHaveBeenCalledWith('/admin/unmatched');
  });

  it('precondition fail: already-patched row redirects with error and does not mutate', async () => {
    const filmId = await seedUnmatchedFilm({
      matchSource: 'auto',
      tmdbId: 99999,
    });
    enrichByTmdbIdMock.mockResolvedValue({ delta: happyDelta(), reason: 'ok' });

    await expect(
      assignTmdbIdAction(form({ filmId: String(filmId), tmdbId: '12345' })),
    ).rejects.toThrow(
      new RegExp(`REDIRECT:/admin/unmatched/${filmId}\\?error=already-patched`),
    );

    // No DB mutation — tmdbId stays at 99999, matchSource stays auto.
    const [after] = await testDb.select().from(films).where(eq(films.id, filmId));
    expect(after.tmdbId).toBe(99999);
    expect(after.matchSource).toBe('auto');
    expect(enrichByTmdbIdMock).not.toHaveBeenCalled();
  });

  it('TMDB fetch failure redirects with error and does not mutate', async () => {
    const filmId = await seedUnmatchedFilm({});
    enrichByTmdbIdMock.mockResolvedValue({
      delta: null,
      reason: 'error',
      error: 'HTTP 500',
    });

    await expect(
      assignTmdbIdAction(form({ filmId: String(filmId), tmdbId: '12345' })),
    ).rejects.toThrow(
      new RegExp(`REDIRECT:/admin/unmatched/${filmId}\\?error=tmdb-fetch-failed`),
    );

    const [after] = await testDb.select().from(films).where(eq(films.id, filmId));
    expect(after.tmdbId).toBeNull();
    expect(after.matchSource).toBe('none');
  });

  it('collision without confirmMerge: bounces back with ?collision= payload', async () => {
    const existingId = await seedUnmatchedFilm({
      scrapedTitle: 'Solaris (older row)',
      tmdbId: 12345,
      matchSource: 'auto',
      slug: 'solaris-1972',
    });
    const currentId = await seedUnmatchedFilm({
      scrapedTitle: 'Solaris (newer)',
    });
    enrichByTmdbIdMock.mockResolvedValue({ delta: happyDelta(), reason: 'ok' });

    await expect(
      assignTmdbIdAction(form({ filmId: String(currentId), tmdbId: '12345' })),
    ).rejects.toThrow(new RegExp(`REDIRECT:/admin/unmatched/${currentId}\\?collision=`));

    // No mutation on either row.
    const [current] = await testDb.select().from(films).where(eq(films.id, currentId));
    expect(current.tmdbId).toBeNull();
    const [existing] = await testDb.select().from(films).where(eq(films.id, existingId));
    expect(existing.id).toBe(existingId);
  });

  it('collision with confirmMerge, current.id > existing.id: current is loser, screenings reparent, current deleted', async () => {
    const existingId = await seedUnmatchedFilm({
      scrapedTitle: 'Solaris (older)',
      tmdbId: 12345,
      matchSource: 'auto',
      slug: 'solaris-1972',
    });
    const currentId = await seedUnmatchedFilm({ scrapedTitle: 'Solaris (newer)' });
    const screeningId = await seedScreening(currentId);
    enrichByTmdbIdMock.mockResolvedValue({ delta: happyDelta(), reason: 'ok' });

    await expect(
      assignTmdbIdAction(
        form({ filmId: String(currentId), tmdbId: '12345', confirmMerge: '1' }),
      ),
    ).rejects.toThrow(/REDIRECT:\/admin\/unmatched$/);

    // The current row was the loser (higher id) and is now gone.
    const survivors = await testDb.select().from(films).where(eq(films.id, currentId));
    expect(survivors).toHaveLength(0);

    // Screening reparented to existing (the lower-id winner).
    const [reparented] = await testDb
      .select()
      .from(screenings)
      .where(eq(screenings.id, screeningId));
    expect(reparented.filmId).toBe(existingId);

    // Existing row got its enrichment refreshed.
    const [winner] = await testDb.select().from(films).where(eq(films.id, existingId));
    expect(winner.tmdbId).toBe(12345);
    expect(winner.director).toBe('Andrei Tarkovsky');
    expect(winner.slug).toBe('solaris-1972');
  });

  it('collision with confirmMerge, current.id < existing.id: existing is loser, screenings reparent to current, existing deleted', async () => {
    // Insert the current (target) row FIRST so it gets the lower id.
    const currentId = await seedUnmatchedFilm({ scrapedTitle: 'Solaris (current)' });
    const screeningOnCurrent = await seedScreening(currentId);
    const existingId = await seedUnmatchedFilm({
      scrapedTitle: 'Solaris (newer auto-match)',
      tmdbId: 12345,
      matchSource: 'auto',
      slug: 'solaris-1972-other',
    });
    const screeningOnExisting = await seedScreening(existingId);
    enrichByTmdbIdMock.mockResolvedValue({ delta: happyDelta(), reason: 'ok' });

    await expect(
      assignTmdbIdAction(
        form({ filmId: String(currentId), tmdbId: '12345', confirmMerge: '1' }),
      ),
    ).rejects.toThrow(/REDIRECT:\/admin\/unmatched$/);

    // The existing row was the loser (higher id) and is now gone.
    const survivors = await testDb.select().from(films).where(eq(films.id, existingId));
    expect(survivors).toHaveLength(0);

    // Both screenings reparented to the current (lower-id winner).
    const [s1] = await testDb
      .select()
      .from(screenings)
      .where(eq(screenings.id, screeningOnCurrent));
    expect(s1.filmId).toBe(currentId);
    const [s2] = await testDb
      .select()
      .from(screenings)
      .where(eq(screenings.id, screeningOnExisting));
    expect(s2.filmId).toBe(currentId);

    // Current row got the enrichment.
    const [winner] = await testDb.select().from(films).where(eq(films.id, currentId));
    expect(winner.tmdbId).toBe(12345);
    expect(winner.director).toBe('Andrei Tarkovsky');
  });

  it('invalid form data redirects to /admin/unmatched without mutating', async () => {
    await expect(
      assignTmdbIdAction(form({ filmId: 'not-a-number', tmdbId: '12345' })),
    ).rejects.toThrow(/REDIRECT:\/admin\/unmatched$/);

    expect(enrichByTmdbIdMock).not.toHaveBeenCalled();
  });
});
