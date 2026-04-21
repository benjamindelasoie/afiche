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
import { lugonesProvider } from '@/providers/lugones';
import { malbaProvider } from '@/providers/malba';
import { cineYorkProvider } from '@/providers/cine-york';
import type { Provider } from '@/providers/types';
import { ingest, type IngestSummary } from './ingest';
import { startRun, finishRun, failRun } from './run-log';

const providers: Provider[] = [
  lugonesProvider,
  malbaProvider,
  cineYorkProvider,
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
      if (summary.filmsEnriched > 0 || summary.enrichSkipped > 0) {
        console.log(
          `${label}   TMDB     → enriched: ${summary.filmsEnriched} · skipped: ${summary.enrichSkipped}`,
        );
      }
      if (runId !== null) console.log(`${label}   run_id   → ${runId}`);
      console.log();
    } catch (err) {
      // Uncaught error mid-provider — record it and keep going. Don't crash
      // the whole scrape just because one provider threw unexpectedly.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`${label} 💥 uncaught:`, message);
      await failRun(runId, message, Date.now() - t0);
      summaries.push({
        cinemaId: provider.id,
        success: false,
        screeningsScraped: 0,
        screeningsInserted: 0,
        filmsUpserted: 0,
        filmsEnriched: 0,
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
  if (anyFailed) {
    console.log('At least one provider failed.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('💥 scraper runner crashed:', err);
  process.exit(1);
});
