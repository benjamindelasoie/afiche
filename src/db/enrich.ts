/**
 * Standalone enrichment runner — runs the TMDB enrichment pass over the
 * current films table without scraping. The fast loop for the manual-patch
 * workflow:
 *
 *   1. Run a normal scrape (e.g. `npm run scrape:prod`). Some films fail
 *      auto-match and end up with match_source='none-attempted'.
 *   2. The scrape's tail prints those films. For any you want to fix
 *      manually, look up the TMDB id on tmdb.org and set `films.tmdb_id`
 *      in Drizzle Studio (`npm run db:studio:prod`).
 *   3. Run `npm run db:enrich:prod`. The enrichment pass picks up rows
 *      with tmdb_id set + match_source='none-attempted' via the manual-
 *      patch path, fetches details, fills in poster/director/year/synopsis,
 *      and flips them to match_source='manual' (locked from re-search).
 *
 * Why standalone: the alternative is re-running the whole scrape, which
 * hits every provider's site (some of which 403 from datacenter IPs and
 * take ~30s to fail) just to get to the 5-second enrichment pass. This
 * skips straight to the part you actually care about.
 *
 * Run locally:
 *   npm run db:enrich
 *
 * Run against Turso (prod):
 *   npm run db:enrich:prod
 */

import 'dotenv/config';
import { enrichPendingFilms } from '@/scrapers/ingest';

async function main() {
  console.log(`🎞  Afiche enrichment pass · ${new Date().toISOString()}\n`);

  const warnings: string[] = [];
  const stats = await enrichPendingFilms(warnings);

  console.log(
    `Done. enriched: ${stats.enriched} · merged: ${stats.merged} · skipped: ${stats.skipped}`,
  );

  if (warnings.length > 0) {
    console.log('\nWarnings:');
    for (const w of warnings) console.log(`  - ${w}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('💥 enrich runner crashed:', err);
    process.exit(1);
  });
