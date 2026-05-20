import Link from 'next/link';
import { and, eq, sql } from 'drizzle-orm';
import { db, films, screenings, cinemas } from '@/db';
import { verifySession } from '@/lib/admin-dal';

export const metadata = {
  title: 'Unmatched · Admin · Afiche',
  robots: { index: false, follow: false },
};

// Force dynamic — operator pool changes after every scrape + every assign.
// No ISR / static cache for admin views.
export const dynamic = 'force-dynamic';

interface PendingRow {
  id: number;
  scrapedTitle: string;
  scrapedYear: number | null;
  director: string | null;
  matchSource: 'auto' | 'override' | 'manual' | 'none' | 'none-attempted';
  futureCount: number;
  venues: string;
}

async function fetchPendingFilms(): Promise<PendingRow[]> {
  // Films with no TMDB id, not operator-flagged as non-films, that have
  // at least one future screening. JOIN screenings + cinemas, aggregate
  // per film for the count + venue list. Drizzle's sql template handles
  // the GROUP_CONCAT (SQLite-specific) cleanly enough.
  const rows = await db
    .select({
      id: films.id,
      scrapedTitle: films.scrapedTitle,
      scrapedYear: films.scrapedYear,
      director: films.director,
      matchSource: films.matchSource,
      futureCount: sql<number>`COUNT(${screenings.id})`.as('future_count'),
      venues: sql<string>`COALESCE(GROUP_CONCAT(DISTINCT ${cinemas.name}), '')`.as('venues'),
    })
    .from(films)
    .innerJoin(screenings, eq(screenings.filmId, films.id))
    .innerJoin(cinemas, eq(cinemas.id, screenings.cinemaId))
    .where(
      and(
        sql`${films.tmdbId} IS NULL`,
        eq(films.skipTmdb, false),
        sql`${screenings.startsAtUtc} >= unixepoch()`,
      ),
    )
    .groupBy(films.id)
    .orderBy(sql`COUNT(${screenings.id}) DESC, ${films.scrapedTitle} ASC`);

  return rows;
}

export default async function UnmatchedPage() {
  await verifySession();
  const rows = await fetchPendingFilms();

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Unmatched films</h1>
        <p className="text-sm text-neutral-500">
          {rows.length === 0
            ? 'all caught up'
            : `${rows.length} film${rows.length === 1 ? '' : 's'} waiting for a TMDB match`}
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded border border-neutral-200 bg-neutral-50 p-6 text-center text-neutral-600">
          <p className="text-base">No pending films.</p>
          <p className="text-sm">Every film with a future screening has a TMDB id.</p>
        </div>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded border border-neutral-200">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/admin/unmatched/${r.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-neutral-50"
              >
                <div className="flex-1">
                  <div className="text-base font-medium">
                    {r.scrapedTitle}
                    {r.scrapedYear ? (
                      <span className="ml-2 text-neutral-500">({r.scrapedYear})</span>
                    ) : null}
                  </div>
                  <div className="text-sm text-neutral-500">
                    {r.director ? <span>{r.director}</span> : <span className="italic">no director</span>}
                    <span className="mx-2">·</span>
                    <span>{r.venues}</span>
                    <span className="mx-2">·</span>
                    <span>
                      {r.futureCount} future screening{r.futureCount === 1 ? '' : 's'}
                    </span>
                    <span className="mx-2">·</span>
                    <span className="text-xs uppercase tracking-wide text-neutral-400">
                      {r.matchSource}
                    </span>
                  </div>
                </div>
                <span className="text-neutral-400">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
