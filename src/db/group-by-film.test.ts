/**
 * Tests for the window-scoped group-by-film homepage queries (redesign
 * 2026-06-06).
 *
 *   - Pure transforms (`groupByFilm`, `deriveFeatured`) tested with hand-built
 *     ScreeningRow fixtures — no DB.
 *   - `getWindowScreeningsByFilm` / `getFeaturedFilms` tested against an
 *     in-memory libSQL DB (same harness as queries.test.ts) so the bounded SQL
 *     + the unbounded última check run for real.
 *
 * BA is fixed UTC-3 (no DST): BA midnight on a date = 03:00 UTC same date.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeInMemoryDb, type TestDb } from '../../test/helpers/in-memory-db';
import { films, cinemas, screenings, type ScreeningTag } from '@/db/schema';
import type { ScreeningRow } from '@/db/queries';

// ---------------------------------------------------------------------------
// In-memory DB mock — replace @/db before the subject imports it.
// ---------------------------------------------------------------------------
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

const {
  groupByFilm,
  deriveFeatured,
  getWindowScreeningsByFilm,
  getFeaturedFilms,
  getJsonLdScreenings,
  formatDayChipBA,
} = await import('./queries');

// ---------------------------------------------------------------------------
// Pure fixtures
// ---------------------------------------------------------------------------
let nextId = 1;
function mkRow(opts: {
  filmId: number;
  cinemaId: string;
  startsAtUtc: Date;
  title?: string;
  cinemaName?: string;
  tags?: ScreeningTag[];
  programName?: string | null;
  sourceUrl?: string | null;
  slug?: string | null;
  posterUrl?: string | null;
  year?: number | null;
  country?: string | null;
  popularity?: number | null;
  voteCount?: number | null;
  createdAt?: Date;
}): ScreeningRow {
  return {
    id: nextId++,
    startsAtUtc: opts.startsAtUtc,
    tags: opts.tags ?? [],
    sourceUrl: opts.sourceUrl ?? null,
    programName: opts.programName ?? null,
    film: {
      id: opts.filmId,
      title: opts.title ?? `Film ${opts.filmId}`,
      titleOriginal: null,
      director: null,
      year: opts.year ?? null,
      country: opts.country ?? null,
      runtimeMin: null,
      synopsisEs: null,
      // Default to an enriched poster — featured-band selection now requires
      // one. Pass `posterUrl: null` to exercise the unenriched-exclusion path.
      posterUrl:
        opts.posterUrl === undefined ? 'https://image.tmdb.org/t/p/w342/x.jpg' : opts.posterUrl,
      backdropUrl: null,
      slug: opts.slug === undefined ? `film-${opts.filmId}` : opts.slug,
      cast: null,
      genres: null,
      popularity: opts.popularity ?? null,
      voteAverage: null,
      voteCount: opts.voteCount ?? null,
      createdAt: opts.createdAt ?? new Date('2026-01-01T00:00:00Z'),
    },
    cinema: {
      id: opts.cinemaId,
      name: opts.cinemaName ?? opts.cinemaId,
      neighborhood: null,
      address: null,
      type: 'indie',
    },
  };
}

// Thu 2026-06-04, 12:00 BA (15:00 UTC).
const NOW = new Date('2026-06-04T15:00:00Z');
const at = (utc: string) => new Date(utc);

describe('groupByFilm — transform', () => {
  it('single-showtime film → one group, one venue, totalCount 1', () => {
    const groups = groupByFilm([mkRow({ filmId: 1, cinemaId: 'malba', startsAtUtc: at('2026-06-04T23:00:00Z') })], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].totalCount).toBe(1);
    expect(groups[0].byVenue).toHaveLength(1);
    expect(groups[0].byVenue[0].screenings).toHaveLength(1);
    expect(groups[0].nextCatchableUtc).toBe(at('2026-06-04T23:00:00Z').getTime());
  });

  it('multi-showtime at one venue → one group, one venue, totalCount N', () => {
    const groups = groupByFilm(
      [
        mkRow({ filmId: 1, cinemaId: 'lugones', startsAtUtc: at('2026-06-04T21:00:00Z') }),
        mkRow({ filmId: 1, cinemaId: 'lugones', startsAtUtc: at('2026-06-04T23:30:00Z') }),
      ],
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].totalCount).toBe(2);
    expect(groups[0].byVenue).toHaveLength(1);
  });

  it('same film at two venues → one group, two venues', () => {
    const groups = groupByFilm(
      [
        mkRow({ filmId: 1, cinemaId: 'lugones', startsAtUtc: at('2026-06-04T21:00:00Z') }),
        mkRow({ filmId: 1, cinemaId: 'gaumont', startsAtUtc: at('2026-06-04T23:00:00Z') }),
      ],
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].byVenue.map((v) => v.cinema.id)).toEqual(['lugones', 'gaumont']);
  });

  it('orders films by next CATCHABLE showtime ascending', () => {
    // Film 1's soonest is 21:00Z; Film 2's is 19:00Z → Film 2 first.
    const groups = groupByFilm(
      [
        mkRow({ filmId: 2, cinemaId: 'malba', startsAtUtc: at('2026-06-04T19:00:00Z') }),
        mkRow({ filmId: 1, cinemaId: 'malba', startsAtUtc: at('2026-06-04T21:00:00Z') }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.film.id)).toEqual([2, 1]);
  });

  it('sinks all-past films below catchable ones, ordered by last showtime', () => {
    // A: future (catchable). B: only past (13:00Z < now-grace) → sunk.
    const groups = groupByFilm(
      [
        mkRow({ filmId: 11, cinemaId: 'malba', startsAtUtc: at('2026-06-04T11:00:00Z') }), // C past, last=11
        mkRow({ filmId: 12, cinemaId: 'malba', startsAtUtc: at('2026-06-04T13:00:00Z') }), // B past, last=13
        mkRow({ filmId: 10, cinemaId: 'malba', startsAtUtc: at('2026-06-04T23:00:00Z') }), // A future
      ],
      NOW,
    );
    // Catchable A first; then sunk films most-recently-ended first (B@13 before C@11).
    expect(groups.map((g) => g.film.id)).toEqual([10, 12, 11]);
    expect(groups[0].nextCatchableUtc).not.toBeNull();
    expect(groups[1].nextCatchableUtc).toBeNull();
    expect(groups[2].nextCatchableUtc).toBeNull();
  });

  it('retains past showtimes in the row; nextCatchable skips them', () => {
    const groups = groupByFilm(
      [
        mkRow({ filmId: 1, cinemaId: 'malba', startsAtUtc: at('2026-06-04T10:00:00Z') }), // past
        mkRow({ filmId: 1, cinemaId: 'malba', startsAtUtc: at('2026-06-04T22:00:00Z') }), // future
      ],
      NOW,
    );
    expect(groups[0].totalCount).toBe(2);
    expect(groups[0].nextCatchableUtc).toBe(at('2026-06-04T22:00:00Z').getTime());
  });

  it('keeps first-seen (chronological) order when next-catchable times tie', () => {
    const groups = groupByFilm(
      [
        mkRow({ filmId: 7, cinemaId: 'malba', startsAtUtc: at('2026-06-04T20:00:00Z') }),
        mkRow({ filmId: 8, cinemaId: 'malba', startsAtUtc: at('2026-06-04T20:00:00Z') }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.film.id)).toEqual([7, 8]);
  });
});

describe('deriveFeatured — four-slot band', () => {
  const windowUpper = at('2026-06-11T03:00:00Z');
  // Last screening 3 weeks out → catchable (passes the gate) but NOT última.
  const beyond = at('2026-06-25T23:00:00Z').getTime();
  // createdAt long before NOW (2026-06-04) → NOT "nuevo".
  const old = at('2026-01-01T00:00:00Z');
  const mk = (id: number, extra: Partial<Parameters<typeof mkRow>[0]> = {}) =>
    mkRow({
      filmId: id,
      cinemaId: 'malba',
      startsAtUtc: at('2026-06-05T23:00:00Z'),
      createdAt: old,
      ...extra,
    });
  const lpf = (...ids: number[]) => new Map(ids.map((id) => [id, beyond] as const));

  it('Argentinian film fills the AR slot', () => {
    const picks = deriveFeatured([mk(1, { country: 'AR' })], lpf(1), windowUpper, NOW);
    expect(picks[0].reason).toBe('argentina');
    expect(picks[0].reasonLabel).toBe('Cine argentino');
  });

  it('premiere = this-year OR premiere tag → Estreno', () => {
    const byYear = deriveFeatured([mk(1, { year: 2026 })], lpf(1), windowUpper, NOW);
    expect(byYear[0].reason).toBe('estreno');
    const byTag = deriveFeatured([mk(2, { tags: ['premiere'] })], lpf(2), windowUpper, NOW);
    expect(byTag[0].reason).toBe('estreno');
  });

  it('classic = old + enough votes; the vote floor excludes obscure-old', () => {
    const classic = deriveFeatured(
      [mk(1, { year: 1965, voteCount: 5000 })],
      lpf(1),
      windowUpper,
      NOW,
    );
    expect(classic[0].reason).toBe('clasico');
    expect(classic[0].reasonLabel).toBe('Clásico');
    // Old but barely-voted → NOT classic; falls through (here, to destacada).
    const obscure = deriveFeatured(
      [mk(2, { year: 1965, voteCount: 12 })],
      lpf(2),
      windowUpper,
      NOW,
    );
    expect(obscure[0].reason).not.toBe('clasico');
  });

  it('wildcard chain: última > nuevo > mundo', () => {
    // última: last screening within the window
    const ultima = deriveFeatured([mk(1)], new Map([[1, windowUpper.getTime() - 1]]), windowUpper, NOW);
    expect(ultima[0].reason).toBe('ultima');
    // nuevo: created recently, not última, no fixed-slot fit
    const nuevo = deriveFeatured([mk(2, { createdAt: at('2026-06-02T00:00:00Z') })], lpf(2), windowUpper, NOW);
    expect(nuevo[0].reason).toBe('nuevo');
    // mundo: non-AR/US country, not última/nuevo/fixed
    const mundo = deriveFeatured([mk(3, { country: 'FR' })], lpf(3), windowUpper, NOW);
    expect(mundo[0].reason).toBe('mundo');
  });

  it('fills four distinct slots when one film matches each axis', () => {
    const picks = deriveFeatured(
      [
        mk(1, { country: 'AR' }),
        mk(2, { year: 2026 }),
        mk(3, { year: 1970, voteCount: 8000 }),
        mk(4, { country: 'FR' }),
      ],
      lpf(1, 2, 3, 4),
      windowUpper,
      NOW,
    );
    expect(picks).toHaveLength(4);
    expect(new Set(picks.map((p) => p.reason))).toEqual(
      new Set(['argentina', 'estreno', 'clasico', 'mundo']),
    );
  });

  it('an empty AR slot falls back to the wildcard chain (band still fills, no argentina)', () => {
    const picks = deriveFeatured(
      [
        mk(2, { year: 2026 }),
        mk(3, { year: 1970, voteCount: 8000 }),
        mk(4, { country: 'FR', popularity: 10 }),
        mk(5, { country: 'BR', popularity: 90 }),
      ],
      lpf(2, 3, 4, 5),
      windowUpper,
      NOW,
    );
    expect(picks).toHaveLength(4);
    expect(picks.some((p) => p.reason === 'argentina')).toBe(false);
  });

  it('assign-once: an AR premiere fills the AR slot; the premiere slot takes a different film', () => {
    const picks = deriveFeatured(
      [
        mk(1, { country: 'AR', year: 2026 }), // eligible for both AR + estreno
        mk(2, { year: 2026 }), // estreno only
      ],
      lpf(1, 2),
      windowUpper,
      NOW,
    );
    const f1 = picks.find((p) => p.film.id === 1)!;
    const f2 = picks.find((p) => p.film.id === 2)!;
    expect(f1.reason).toBe('argentina'); // slot 1 wins the overlap
    expect(f2.reason).toBe('estreno');
  });

  it('a slot picks the highest-ranked eligible film (AR by popularity, classic by votes)', () => {
    const ar = deriveFeatured(
      [mk(1, { country: 'AR', popularity: 10 }), mk(2, { country: 'AR', popularity: 90 })],
      lpf(1, 2),
      windowUpper,
      NOW,
    );
    expect(ar.find((p) => p.reason === 'argentina')!.film.id).toBe(2);
    const classic = deriveFeatured(
      [mk(1, { year: 1970, voteCount: 2000 }), mk(2, { year: 1970, voteCount: 9000 })],
      lpf(1, 2),
      windowUpper,
      NOW,
    );
    expect(classic.find((p) => p.reason === 'clasico')!.film.id).toBe(2);
  });

  it('caps at 4 even with more qualifying films', () => {
    const rows = [1, 2, 3, 4, 5, 6].map((id) => mk(id, { country: 'FR' }));
    const picks = deriveFeatured(rows, lpf(1, 2, 3, 4, 5, 6), windowUpper, NOW);
    expect(picks).toHaveLength(4);
  });

  it('returns [] for empty rows', () => {
    expect(deriveFeatured([], new Map(), windowUpper, NOW)).toEqual([]);
  });

  it('drops a film with no future screening (not catchable)', () => {
    const picks = deriveFeatured([mk(1, { country: 'AR' })], new Map(), windowUpper, NOW);
    expect(picks).toEqual([]);
  });

  it('drops an unenriched film (no poster) — never SIN AFICHE in the band', () => {
    const picks = deriveFeatured(
      [mk(1, { country: 'AR', posterUrl: null })],
      lpf(1),
      windowUpper,
      NOW,
    );
    expect(picks).toEqual([]);
  });
});

describe('formatDayChipBA', () => {
  // now = Thu 2026-06-04 12:00 BA.
  it('returns "Hoy" for a showtime on the same BA day', () => {
    expect(formatDayChipBA(at('2026-06-04T23:00:00Z'), NOW)).toBe('Hoy');
  });

  it('returns capitalized "{Dow} {day}" for another day, no trailing dot', () => {
    // Fri 2026-06-05 20:00 BA.
    expect(formatDayChipBA(at('2026-06-05T23:00:00Z'), NOW)).toBe('Vie 5');
  });
});

// ---------------------------------------------------------------------------
// Integration — in-memory DB
// ---------------------------------------------------------------------------
async function seedCinema(id: string): Promise<void> {
  await testDb.insert(cinemas).values({ id, name: id.toUpperCase(), type: 'indie' });
}

async function seedFilm(
  title: string,
  opts: {
    posterUrl?: string | null;
    country?: string | null;
    year?: number | null;
    popularity?: number | null;
    voteCount?: number | null;
    createdAt?: Date;
  } = {},
): Promise<number> {
  const [row] = await testDb
    .insert(films)
    .values({
      title,
      scrapedTitle: title,
      matchSource: 'none',
      posterUrl:
        opts.posterUrl === undefined ? 'https://image.tmdb.org/t/p/w342/x.jpg' : opts.posterUrl,
      country: opts.country ?? null,
      year: opts.year ?? null,
      popularity: opts.popularity ?? null,
      voteCount: opts.voteCount ?? null,
      // Default OLD so seeded films aren't "nuevo" against a past fixture now.
      createdAt: opts.createdAt ?? new Date('2026-01-01T00:00:00Z'),
    })
    .returning({ id: films.id });
  return row.id;
}

async function seedScreening(
  filmId: number,
  cinemaId: string,
  startsAtUtc: Date,
  extra: { tags?: ScreeningTag[]; programName?: string } = {},
): Promise<void> {
  await testDb.insert(screenings).values({
    filmId,
    cinemaId,
    startsAtUtc,
    tags: extra.tags ?? [],
    programName: extra.programName,
  });
}

describe('getWindowScreeningsByFilm — integration', () => {
  beforeEach(async () => {
    testDb = await makeInMemoryDb();
  });

  it('hoy dedups a film with two same-day showtimes into one group', async () => {
    await seedCinema('lugones');
    const a = await seedFilm('El Jockey');
    const b = await seedFilm('Perfect Days');
    // now = Thu 2026-06-04 12:00 BA.
    const now = new Date(Date.UTC(2026, 5, 4, 15));
    await seedScreening(a, 'lugones', new Date(Date.UTC(2026, 5, 4, 23))); // today 20:00 BA
    await seedScreening(a, 'lugones', new Date(Date.UTC(2026, 5, 5, 0, 30))); // today 21:30 BA
    await seedScreening(b, 'lugones', new Date(Date.UTC(2026, 5, 4, 22))); // today 19:00 BA

    const groups = await getWindowScreeningsByFilm('hoy', now);
    expect(groups).toHaveLength(2);
    const jockey = groups.find((g) => g.film.id === a)!;
    expect(jockey.totalCount).toBe(2);
    expect(jockey.byVenue).toHaveLength(1);
  });

  it('hoy excludes tomorrow; semana includes it', async () => {
    await seedCinema('malba');
    const f = await seedFilm('Tótem');
    const now = new Date(Date.UTC(2026, 5, 4, 15));
    await seedScreening(f, 'malba', new Date(Date.UTC(2026, 5, 5, 23))); // tomorrow 20:00 BA

    expect(await getWindowScreeningsByFilm('hoy', now)).toHaveLength(0);
    expect(await getWindowScreeningsByFilm('semana', now)).toHaveLength(1);
  });

  it('drops films whose every showtime in the window has already passed', async () => {
    await seedCinema('malba');
    const now = new Date(Date.UTC(2026, 5, 4, 15)); // 12:00 BA
    const past = await seedFilm('Ya pasó');
    await seedScreening(past, 'malba', new Date(Date.UTC(2026, 5, 4, 10))); // 07:00 BA — expired
    const live = await seedFilm('Todavía dan');
    await seedScreening(live, 'malba', new Date(Date.UTC(2026, 5, 4, 23))); // 20:00 BA — catchable

    const groups = await getWindowScreeningsByFilm('hoy', now);
    expect(groups.map((g) => g.film.id)).toEqual([live]); // the all-past film is gone
  });

  it('keeps a partially-expired film and retains its past showtimes (struck in UI)', async () => {
    await seedCinema('malba');
    const now = new Date(Date.UTC(2026, 5, 4, 15));
    const f = await seedFilm('Mixta');
    await seedScreening(f, 'malba', new Date(Date.UTC(2026, 5, 4, 10))); // past
    await seedScreening(f, 'malba', new Date(Date.UTC(2026, 5, 4, 23))); // catchable

    const groups = await getWindowScreeningsByFilm('hoy', now);
    expect(groups).toHaveLength(1);
    expect(groups[0].totalCount).toBe(2);
  });
});

describe('getFeaturedFilms — integration', () => {
  beforeEach(async () => {
    testDb = await makeInMemoryDb();
  });

  it('fills the band from real data: AR / premiere / classic slots', async () => {
    await seedCinema('malba');
    const now = new Date(Date.UTC(2026, 5, 4, 15)); // Thu 12:00 BA

    const ar = await seedFilm('El Jockey', { country: 'AR' });
    const premiere = await seedFilm('Estreno X', { year: 2026 });
    const classic = await seedFilm('Stalker', { year: 1979, voteCount: 6000 });
    for (const id of [ar, premiere, classic]) {
      await seedScreening(id, 'malba', new Date(Date.UTC(2026, 5, 6, 23))); // this week
    }

    const picks = await getFeaturedFilms(now);
    const byId = new Map(picks.map((p) => [p.film.id, p.reason]));
    expect(byId.get(ar)).toBe('argentina');
    expect(byId.get(premiere)).toBe('estreno');
    expect(byId.get(classic)).toBe('clasico');
  });

  it('a single-this-week film with no other signal → última (wildcard)', async () => {
    await seedCinema('malba');
    const now = new Date(Date.UTC(2026, 5, 4, 15));
    const f = await seedFilm('La Quimera'); // null country/year, old createdAt
    await seedScreening(f, 'malba', new Date(Date.UTC(2026, 5, 6, 22))); // only this week
    const picks = await getFeaturedFilms(now);
    expect(picks).toHaveLength(1);
    expect(picks[0].reason).toBe('ultima');
  });

  it('excludes an unenriched (posterless) film even with a premiere tag', async () => {
    await seedCinema('malba');
    const now = new Date(Date.UTC(2026, 5, 4, 15));
    const noPoster = await seedFilm('Las Mantis', { posterUrl: null, country: 'AR' });
    await seedScreening(noPoster, 'malba', new Date(Date.UTC(2026, 5, 6, 23)), {
      tags: ['premiere'],
    });
    expect(await getFeaturedFilms(now)).toEqual([]);
  });

  it('returns [] when no film passes the gates', async () => {
    await seedCinema('malba');
    const now = new Date(Date.UTC(2026, 5, 4, 15));
    // Poster-less + only a past screening → fails both gates.
    const f = await seedFilm('Ghost', { posterUrl: null });
    await seedScreening(f, 'malba', new Date(Date.UTC(2026, 5, 4, 10))); // already passed
    expect(await getFeaturedFilms(now)).toEqual([]);
  });
});

describe('getJsonLdScreenings — integration', () => {
  beforeEach(async () => {
    testDb = await makeInMemoryDb();
  });

  it('returns only the [todayStart, +7d) window regardless of selected ventana', async () => {
    await seedCinema('malba');
    const now = new Date(Date.UTC(2026, 5, 4, 15)); // Thu 12:00 BA → upper = 2026-06-11 03:00Z
    const f = await seedFilm('Film');
    await seedScreening(f, 'malba', new Date(Date.UTC(2026, 5, 4, 23))); // today — in
    await seedScreening(f, 'malba', new Date(Date.UTC(2026, 5, 10, 23))); // +6d — in
    await seedScreening(f, 'malba', new Date(Date.UTC(2026, 5, 11, 12))); // +7d (>= upper) — out
    expect(await getJsonLdScreenings(now)).toHaveLength(2);
  });
});
