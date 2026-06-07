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
      year: null,
      country: null,
      runtimeMin: null,
      synopsisEs: null,
      posterUrl: null,
      backdropUrl: null,
      slug: opts.slug === undefined ? `film-${opts.filmId}` : opts.slug,
      cast: null,
      genres: null,
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

describe('deriveFeatured — selection rules', () => {
  // semana window upper for these tests.
  const windowUpper = at('2026-06-11T03:00:00Z');

  // Last screening 3 weeks out → film is catchable (passes the future-screening
  // gate) but NOT última, isolating the premiere/ciclo reasons.
  const beyond = at('2026-06-25T23:00:00Z').getTime();

  it('premiere tag → Estreno', () => {
    const picks = deriveFeatured(
      [mkRow({ filmId: 1, cinemaId: 'malba', startsAtUtc: at('2026-06-05T23:00:00Z'), tags: ['premiere'] })],
      new Map([[1, beyond]]),
      windowUpper,
    );
    expect(picks).toHaveLength(1);
    expect(picks[0].reason).toBe('estreno');
    expect(picks[0].reasonLabel).toBe('Estreno');
  });

  it('última only when the unbounded last screening falls inside the window', () => {
    const inside = deriveFeatured(
      [mkRow({ filmId: 1, cinemaId: 'malba', startsAtUtc: at('2026-06-05T23:00:00Z') })],
      new Map([[1, at('2026-06-06T23:00:00Z').getTime()]]), // last is within window
      windowUpper,
    );
    expect(inside[0]?.reason).toBe('ultima');

    const beyond = deriveFeatured(
      [mkRow({ filmId: 1, cinemaId: 'malba', startsAtUtc: at('2026-06-05T23:00:00Z') })],
      new Map([[1, at('2026-06-25T23:00:00Z').getTime()]]), // last is 3 weeks out → NOT última
      windowUpper,
    );
    expect(beyond).toEqual([]);
  });

  it('programName → "Ciclo {name}"', () => {
    const picks = deriveFeatured(
      [mkRow({ filmId: 1, cinemaId: 'malba', startsAtUtc: at('2026-06-05T23:00:00Z'), programName: 'Retrospectiva Wenders' })],
      new Map([[1, beyond]]),
      windowUpper,
    );
    expect(picks[0].reason).toBe('ciclo');
    expect(picks[0].reasonLabel).toBe('Ciclo Retrospectiva Wenders');
  });

  it('priority Estreno > Última > Ciclo for a single film', () => {
    // Film qualifies for all three; estreno must win.
    const picks = deriveFeatured(
      [
        mkRow({
          filmId: 1,
          cinemaId: 'malba',
          startsAtUtc: at('2026-06-05T23:00:00Z'),
          tags: ['premiere'],
          programName: 'Ciclo X',
        }),
      ],
      new Map([[1, at('2026-06-06T23:00:00Z').getTime()]]),
      windowUpper,
    );
    expect(picks).toHaveLength(1);
    expect(picks[0].reason).toBe('estreno');
  });

  it('caps at 4 picks, estrenos sorted ahead', () => {
    const rows = [
      ...[1, 2, 3].map((id) =>
        mkRow({ filmId: id, cinemaId: 'malba', startsAtUtc: at('2026-06-05T23:00:00Z'), programName: 'Ciclo' }),
      ),
      ...[4, 5, 6].map((id) =>
        mkRow({ filmId: id, cinemaId: 'malba', startsAtUtc: at('2026-06-05T23:00:00Z'), tags: ['premiere'] }),
      ),
    ];
    const lastPerFilm = new Map([1, 2, 3, 4, 5, 6].map((id) => [id, beyond] as const));
    const picks = deriveFeatured(rows, lastPerFilm, windowUpper);
    expect(picks).toHaveLength(4);
    // The three estrenos sort before any ciclo.
    expect(picks.slice(0, 3).every((p) => p.reason === 'estreno')).toBe(true);
  });

  it('returns [] when nothing qualifies (band omitted)', () => {
    const picks = deriveFeatured(
      [mkRow({ filmId: 1, cinemaId: 'malba', startsAtUtc: at('2026-06-05T23:00:00Z') })],
      new Map([[1, at('2026-06-25T23:00:00Z').getTime()]]),
      windowUpper,
    );
    expect(picks).toEqual([]);
  });

  it('returns [] for empty rows', () => {
    expect(deriveFeatured([], new Map(), windowUpper)).toEqual([]);
  });

  it('última is exclusive at the window upper bound', () => {
    const row = [mkRow({ filmId: 1, cinemaId: 'malba', startsAtUtc: at('2026-06-05T23:00:00Z') })];
    // Last screening exactly AT the exclusive upper → NOT última.
    expect(deriveFeatured(row, new Map([[1, windowUpper.getTime()]]), windowUpper)).toEqual([]);
    // One ms before the upper → última.
    const justInside = deriveFeatured(
      row,
      new Map([[1, windowUpper.getTime() - 1]]),
      windowUpper,
    );
    expect(justInside[0]?.reason).toBe('ultima');
  });

  it('drops a film with no FUTURE screening even if it has a premiere tag', () => {
    // Premiere tag present, but absent from lastPerFilm (every showtime passed)
    // → not catchable → excluded from the band.
    const picks = deriveFeatured(
      [mkRow({ filmId: 1, cinemaId: 'malba', startsAtUtc: at('2026-06-04T10:00:00Z'), tags: ['premiere'] })],
      new Map(),
      windowUpper,
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

async function seedFilm(title: string): Promise<number> {
  const [row] = await testDb
    .insert(films)
    .values({ title, scrapedTitle: title, matchSource: 'none' })
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
});

describe('getFeaturedFilms — integration', () => {
  beforeEach(async () => {
    testDb = await makeInMemoryDb();
  });

  it('flags a premiere this week as Estreno, and última only when truly last', async () => {
    await seedCinema('malba');
    const now = new Date(Date.UTC(2026, 5, 4, 15)); // Thu 12:00 BA

    const estreno = await seedFilm('El Jockey');
    await seedScreening(estreno, 'malba', new Date(Date.UTC(2026, 5, 6, 23)), { tags: ['premiere'] });

    // Única: only screening is this week → última.
    const ultima = await seedFilm('La Quimera');
    await seedScreening(ultima, 'malba', new Date(Date.UTC(2026, 5, 6, 22)));

    // Has a screening this week AND one 3 weeks out → NOT última, no other reason.
    const notLast = await seedFilm('Los delincuentes');
    await seedScreening(notLast, 'malba', new Date(Date.UTC(2026, 5, 5, 23)));
    await seedScreening(notLast, 'malba', new Date(Date.UTC(2026, 5, 25, 23)));

    const picks = await getFeaturedFilms(now);
    const byId = new Map(picks.map((p) => [p.film.id, p.reason]));
    expect(byId.get(estreno)).toBe('estreno');
    expect(byId.get(ultima)).toBe('ultima');
    expect(byId.has(notLast)).toBe(false);
  });

  it('returns [] when nothing qualifies', async () => {
    await seedCinema('malba');
    const now = new Date(Date.UTC(2026, 5, 4, 15));
    const f = await seedFilm('Ordinary Film');
    // This week + 3 weeks out, no tags, no program → no reason.
    await seedScreening(f, 'malba', new Date(Date.UTC(2026, 5, 5, 23)));
    await seedScreening(f, 'malba', new Date(Date.UTC(2026, 5, 25, 23)));
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
