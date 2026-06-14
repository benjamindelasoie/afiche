import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq, sql } from 'drizzle-orm';
import { db, films, screenings, cinemas } from '@/db';
import { verifySession } from '@/lib/admin-dal';
import { posterImageUrl, searchMovies, type TmdbMovieSummary } from '@/tmdb/client';
import { assignTmdbIdAction } from './actions';

export const metadata = {
  title: 'Assign · Admin · afiche',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; y?: string; error?: string; collision?: string }>;
}

interface FilmRow {
  id: number;
  scrapedTitle: string;
  scrapedYear: number | null;
  director: string | null;
  titleOriginal: string | null;
  matchSource: 'auto' | 'override' | 'manual' | 'none' | 'none-attempted';
  tmdbId: number | null;
}

interface ScreeningRow {
  startsAtUtc: Date;
  cinemaName: string;
  programName: string | null;
  sourceUrl: string | null;
}

async function fetchFilm(id: number): Promise<FilmRow | null> {
  const [row] = await db
    .select({
      id: films.id,
      scrapedTitle: films.scrapedTitle,
      scrapedYear: films.scrapedYear,
      director: films.director,
      titleOriginal: films.titleOriginal,
      matchSource: films.matchSource,
      tmdbId: films.tmdbId,
    })
    .from(films)
    .where(eq(films.id, id))
    .limit(1);
  return row ?? null;
}

async function fetchFutureScreenings(filmId: number): Promise<ScreeningRow[]> {
  return db
    .select({
      startsAtUtc: screenings.startsAtUtc,
      cinemaName: cinemas.name,
      programName: screenings.programName,
      sourceUrl: screenings.sourceUrl,
    })
    .from(screenings)
    .innerJoin(cinemas, eq(cinemas.id, screenings.cinemaId))
    .where(
      and(eq(screenings.filmId, filmId), sql`${screenings.startsAtUtc} >= unixepoch()`),
    )
    .orderBy(screenings.startsAtUtc);
}

export default async function UnmatchedDetailPage({ params, searchParams }: PageProps) {
  await verifySession();

  const { id: idStr } = await params;
  const filmId = Number.parseInt(idStr, 10);
  if (!Number.isFinite(filmId)) notFound();

  const film = await fetchFilm(filmId);
  if (!film) notFound();

  const { q, y, error, collision } = await searchParams;
  const screeningRows = await fetchFutureScreenings(film.id);

  // Run TMDB search if a query was submitted.
  let results: TmdbMovieSummary[] | null = null;
  let searchError: string | null = null;
  if (q && q.trim().length > 0) {
    try {
      const year = y ? Number.parseInt(y, 10) : undefined;
      results = await searchMovies(q.trim(), Number.isFinite(year) ? year : undefined);
    } catch (err) {
      searchError = err instanceof Error ? err.message : 'TMDB search failed';
    }
  }

  // Default search prefill: scraped title + scraped year.
  const defaultQ = q ?? film.scrapedTitle;
  const defaultY = y ?? (film.scrapedYear ? String(film.scrapedYear) : '');

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link
          href="/admin/unmatched"
          className="text-sm text-neutral-500 hover:underline"
        >
          ← Unmatched
        </Link>
        <h1 className="text-xl font-semibold">{film.scrapedTitle}</h1>
        <p className="text-sm text-neutral-600">
          {film.scrapedYear ?? 'no year'}
          {film.director ? <span> · {film.director}</span> : null}
          {film.titleOriginal ? <span> · {film.titleOriginal}</span> : null}
          <span> · </span>
          <span className="text-xs tracking-wide text-neutral-400 uppercase">
            {film.matchSource}
          </span>
        </p>
      </header>

      {/* Error banners from the assign action redirect. */}
      {error === 'already-patched' ? (
        <div
          role="alert"
          className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          This film was already patched (probably by another tab). Refresh the list to see
          the updated state.
        </div>
      ) : null}
      {error === 'tmdb-fetch-failed' ? (
        <div
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900"
        >
          TMDB rejected the lookup. The id might be wrong, or TMDB might be down. Try
          again.
        </div>
      ) : null}

      <FutureScreeningsBlock screenings={screeningRows} />

      <CollisionConfirmBlock collisionParam={collision} currentFilmId={film.id} />

      <SearchFormBlock filmId={film.id} defaultQ={defaultQ} defaultY={defaultY} />

      {searchError ? (
        <div
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900"
        >
          {searchError}
        </div>
      ) : null}

      {results !== null ? (
        <SearchResultsBlock filmId={film.id} results={results} />
      ) : null}

      <PasteIdEscapeHatch filmId={film.id} />
    </section>
  );
}

function FutureScreeningsBlock({ screenings }: { screenings: ScreeningRow[] }) {
  if (screenings.length === 0) {
    return <p className="text-sm text-neutral-500 italic">No future screenings.</p>;
  }
  const fmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return (
    <section className="rounded border border-neutral-200">
      <div className="border-b border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-medium">
        Future screenings ({screenings.length})
      </div>
      <ul className="divide-y divide-neutral-100">
        {screenings.map((s, idx) => (
          <li key={idx} className="flex items-baseline gap-3 px-3 py-2 text-sm">
            <span className="font-mono text-xs">{fmt.format(s.startsAtUtc)}</span>
            <span>{s.cinemaName}</span>
            {s.programName ? (
              <span className="text-neutral-500">· {s.programName}</span>
            ) : null}
            {s.sourceUrl ? (
              <a
                href={s.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-auto text-xs text-neutral-500 hover:underline"
              >
                source ↗
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SearchFormBlock({
  filmId,
  defaultQ,
  defaultY,
}: {
  filmId: number;
  defaultQ: string;
  defaultY: string;
}) {
  return (
    <form
      action={`/admin/unmatched/${filmId}`}
      method="GET"
      className="flex flex-col gap-2 rounded border border-neutral-200 p-3"
    >
      <div className="text-sm font-medium">Search TMDB</div>
      <div className="flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={defaultQ}
          required
          placeholder="Title"
          className="flex-1 rounded border border-neutral-300 px-3 py-2 text-base focus:border-neutral-600 focus:outline-none"
        />
        <input
          type="number"
          name="y"
          defaultValue={defaultY}
          placeholder="Year"
          className="w-24 rounded border border-neutral-300 px-3 py-2 text-base focus:border-neutral-600 focus:outline-none"
          min={1880}
          max={2100}
        />
        <button
          type="submit"
          className="rounded bg-neutral-900 px-4 py-2 text-base font-medium text-white hover:bg-neutral-700"
        >
          Search
        </button>
      </div>
    </form>
  );
}

function SearchResultsBlock({
  filmId,
  results,
}: {
  filmId: number;
  results: TmdbMovieSummary[];
}) {
  if (results.length === 0) {
    return (
      <p className="text-sm text-neutral-500 italic">
        No TMDB matches. Try different search terms, or use the paste-id escape hatch
        below.
      </p>
    );
  }
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium">TMDB results ({results.length})</h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {results.map((r) => (
          <li key={r.id} className="flex gap-3 rounded border border-neutral-200 p-3">
            {r.poster_path ? (
              // External image bypassing next/image — admin-only, low volume, no LCP concern.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={posterImageUrl(r.poster_path, 'w154') ?? ''}
                alt={`Poster: ${r.title}`}
                className="h-32 w-24 flex-shrink-0 rounded bg-neutral-200 object-cover"
                width={92}
                height={138}
              />
            ) : (
              <div className="flex h-32 w-24 flex-shrink-0 items-center justify-center rounded bg-neutral-200 text-xs text-neutral-500">
                no poster
              </div>
            )}
            <div className="flex flex-1 flex-col gap-1">
              <div className="text-base font-medium">
                {r.title}
                {r.release_date ? (
                  <span className="ml-2 text-sm text-neutral-500">
                    ({r.release_date.slice(0, 4)})
                  </span>
                ) : null}
              </div>
              {r.original_title !== r.title ? (
                <div className="text-xs text-neutral-500">{r.original_title}</div>
              ) : null}
              <p className="line-clamp-3 text-xs text-neutral-600">
                {r.overview || <span className="italic">(no overview)</span>}
              </p>
              <a
                href={`https://www.themoviedb.org/movie/${r.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-neutral-500 hover:underline"
              >
                tmdb #{r.id} ↗
              </a>
              <form action={assignTmdbIdAction} className="mt-1 flex">
                <input type="hidden" name="filmId" value={filmId} />
                <input type="hidden" name="tmdbId" value={r.id} />
                <button
                  type="submit"
                  className="mt-1 rounded bg-emerald-700 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-800"
                >
                  Assign tmdb #{r.id}
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PasteIdEscapeHatch({ filmId }: { filmId: number }) {
  return (
    <form
      action={assignTmdbIdAction}
      className="flex flex-col gap-2 rounded border border-dashed border-neutral-300 p-3"
    >
      <div className="text-sm font-medium">Paste TMDB id directly</div>
      <p className="text-xs text-neutral-500">
        Escape hatch when search fails or you already know the id (from themoviedb.org).
      </p>
      <div className="flex gap-2">
        <input type="hidden" name="filmId" value={filmId} />
        <input
          type="number"
          name="tmdbId"
          required
          placeholder="123456"
          className="flex-1 rounded border border-neutral-300 px-3 py-2 text-base focus:border-neutral-600 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded bg-neutral-900 px-4 py-2 text-base font-medium text-white hover:bg-neutral-700"
        >
          Assign
        </button>
      </div>
    </form>
  );
}

function CollisionConfirmBlock({
  collisionParam,
  currentFilmId,
}: {
  collisionParam: string | undefined;
  currentFilmId: number;
}) {
  // Encoded as: `${tmdbId}:${existingFilmId}:${existingSlug}:${existingTitle}`
  if (!collisionParam) return null;
  const decoded = decodeURIComponent(collisionParam);
  const parts = decoded.split(':');
  if (parts.length < 4) return null;
  const [tmdbIdStr, existingIdStr, existingSlug, ...titleParts] = parts;
  const tmdbId = Number.parseInt(tmdbIdStr, 10);
  const existingId = Number.parseInt(existingIdStr, 10);
  const existingTitle = titleParts.join(':');
  if (!Number.isFinite(tmdbId) || !Number.isFinite(existingId)) return null;

  const loserId = currentFilmId > existingId ? currentFilmId : existingId;
  const winnerId = currentFilmId > existingId ? existingId : currentFilmId;
  const loserIsCurrent = loserId === currentFilmId;

  return (
    <section className="rounded border border-amber-300 bg-amber-50 p-4">
      <h2 className="text-base font-semibold text-amber-900">TMDB id collision</h2>
      <p className="mt-1 text-sm text-amber-900">
        TMDB id <span className="font-mono">{tmdbId}</span> is already on{' '}
        <strong>{existingTitle}</strong> (slug:{' '}
        <code className="text-xs">{existingSlug}</code>).
      </p>
      <p className="mt-2 text-sm text-amber-900">
        {loserIsCurrent ? (
          <>
            Assigning will merge <strong>this film</strong> into the existing one. Its
            screenings will reparent to id {winnerId}; the URL{' '}
            <code>/pelicula/{`<this-slug>`}</code> will 404.
          </>
        ) : (
          <>
            Assigning will merge the existing film <strong>into this one</strong>. Its
            screenings will reparent here (id {winnerId}); the URL{' '}
            <code>/pelicula/{existingSlug}</code> will 404.
          </>
        )}
      </p>
      <form action={assignTmdbIdAction} className="mt-3 flex gap-2">
        <input type="hidden" name="filmId" value={currentFilmId} />
        <input type="hidden" name="tmdbId" value={tmdbId} />
        <input type="hidden" name="confirmMerge" value="1" />
        <button
          type="submit"
          className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
        >
          Confirm merge and assign
        </button>
        <Link
          href={`/admin/unmatched/${currentFilmId}`}
          className="rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50"
        >
          Cancel
        </Link>
      </form>
    </section>
  );
}
