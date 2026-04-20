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
import type { Provider } from '@/providers/types';
import { ingest, type IngestSummary } from './ingest';

const providers: Provider[] = [
  lugonesProvider,
  // future: malbaProvider, lorcaProvider, cinepolisRecoletaProvider, ...
];

async function main() {
  console.log(`🎞  Afiche scrape · ${new Date().toISOString()}\n`);

  const summaries: IngestSummary[] = [];

  for (const provider of providers) {
    const label = `[${provider.id}]`;
    console.log(`${label} fetching "${provider.name}"...`);

    const t0 = Date.now();
    const result = await provider.fetch();
    const ms = Date.now() - t0;

    if (!result.success) {
      console.error(`${label} ❌ failed after ${ms}ms: ${result.error}`);
    } else {
      console.log(
        `${label} ✓ ${result.screenings.length} screenings in ${ms}ms` +
          (result.warnings.length ? ` (${result.warnings.length} warning(s))` : ''),
      );
    }

    const summary = await ingest(result);
    summaries.push(summary);

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
    console.log();
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
