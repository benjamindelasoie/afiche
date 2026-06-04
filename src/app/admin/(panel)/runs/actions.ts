'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { verifySession } from '@/lib/admin-dal';
import { enrichPendingFilms } from '@/scrapers/ingest';
import { refreshAllEnrichment } from '@/db/refresh-enrichment';

/**
 * Run the TMDB enrichment pass over films currently in 'none' /
 * 'none-attempted' (and pre-patched 'manual' with poster_url null).
 * Same entry point as the `db:enrich` CLI script. No venue egress —
 * TMDB API is global, no IP-block risk.
 */
export async function enrichPendingAction(): Promise<void> {
  await verifySession();

  const warnings: string[] = [];
  const stats = await enrichPendingFilms(warnings);

  revalidatePath('/admin/runs');
  revalidatePath('/admin/unmatched');
  revalidatePath('/');

  const params = new URLSearchParams({
    result: 'Enrich pending complete',
    counts: `enriched ${stats.enriched} · merged ${stats.merged} · skipped ${stats.skipped}${
      warnings.length > 0 ? ` · ${warnings.length} warnings` : ''
    }`,
  });
  redirect(`/admin/runs?${params.toString()}`);
}

/**
 * Re-fetch TMDB metadata for every film with a tmdb_id. Bypasses the
 * matcher entirely; refreshes details only (poster, synopsis, cast,
 * etc.). Same entry point as the `db:refresh-enrichment` CLI script.
 * No venue egress.
 */
export async function refreshEnrichmentAction(): Promise<void> {
  await verifySession();

  const result = await refreshAllEnrichment();

  revalidatePath('/admin/runs');
  revalidatePath('/');
  revalidatePath('/pelicula/[slug]', 'page');

  const params = new URLSearchParams({
    result: 'Refresh enrichment complete',
    counts: `refreshed ${result.refreshed}/${result.scanned}${
      result.errors > 0 ? ` · ${result.errors} errors` : ''
    }`,
  });
  if (result.errors > 0) params.set('errors', '1');
  redirect(`/admin/runs?${params.toString()}`);
}
