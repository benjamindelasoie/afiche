import { and, eq, sql } from 'drizzle-orm';
import { db, cinemas, scrapeRuns, films, screenings } from '@/db';
import { verifySession } from '@/lib/admin-dal';
import { enrichPendingAction } from './actions';
import { RefreshButton } from './refresh-button';

export const metadata = {
  title: 'Runs · Admin · afiche',
  robots: { index: false, follow: false },
};

// Scrape runs change on every scrape; pending count changes on every assign
// or enrich. No ISR / static cache for admin views.
export const dynamic = 'force-dynamic';

// Enrich + refresh can run >60s on a cold catalog (300+ TMDB calls at 100ms
// throttle plus per-call latency). 300s is Vercel's default; explicit for
// clarity since this route's actions are the long pole.
export const maxDuration = 300;

interface CinemaRunRow {
  cinemaId: string;
  cinemaName: string;
  runId: number | null;
  status: 'in-progress' | 'success' | 'failure' | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  screeningsScraped: number | null;
  screeningsInserted: number | null;
  filmsUpserted: number | null;
  filmsEnriched: number | null;
  enrichSkipped: number | null;
  error: string | null;
  warnings: string[];
}

/**
 * Latest scrape_runs row per cinema, plus cinemas that have never been
 * scraped (LEFT JOIN). The correlated subquery on `id` keeps the join
 * single-row per cinema; ordering by cinema name gives a stable display.
 */
async function fetchLatestRunPerCinema(): Promise<CinemaRunRow[]> {
  const rows = await db
    .select({
      cinemaId: cinemas.id,
      cinemaName: cinemas.name,
      runId: scrapeRuns.id,
      status: scrapeRuns.status,
      startedAt: scrapeRuns.startedAt,
      finishedAt: scrapeRuns.finishedAt,
      durationMs: scrapeRuns.durationMs,
      screeningsScraped: scrapeRuns.screeningsScraped,
      screeningsInserted: scrapeRuns.screeningsInserted,
      filmsUpserted: scrapeRuns.filmsUpserted,
      filmsEnriched: scrapeRuns.filmsEnriched,
      enrichSkipped: scrapeRuns.enrichSkipped,
      error: scrapeRuns.error,
      warnings: scrapeRuns.warnings,
    })
    .from(cinemas)
    .leftJoin(
      scrapeRuns,
      eq(
        scrapeRuns.id,
        sql<number>`(SELECT id FROM scrape_runs WHERE cinema_id = ${cinemas.id} ORDER BY started_at DESC LIMIT 1)`,
      ),
    )
    .orderBy(cinemas.name);

  return rows.map((r) => ({
    ...r,
    warnings: r.warnings ?? [],
  }));
}

/**
 * Films with no TMDB id, not operator-flagged as non-films, that have at
 * least one future screening — the pool the "Enrich pending" button
 * targets. Single count for the page header stat.
 */
async function fetchPendingEnrichmentCount(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`COUNT(DISTINCT ${films.id})` })
    .from(films)
    .innerJoin(screenings, eq(screenings.filmId, films.id))
    .where(
      and(
        sql`${films.tmdbId} IS NULL`,
        eq(films.skipTmdb, false),
        sql`${screenings.startsAtUtc} >= unixepoch()`,
      ),
    );
  return row?.count ?? 0;
}

interface PageProps {
  searchParams: Promise<{ result?: string; counts?: string; errors?: string }>;
}

export default async function RunsPage({ searchParams }: PageProps) {
  await verifySession();
  const sp = await searchParams;
  const [runs, pendingCount] = await Promise.all([
    fetchLatestRunPerCinema(),
    fetchPendingEnrichmentCount(),
  ]);

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Scrape runs</h1>
        <p className="text-sm text-neutral-500">{runs.length} cinemas</p>
      </header>

      {sp.result ? (
        <ResultBanner result={sp.result} counts={sp.counts} errors={sp.errors} />
      ) : null}

      <div className="flex flex-col gap-3 rounded border border-neutral-200 bg-neutral-50 p-4">
        <p className="text-sm text-neutral-700">
          {pendingCount === 0
            ? 'No films waiting for an enrichment pass.'
            : `${pendingCount} film${pendingCount === 1 ? '' : 's'} with no TMDB id and a future screening.`}
        </p>
        <div className="flex flex-wrap gap-2">
          <form action={enrichPendingAction}>
            <button
              type="submit"
              className="rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
              disabled={pendingCount === 0}
            >
              Enrich pending
            </button>
          </form>
          <RefreshButton />
        </div>
        <p className="text-xs text-neutral-500">
          Scrape triggers are deferred — Vercel egress IPs are blocked by some venues
          (notably MALBA). See TODO #27 for the residential-egress daemon that unblocks
          them.
        </p>
      </div>

      <ul className="divide-y divide-neutral-200 rounded border border-neutral-200">
        {runs.map((r) => (
          <li key={r.cinemaId} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-4">
              <div className="flex items-baseline gap-2">
                <h2 className="text-base font-medium">{r.cinemaName}</h2>
                <span className="text-xs tracking-wide text-neutral-400 uppercase">
                  {r.cinemaId}
                </span>
              </div>
              <StatusBadge status={r.status} />
            </div>
            {r.runId === null ? (
              <p className="mt-1 text-sm text-neutral-500 italic">never scraped</p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-neutral-600">
                <span>
                  {r.finishedAt
                    ? formatDateTime(r.finishedAt)
                    : formatDateTime(r.startedAt!)}
                </span>
                {r.durationMs !== null ? (
                  <span>· {formatDuration(r.durationMs)}</span>
                ) : null}
                {r.status === 'success' ? (
                  <>
                    <span>· scraped {r.screeningsScraped ?? 0}</span>
                    <span>· inserted {r.screeningsInserted ?? 0}</span>
                    <span>· films {r.filmsUpserted ?? 0}</span>
                    <span>
                      · enriched {r.filmsEnriched ?? 0}/
                      {(r.filmsEnriched ?? 0) + (r.enrichSkipped ?? 0)}
                    </span>
                  </>
                ) : null}
              </div>
            )}
            {r.error ? (
              <p className="mt-2 rounded bg-red-50 px-2 py-1 font-mono text-xs text-red-900">
                {r.error}
              </p>
            ) : null}
            {r.warnings.length > 0 ? (
              <details className="mt-2 text-xs text-neutral-600">
                <summary className="cursor-pointer">
                  {r.warnings.length} warning{r.warnings.length === 1 ? '' : 's'}
                </summary>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {r.warnings.slice(0, 20).map((w, i) => (
                    <li key={i} className="font-mono">
                      {w}
                    </li>
                  ))}
                  {r.warnings.length > 20 ? (
                    <li className="italic">…and {r.warnings.length - 20} more</li>
                  ) : null}
                </ul>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusBadge({ status }: { status: CinemaRunRow['status'] }) {
  if (status === null) {
    return <span className="text-xs tracking-wide text-neutral-400 uppercase">—</span>;
  }
  const styles: Record<NonNullable<CinemaRunRow['status']>, string> = {
    'in-progress': 'bg-amber-100 text-amber-900',
    success: 'bg-emerald-100 text-emerald-900',
    failure: 'bg-red-100 text-red-900',
  };
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-medium tracking-wide uppercase ${styles[status]}`}
    >
      {status}
    </span>
  );
}

function ResultBanner({
  result,
  counts,
  errors,
}: {
  result: string;
  counts?: string;
  errors?: string;
}) {
  const isError = errors === '1';
  return (
    <div
      className={`rounded px-3 py-2 text-sm ${
        isError ? 'bg-red-50 text-red-900' : 'bg-emerald-50 text-emerald-900'
      }`}
    >
      <strong>{result}</strong>
      {counts ? <span className="ml-2 font-mono text-xs">{counts}</span> : null}
    </div>
  );
}

function formatDateTime(d: Date): string {
  return d.toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}min`;
}
