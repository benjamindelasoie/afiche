/**
 * One-shot dedupe for the films table — collapses every (tmdb_id, count > 1)
 * cluster into a single row using the same `mergeFilmInto` primitive the
 * enrichment loop uses. Companion to the structural fix in
 * src/scrapers/ingest/enrichment.ts (mergeIfTmdbIdCollides).
 *
 * Why this exists: the structural fix prevents NEW duplicates from being
 * created, but does not clean up EXISTING ones. Most accumulated duplicates
 * have match_source='auto' and never re-enter the enrichment-pending pool
 * (fetchPendingFilms excludes 'auto' rows). Without this script the bug
 * class is "frozen at today's count" rather than closed.
 *
 * Usage:
 *   npm run db:dedupe-films             — local DB, dry-run by default
 *   npm run db:dedupe-films:prod        — prod DB, dry-run by default
 *   npm run db:dedupe-films -- --apply  — actually mutate (local)
 *   npm run db:dedupe-films:prod -- --apply  — actually mutate (prod)
 *
 * Winner-pick rule: lowest id per cluster wins (older row, anchored slug,
 * prior enrichment). Same invariant as mergeIfTmdbIdCollides.
 *
 * Slug fate: each loser's slug is freed by the DELETE. Old links to
 * `/pelicula/<loser-slug>` 404 from then on. Acceptable for personal-
 * project scale; if external indexing matters in the future, layer a
 * redirect table on top.
 */

import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { mergeFilmInto } from '@/scrapers/ingest/films';

interface ClusterRow {
  tmdbId: number;
  ids: number[];
}

async function findTmdbIdClusters(): Promise<ClusterRow[]> {
  // Aggregate ids per tmdb_id. SQLite's GROUP_CONCAT returns ids as a
  // comma-separated string; parse on the JS side. Filter to clusters of 2+.
  const rows = await db.all<{ tmdb_id: number; ids: string }>(sql`
    SELECT tmdb_id, GROUP_CONCAT(id) AS ids
    FROM films
    WHERE tmdb_id IS NOT NULL
    GROUP BY tmdb_id
    HAVING COUNT(*) > 1
    ORDER BY tmdb_id
  `);
  return rows.map((r) => ({
    tmdbId: r.tmdb_id,
    ids: r.ids
      .split(',')
      .map((s) => parseInt(s, 10))
      .sort((a, b) => a - b),
  }));
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const mode = apply ? 'APPLY' : 'DRY-RUN';
  console.log(`🎞  Films dedupe · ${mode} · ${new Date().toISOString()}\n`);

  const clusters = await findTmdbIdClusters();
  if (clusters.length === 0) {
    console.log('No duplicate-tmdb_id clusters found. ✨');
    return;
  }

  let plannedMerges = 0;
  for (const c of clusters) {
    const [winnerId, ...loserIds] = c.ids;
    plannedMerges += loserIds.length;
    const titles = await db.all<{ id: number; scraped_title: string }>(sql`
      SELECT id, scraped_title FROM films WHERE id IN (${sql.join(
        c.ids.map((id) => sql`${id}`),
        sql`, `,
      )})
      ORDER BY id
    `);
    console.log(
      `tmdb_id=${c.tmdbId} → keep id=${winnerId}, merge ${loserIds.length} loser(s):`,
    );
    for (const t of titles) {
      const tag = t.id === winnerId ? '  WINNER' : '  loser ';
      console.log(`${tag}  id=${t.id}  "${t.scraped_title}"`);
    }
  }

  console.log(`\n${clusters.length} cluster(s), ${plannedMerges} merge(s) planned.\n`);

  if (!apply) {
    console.log('Dry-run only — no rows changed. Re-run with --apply to mutate.');
    return;
  }

  // APPLY path — execute the merges. Each merge is its own transaction
  // (inside mergeFilmInto). On error we log + continue with the next
  // cluster rather than aborting the whole script: a partial success is
  // recoverable (re-run picks up the residual clusters), but aborting on
  // the first error means the operator has to manually figure out which
  // clusters succeeded.
  //
  // TOCTOU note: the cluster plan was computed by findTmdbIdClusters()
  // above. If a scrape runs concurrently and inserts a NEW row under one
  // of these tmdb_ids, that new row is NOT in c.ids and survives the
  // current run. Re-run picks it up. For prod safety, pause cron before
  // running with --apply.
  let executed = 0;
  let failed = 0;
  for (const c of clusters) {
    const [winnerId, ...loserIds] = c.ids;
    for (const loserId of loserIds) {
      const warnings: string[] = [];
      try {
        await mergeFilmInto(loserId, winnerId, warnings);
        executed++;
        console.log(`✓ merged film ${loserId} → ${winnerId} (tmdb_id=${c.tmdbId})`);
        for (const w of warnings) console.log(`    ${w}`);
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `✗ FAILED merge film ${loserId} → ${winnerId} (tmdb_id=${c.tmdbId}): ${msg}`,
        );
        // Continue with the next loser/cluster — partial success is recoverable.
      }
    }
  }

  console.log(`\nDone. ${executed} row(s) merged into surviving winners.`);
  if (failed > 0) {
    console.log(
      `⚠ ${failed} merge(s) FAILED — see errors above. Re-run --apply to retry residual clusters.`,
    );
  }
  console.log('Re-run scrape:prod to repopulate any future screenings; cascade');
  console.log('already cleaned up loser rows and their orphaned screenings.');
}

main().catch((err) => {
  console.error('💥 dedupe-films crashed:', err);
  process.exit(1);
});
