'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, ne } from 'drizzle-orm';
import { db, films } from '@/db';
import { verifySession } from '@/lib/admin-dal';
import { enrichByTmdbId } from '@/tmdb/enrich';
import { mergeFilmInto, writeEnrichmentToFilm } from '@/scrapers/ingest';

/**
 * Manual TMDB-id assign for an operator-selected film.
 *
 * Flow (matches eng-review D4 + revised design doc):
 *   1. verifySession() — DAL gate (proxy.ts is the optimistic check; this
 *      is the load-bearing one per Next.js 16 auth guidance).
 *   2. Parse + validate formData.
 *   3. Precondition gate: target row must be in 'none' or 'none-attempted'.
 *      If something else already patched it (another tab, an enrich pass),
 *      bounce back with ?error=already-patched.
 *   4. Fetch full TMDB details via enrichByTmdbId (reuses the canonical
 *      EnrichResult shape used by the scraper enrichment loop).
 *   5. Collision lookup: SELECT any other film row whose tmdb_id matches.
 *      If found AND !confirmMerge: bounce back with a ?collision= payload
 *      so the page can render the merge-intent confirm dialog.
 *      If found AND confirmMerge: call mergeFilmInto with the lower-id-
 *      wins invariant (matches mergeIfTmdbIdCollides in enrichment.ts:231,
 *      which is what enforces slug stability), then write the enrichment
 *      onto the WINNER row.
 *   6. No collision: write enrichment onto the current row directly via
 *      the shared writeEnrichmentToFilm helper (PR-1.5 refactor).
 *   7. revalidatePath('/pelicula/[slug]', 'page') + '/' — page-mode covers
 *      both the loser-slug-now-404 case (post-merge) and the current-
 *      slug-now-enriched case (no merge).
 *   8. Redirect to /admin/unmatched.
 */
export async function assignTmdbIdAction(formData: FormData): Promise<void> {
  await verifySession();

  const filmId = parsePositiveInt(formData.get('filmId'));
  const tmdbId = parsePositiveInt(formData.get('tmdbId'));
  const confirmMerge = formData.get('confirmMerge') === '1';

  if (filmId === null || tmdbId === null) {
    redirect('/admin/unmatched');
  }

  // Precondition gate. Re-read the row inside the action (the page-render
  // version is stale by the time the action fires).
  const [current] = await db
    .select({
      id: films.id,
      matchSource: films.matchSource,
      synopsisEs: films.synopsisEs,
      year: films.year,
    })
    .from(films)
    .where(eq(films.id, filmId))
    .limit(1);
  if (!current) {
    redirect('/admin/unmatched');
  }
  if (current.matchSource !== 'none' && current.matchSource !== 'none-attempted') {
    redirect(`/admin/unmatched/${filmId}?error=already-patched`);
  }

  // Fetch full TMDB details. Reuses enrichByTmdbId which calls getMovie +
  // buildDelta, producing the same EnrichResult shape the scraper uses.
  const result = await enrichByTmdbId(tmdbId);
  if (!result.delta) {
    redirect(`/admin/unmatched/${filmId}?error=tmdb-fetch-failed`);
  }

  // Collision lookup.
  const [collisionRow] = await db
    .select({
      id: films.id,
      slug: films.slug,
      title: films.title,
    })
    .from(films)
    .where(and(eq(films.tmdbId, tmdbId), ne(films.id, filmId)))
    .limit(1);

  if (collisionRow) {
    if (!confirmMerge) {
      // Bounce back with the collision payload so the page can render
      // the confirm dialog. Encoding: tmdbId:existingId:existingSlug:title
      const payload = `${tmdbId}:${collisionRow.id}:${collisionRow.slug ?? ''}:${collisionRow.title}`;
      const params = new URLSearchParams({ collision: payload });
      redirect(`/admin/unmatched/${filmId}?${params.toString()}`);
    }

    // Lower-id-wins (slug stability). Loser merges into winner.
    const loserId = filmId > collisionRow.id ? filmId : collisionRow.id;
    const winnerId = filmId > collisionRow.id ? collisionRow.id : filmId;
    await mergeFilmInto(loserId, winnerId);

    // After the merge the winner row may still hold stale enrichment
    // (or none, if it was the previously-unmatched current). Re-fetch
    // the winner's current synopsis/year so the provider-fields-win
    // invariant in writeEnrichmentToFilm has correct inputs.
    const [winnerAfter] = await db
      .select({ synopsisEs: films.synopsisEs, year: films.year })
      .from(films)
      .where(eq(films.id, winnerId))
      .limit(1);
    await writeEnrichmentToFilm(
      winnerId,
      winnerAfter?.synopsisEs ?? null,
      winnerAfter?.year ?? null,
      result.delta,
    );
  } else {
    // No collision — write enrichment directly onto the current row.
    await writeEnrichmentToFilm(
      current.id,
      current.synopsisEs,
      current.year,
      result.delta,
    );
  }

  // Revalidate the cartelera + every /pelicula/* page. Page-mode covers
  // both the merge case (loser slug now 404s; winner slug now updated)
  // and the no-merge case (current slug now enriched).
  revalidatePath('/');
  revalidatePath('/pelicula/[slug]', 'page');
  revalidatePath('/admin/unmatched');

  redirect('/admin/unmatched');
}

function parsePositiveInt(raw: FormDataEntryValue | null): number | null {
  if (raw === null) return null;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
