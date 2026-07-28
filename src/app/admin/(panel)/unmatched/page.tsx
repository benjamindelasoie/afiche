import Link from 'next/link';
import { and, desc, eq, isNull, isNotNull, sql } from 'drizzle-orm';
import { db, films, screenings, cinemas } from '@/db';
import { verifySession } from '@/lib/admin-dal';
import { hideFilmAction, unhideFilmAction } from './actions';

export const metadata = {
  title: 'Unmatched · Admin · afiche',
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
      venues: sql<string>`COALESCE(GROUP_CONCAT(DISTINCT ${cinemas.name}), '')`.as(
        'venues',
      ),
    })
    .from(films)
    .innerJoin(screenings, eq(screenings.filmId, films.id))
    .innerJoin(cinemas, eq(cinemas.id, screenings.cinemaId))
    .where(
      and(
        sql`${films.tmdbId} IS NULL`,
        eq(films.skipTmdb, false),
        isNull(films.hiddenAt),
        sql`${screenings.startsAtUtc} >= unixepoch()`,
      ),
    )
    .groupBy(films.id)
    .orderBy(sql`COUNT(${screenings.id}) DESC, ${films.scrapedTitle} ASC`);

  return rows;
}

interface HiddenRow {
  id: number;
  scrapedTitle: string;
  scrapedYear: number | null;
  hiddenAt: Date | null;
}

/**
 * Hidden films, newest first. Listed so hiding stays auditable and
 * reversible — an operator can see exactly what has been suppressed and put
 * anything back. Not restricted to future screenings: a row hidden last month
 * should still be findable after its screenings lapse.
 */
async function fetchHiddenFilms(): Promise<HiddenRow[]> {
  return db
    .select({
      id: films.id,
      scrapedTitle: films.scrapedTitle,
      scrapedYear: films.scrapedYear,
      hiddenAt: films.hiddenAt,
    })
    .from(films)
    .where(isNotNull(films.hiddenAt))
    .orderBy(desc(films.hiddenAt));
}

export default async function UnmatchedPage() {
  await verifySession();
  const [rows, hidden] = await Promise.all([fetchPendingFilms(), fetchHiddenFilms()]);

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
            // The hide form is a SIBLING of the Link, not a child — a button
            // nested inside an anchor is invalid HTML and swallows the click.
            <li key={r.id} className="flex items-center gap-2 pr-3 hover:bg-neutral-50">
              <Link
                href={`/admin/unmatched/${r.id}`}
                className="flex flex-1 items-center justify-between gap-4 px-4 py-3"
              >
                <div className="flex-1">
                  <div className="text-base font-medium">
                    {r.scrapedTitle}
                    {r.scrapedYear ? (
                      <span className="ml-2 text-neutral-500">({r.scrapedYear})</span>
                    ) : null}
                  </div>
                  <div className="text-sm text-neutral-500">
                    {r.director ? (
                      <span>{r.director}</span>
                    ) : (
                      <span className="italic">no director</span>
                    )}
                    <span className="mx-2">·</span>
                    <span>{r.venues}</span>
                    <span className="mx-2">·</span>
                    <span>
                      {r.futureCount} future screening{r.futureCount === 1 ? '' : 's'}
                    </span>
                    <span className="mx-2">·</span>
                    <span className="text-xs tracking-wide text-neutral-400 uppercase">
                      {r.matchSource}
                    </span>
                  </div>
                </div>
                <span className="text-neutral-400">→</span>
              </Link>
              <form action={hideFilmAction}>
                <input type="hidden" name="filmId" value={r.id} />
                <button
                  type="submit"
                  className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:border-neutral-400 hover:bg-white hover:text-neutral-900"
                  title="Hide from the public cartelera (also stops TMDB lookups). Reversible."
                >
                  Ocultar
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {hidden.length > 0 ? (
        <details className="rounded border border-neutral-200">
          <summary className="cursor-pointer px-4 py-3 text-sm text-neutral-600">
            Ocultos ({hidden.length}) — no aparecen en la cartelera
          </summary>
          <ul className="divide-y divide-neutral-200 border-t border-neutral-200">
            {hidden.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between gap-4 px-4 py-2"
              >
                <div className="text-sm">
                  <span className="text-neutral-700">{h.scrapedTitle}</span>
                  {h.scrapedYear ? (
                    <span className="ml-2 text-neutral-400">({h.scrapedYear})</span>
                  ) : null}
                  {h.hiddenAt ? (
                    <span className="ml-2 text-xs text-neutral-400">
                      oculto {h.hiddenAt.toISOString().slice(0, 10)}
                    </span>
                  ) : null}
                </div>
                <form action={unhideFilmAction}>
                  <input type="hidden" name="filmId" value={h.id} />
                  <button
                    type="submit"
                    className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:border-neutral-400 hover:bg-white hover:text-neutral-900"
                    title="Restore to the cartelera and re-enable TMDB enrichment."
                  >
                    Mostrar
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
