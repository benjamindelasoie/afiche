/**
 * Read-only inspection of the films + screenings catalog. Prints aggregate
 * distributions across country, decade, genre, director, and cinema so we
 * can ground product decisions (UI tone, what data to surface) against
 * what venues actually program rather than what we assume they do.
 *
 * Run:
 *   npm run db:inspect            # local
 *   npm run db:inspect:prod       # Turso
 */

import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db, films, screenings } from './index';
import { GENRE_LABELS_ES } from './schema';

async function main() {
  console.log(`📊 Catalog inspection · ${process.env.DATABASE_URL}\n`);

  const [{ filmCount }] = await db
    .select({ filmCount: sql<number>`count(*)` })
    .from(films);
  const [{ screeningCount }] = await db
    .select({ screeningCount: sql<number>`count(*)` })
    .from(screenings);
  console.log(`Films: ${filmCount}  ·  Screenings: ${screeningCount}\n`);

  // Country distribution
  const byCountry = await db.all<{ country: string; c: number }>(sql`
    SELECT country, COUNT(*) AS c FROM films
    WHERE country IS NOT NULL
    GROUP BY country ORDER BY c DESC LIMIT 15
  `);
  console.log('— Top 15 countries (films enriched only):');
  for (const r of byCountry) console.log(`  ${r.c.toString().padStart(4)}  ${r.country}`);

  // Decade distribution
  const byDecade = await db.all<{ decade: number; c: number }>(sql`
    SELECT (year / 10) * 10 AS decade, COUNT(*) AS c FROM films
    WHERE year IS NOT NULL
    GROUP BY decade ORDER BY decade DESC
  `);
  console.log('\n— Decades:');
  for (const r of byDecade) console.log(`  ${r.c.toString().padStart(4)}  ${r.decade}s`);

  // Genre distribution (JSON arrays of TMDB ids)
  const allGenres = await db.all<{ genres: string }>(sql`
    SELECT genres FROM films WHERE genres IS NOT NULL AND genres != '[]'
  `);
  const genreCounts = new Map<number, number>();
  for (const row of allGenres) {
    const ids = JSON.parse(row.genres) as number[];
    for (const id of ids) genreCounts.set(id, (genreCounts.get(id) ?? 0) + 1);
  }
  const sortedGenres = Array.from(genreCounts.entries()).sort((a, b) => b[1] - a[1]);
  console.log('\n— Genres (TMDB classification, films enriched only):');
  for (const [id, c] of sortedGenres) {
    const label = GENRE_LABELS_ES[id] ?? `(unknown ${id})`;
    console.log(`  ${c.toString().padStart(4)}  ${label}`);
  }

  // Top directors by film count
  const byDirector = await db.all<{ director: string; c: number }>(sql`
    SELECT director, COUNT(*) AS c FROM films
    WHERE director IS NOT NULL
    GROUP BY director ORDER BY c DESC LIMIT 15
  `);
  console.log('\n— Top 15 directors (by film count in catalog):');
  for (const r of byDirector)
    console.log(`  ${r.c.toString().padStart(4)}  ${r.director}`);

  // Argentine vs non-Argentine split
  const [{ argCount }] = await db
    .select({ argCount: sql<number>`count(*)` })
    .from(films)
    .where(sql`country = 'AR' OR country = 'Argentina'`);
  const [{ enrichedCount }] = await db
    .select({ enrichedCount: sql<number>`count(*)` })
    .from(films)
    .where(sql`country IS NOT NULL`);
  console.log('\n— Argentine films:');
  console.log(
    `  ${argCount} of ${enrichedCount} enriched (${
      enrichedCount > 0 ? Math.round((100 * argCount) / enrichedCount) : 0
    }%)`,
  );

  // Pre-1980 vs post-1980 (rough classics vs newer)
  const [{ classics }] = await db
    .select({ classics: sql<number>`count(*)` })
    .from(films)
    .where(sql`year < 1980`);
  const [{ withYear }] = await db
    .select({ withYear: sql<number>`count(*)` })
    .from(films)
    .where(sql`year IS NOT NULL`);
  console.log('\n— Era split:');
  console.log(
    `  pre-1980: ${classics} of ${withYear} dated (${
      withYear > 0 ? Math.round((100 * classics) / withYear) : 0
    }%)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('💥 inspect crashed:', err);
    process.exit(1);
  });
