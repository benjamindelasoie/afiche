/**
 * Mark programme/competition CONTAINER titles (shorts blocks, "PROGRAMA I",
 * competition selections) as skip_tmdb so they stop re-queuing every run.
 *
 * Dry-run by default — prints what it would skip and writes nothing. `--write`
 * sets skip_tmdb=true. Reversible (unset the flag), so a false positive only
 * costs a poster, not the film.
 *
 *   npm run db:classify-containers            # dry run, local
 *   npm run db:classify-containers -- --write
 *   npm run db:classify-containers:prod -- --write
 */

import 'dotenv/config';
import { inArray } from 'drizzle-orm';
import { db, films } from '@/db';
import { activeStuckFilms } from '@/scrapers/audit';
import { isNonFilmContainer } from '@/tmdb/container';

async function main() {
  const write = process.argv.includes('--write');
  const stuck = await activeStuckFilms(new Date());
  const containers = stuck.filter((f) => isNonFilmContainer(f.scrapedTitle));

  console.log(
    `📦 ${containers.length} of ${stuck.length} active-stuck films look like ` +
      `containers${write ? '' : ' (dry run — pass --write to skip_tmdb them)'}\n`,
  );
  for (const f of containers) console.log(`  [${f.id}] ${f.scrapedTitle}`);

  if (!write) {
    console.log('\nDry run — nothing written. Re-run with --write to persist.');
    return;
  }
  if (containers.length === 0) return;

  await db
    .update(films)
    .set({ skipTmdb: true })
    .where(inArray(films.id, containers.map((f) => f.id)));
  console.log(`\nMarked ${containers.length} film(s) skip_tmdb.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ classify-containers failed:', err);
    process.exit(1);
  });
