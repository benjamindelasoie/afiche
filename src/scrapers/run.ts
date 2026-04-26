/**
 * Scraper runner.
 *
 * Run with:  npm run db:scrape
 *
 * Iterates all registered providers, fetches each, upserts to the DB, and
 * prints a per-cinema summary. Exits non-zero if any provider reported a
 * fatal error so CI can surface the failure.
 */

import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { lugonesProvider } from '@/providers/lugones';
import { malbaProvider } from '@/providers/malba';
import { cineYorkProvider } from '@/providers/cine-york';
import { centroCulturalMunroProvider } from '@/providers/centro-cultural-munro';
import { lumitonProvider } from '@/providers/lumiton';
import { cineCosmosProvider } from '@/providers/cine-cosmos';
import type { Provider } from '@/providers/types';
import { db, films } from '@/db';
import { ingest, type IngestSummary } from './ingest';
import { startRun, finishRun, failRun } from './run-log';

const providers: Provider[] = [
  lugonesProvider,
  malbaProvider,
  cineYorkProvider,
  centroCulturalMunroProvider,
  lumitonProvider,
  cineCosmosProvider,
  // future: lorcaProvider, cinepolisRecoletaProvider, ...
];

async function main() {
  console.log(`🎞  Afiche scrape · ${new Date().toISOString()}\n`);

  const summaries: IngestSummary[] = [];

  for (const provider of providers) {
    const label = `[${provider.id}]`;
    console.log(`${label} fetching "${provider.name}"...`);

    const runId = await startRun(provider.id);
    const t0 = Date.now();

    try {
      const result = await provider.fetch();
      const fetchMs = Date.now() - t0;

      if (!result.success) {
        console.error(`${label} ❌ failed after ${fetchMs}ms: ${result.error}`);
      } else {
        console.log(
          `${label} ✓ ${result.screenings.length} screenings in ${fetchMs}ms` +
            (result.warnings.length ? ` (${result.warnings.length} warning(s))` : ''),
        );
      }

      const summary = await ingest(result);
      summaries.push(summary);
      await finishRun(runId, summary, Date.now() - t0);

      if (summary.warnings.length > 0) {
        console.log(`${label}   warnings:`);
        for (const w of summary.warnings.slice(0, 5)) console.log(`${label}     - ${w}`);
        if (summary.warnings.length > 5) {
          console.log(`${label}     ... and ${summary.warnings.length - 5} more`);
        }
      }

      console.log(
        `${label}   ingested → films: ${summary.filmsUpserted} · screenings: ${summary.screeningsInserted}`,
      );
      if (
        summary.filmsEnriched > 0 ||
        summary.enrichSkipped > 0 ||
        summary.filmsMerged > 0
      ) {
        const mergedPart =
          summary.filmsMerged > 0 ? ` · merged: ${summary.filmsMerged}` : '';
        console.log(
          `${label}   TMDB     → enriched: ${summary.filmsEnriched} · skipped: ${summary.enrichSkipped}${mergedPart}`,
        );
      }
      if (runId !== null) console.log(`${label}   run_id   → ${runId}`);
      console.log();
    } catch (err) {
      // Uncaught error mid-provider — record it and keep going. Don't crash
      // the whole scrape just because one provider threw unexpectedly.
      // Log the full error object so err.cause chains (Drizzle wraps libsql
      // errors and the underlying reason lives on .cause) surface in CI logs
      // instead of bare "Failed query" messages with no diagnostic value.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${label} 💥 uncaught:`, err);
      await failRun(runId, message, Date.now() - t0);
      summaries.push({
        cinemaId: provider.id,
        success: false,
        screeningsScraped: 0,
        screeningsInserted: 0,
        filmsUpserted: 0,
        filmsEnriched: 0,
        filmsMerged: 0,
        enrichSkipped: 0,
        warnings: [`uncaught: ${message}`],
      });
    }
  }

  const anyFailed = summaries.some((s) => !s.success);

  console.log('─'.repeat(50));
  console.log(
    `Done. ${summaries.filter((s) => s.success).length}/${summaries.length} providers ok.`,
  );

  await reportUnenrichedFilms();

  if (anyFailed) {
    console.log('At least one provider failed.');
    process.exit(1);
  }
}

/**
 * After every provider has run, print films whose TMDB enrichment ended in
 * 'none-attempted' — the deterministic-miss state that won't retry on its
 * own. These are the candidates for manual patching: look up the film on
 * tmdb.org, set `films.tmdb_id` in Drizzle Studio, then re-run enrichment
 * (the next scrape, or `npm run db:enrich:prod`) to fill in poster, director,
 * year, synopsis. Rows whose tmdb_id is already set are flagged "patched"
 * so the operator knows they've been addressed but the patch hasn't been
 * applied yet (possibly because of a TMDB error during the just-finished
 * pass; another run will retry).
 */
async function reportUnenrichedFilms(): Promise<void> {
  const stuck = await db
    .select({
      id: films.id,
      scrapedTitle: films.scrapedTitle,
      year: films.year,
      tmdbId: films.tmdbId,
    })
    .from(films)
    .where(eq(films.matchSource, 'none-attempted'))
    .orderBy(films.scrapedTitle);

  if (stuck.length === 0) {
    console.log('No unenriched films. ✨');
    return;
  }

  console.log(
    `\nUnenriched films (${stuck.length}) — set films.tmdb_id in Drizzle Studio` +
      ' to link manually, then re-run enrichment:',
  );
  for (const f of stuck) {
    const yearStr = f.year !== null ? `(${f.year})` : '(no year)';
    const patched = f.tmdbId !== null ? `  [tmdb_id=${f.tmdbId}, awaiting next pass]` : '';
    console.log(`  [${f.id}]  ${f.scrapedTitle}  ${yearStr}${patched}`);
  }
}

main().catch((err) => {
  console.error('💥 scraper runner crashed:', err);
  process.exit(1);
});
