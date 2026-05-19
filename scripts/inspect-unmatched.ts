/**
 * Read-only inspection of films currently missing TMDB enrichment.
 *
 * Buckets the pending pool by (matchSource, has-tmdb-id) and prints enough
 * per-row context to design the LLM judge prompt: scraped title, year hints,
 * any director/title-original signal the scraper captured, and which cinemas
 * programmed each film.
 *
 * Also prints a small sanity panel (overall counts, low-confidence 'auto'
 * matches) so wrong-match candidates show up for follow-up triage even
 * though they're not the immediate target.
 *
 * Run:
 *   npm run db:inspect-unmatched          # local
 *   npm run db:inspect-unmatched:prod     # Turso
 */

import 'dotenv/config';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { db, films, screenings, cinemas } from '@/db';

interface PendingRow {
  id: number;
  scrapedTitle: string;
  scrapedYear: number | null;
  year: number | null;
  director: string | null;
  titleOriginal: string | null;
  matchSource: string;
  matchConfidence: number | null;
  tmdbId: number | null;
}

async function main() {
  console.log(`🔎 Unmatched-films inspection · ${process.env.DATABASE_URL ?? '(unset)'}\n`);

  // -------------------------------------------------------------------------
  // Overall match-source distribution
  // -------------------------------------------------------------------------
  const dist = await db.all<{ match_source: string; n: number }>(sql`
    SELECT match_source, COUNT(*) AS n
    FROM films
    GROUP BY match_source
    ORDER BY n DESC
  `);
  console.log('— Films by match_source:');
  for (const r of dist) console.log(`  ${String(r.n).padStart(4)}  ${r.match_source}`);

  const [{ total }] = await db.all<{ total: number }>(sql`SELECT COUNT(*) AS total FROM films`);
  const [{ missing }] = await db.all<{ missing: number }>(sql`
    SELECT COUNT(*) AS missing FROM films WHERE tmdb_id IS NULL
  `);
  console.log(`\n  total films: ${total} · missing tmdb_id: ${missing}\n`);

  // -------------------------------------------------------------------------
  // The pending pool — the rows the judge would target
  // -------------------------------------------------------------------------
  const pending: PendingRow[] = await db
    .select({
      id: films.id,
      scrapedTitle: films.scrapedTitle,
      scrapedYear: films.scrapedYear,
      year: films.year,
      director: films.director,
      titleOriginal: films.titleOriginal,
      matchSource: films.matchSource,
      matchConfidence: films.matchConfidence,
      tmdbId: films.tmdbId,
    })
    .from(films)
    .where(
      and(
        eq(films.skipTmdb, false),
        isNull(films.tmdbId),
        or(eq(films.matchSource, 'none'), eq(films.matchSource, 'none-attempted')),
      ),
    )
    .orderBy(asc(films.matchSource), asc(films.id));

  // Bucket
  const byBucket = new Map<string, PendingRow[]>();
  for (const r of pending) {
    const key = `${r.matchSource} · tmdb_id=NULL`;
    if (!byBucket.has(key)) byBucket.set(key, []);
    byBucket.get(key)!.push(r);
  }

  // Venue context for each film (DISTINCT cinema ids)
  const venuesByFilm = new Map<number, string[]>();
  if (pending.length > 0) {
    const ids = pending.map((p) => p.id);
    const rows = await db
      .selectDistinct({ filmId: screenings.filmId, cinemaId: screenings.cinemaId })
      .from(screenings)
      .where(sql`${screenings.filmId} IN (${sql.join(ids, sql`, `)})`);
    for (const r of rows) {
      if (!venuesByFilm.has(r.filmId)) venuesByFilm.set(r.filmId, []);
      venuesByFilm.get(r.filmId)!.push(r.cinemaId);
    }
  }

  console.log(`— Pending pool (${pending.length} films):\n`);
  for (const [bucket, rows] of byBucket) {
    console.log(`▸ ${bucket}  (${rows.length} films)`);
    for (const r of rows) {
      const yr = r.scrapedYear ?? r.year ?? '????';
      console.log(`  [${r.id}] "${r.scrapedTitle}" (${yr})`);
      const sigs: string[] = [];
      if (r.titleOriginal) sigs.push(`orig="${r.titleOriginal}"`);
      if (r.director) sigs.push(`dir="${r.director}"`);
      if (r.year !== null && r.year !== r.scrapedYear) sigs.push(`year=${r.year}`);
      if (r.matchConfidence !== null) sigs.push(`conf=${r.matchConfidence.toFixed(3)}`);
      if (sigs.length > 0) console.log(`        ${sigs.join(' · ')}`);
      const venues = venuesByFilm.get(r.id) ?? [];
      console.log(`        venues: ${venues.length > 0 ? venues.join(', ') : '(none)'}`);
    }
    console.log();
  }

  // -------------------------------------------------------------------------
  // Sanity panel — orphans + low-confidence auto matches (out of v1 scope,
  // but surface them so we know what's lurking)
  // -------------------------------------------------------------------------
  const orphans = await db.all<{ n: number }>(sql`
    SELECT COUNT(*) AS n FROM films
    WHERE tmdb_id IS NOT NULL AND match_source IN ('none', 'none-attempted')
  `);
  const lowConf = await db.all<{ n: number }>(sql`
    SELECT COUNT(*) AS n FROM films
    WHERE match_source = 'auto'
    AND match_confidence IS NOT NULL
    AND match_confidence < 0.92
  `);
  const skipped = await db.all<{ n: number }>(sql`
    SELECT COUNT(*) AS n FROM films WHERE skip_tmdb = 1
  `);
  console.log('— Sanity panel (not pending pool, but worth knowing):');
  console.log(`  ${String(skipped[0].n).padStart(4)}  rows marked skip_tmdb=true  (excluded from pending pool by design)`);
  console.log(`  ${String(orphans[0].n).padStart(4)}  rows with tmdb_id but match_source ∈ (none, none-attempted)`);
  console.log(`  ${String(lowConf[0].n).padStart(4)}  'auto' matches with confidence < 0.92  (wrong-match candidates)`);

  // -------------------------------------------------------------------------
  // Cinema id → name resolution for the venue codes above
  // -------------------------------------------------------------------------
  const cinList = await db.select({ id: cinemas.id, name: cinemas.name }).from(cinemas);
  console.log('\n— Cinema-id legend:');
  for (const c of cinList) console.log(`  ${c.id.padEnd(20)} ${c.name}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('💥 inspect-unmatched crashed:', err);
    process.exit(1);
  });
