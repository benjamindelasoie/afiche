/**
 * Wipe programming data (screenings, films, scrape_runs) and leave
 * reference data (cinemas, providers) intact.
 *
 * Use when a scraper bug has poisoned the DB with wrong data and the
 * cleanest recovery is to re-scrape from scratch. Screenings + films
 * are cheap to regenerate; you lose nothing durable.
 *
 * Run locally:
 *   npm run db:reset-programming
 *
 * Run against Turso (prod):
 *   DATABASE_URL='libsql://...' DATABASE_AUTH_TOKEN='<token>' \
 *     npx tsx src/db/reset-programming.ts
 *
 * Prints the target DB URL before deleting so you don't accidentally
 * nuke prod when you meant local. Exits non-zero on any error.
 */

import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db, screenings, films, scrapeRuns } from './index';

async function resetProgramming() {
  const target = process.env.DATABASE_URL ?? '(unset)';
  console.log(`🧹 Resetting programming data on: ${target}`);

  const count = sql<number>`count(*)`;
  const [sRow] = await db.select({ n: count }).from(screenings);
  const [fRow] = await db.select({ n: count }).from(films);
  const [rRow] = await db.select({ n: count }).from(scrapeRuns);

  console.log(`   Current: ${sRow.n} screenings, ${fRow.n} films, ${rRow.n} scrape_runs`);

  // Order matters for FK constraints: screenings reference both films and
  // scrape_runs, so wipe them first. Cinemas + providers are untouched.
  //
  // tmdb_overrides is INTENTIONALLY preserved (like cinemas/providers): it is
  // the durable store the self-healing agent writes auto-applied matches to,
  // so a rescrape must NOT lose them. Do NOT add db.delete(tmdbOverrides) here.
  await db.delete(screenings);
  await db.delete(films);
  await db.delete(scrapeRuns);

  console.log('✅ Wiped. Cinemas + providers + tmdb_overrides untouched.');
  console.log('   Next step: npm run db:scrape');
}

resetProgramming()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ reset-programming failed:', err);
    process.exit(1);
  });
