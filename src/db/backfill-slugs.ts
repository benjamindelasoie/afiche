/**
 * One-time backfill: populate `films.slug` for existing rows.
 *
 * Runs AFTER the 0002_classy_gravity migration adds the nullable column.
 * Uses `buildFilmSlug()` from src/lib/slug.ts so backfilled slugs match
 * what `upsertFilm()` will generate going forward — no inconsistency
 * between pre-migration and post-migration rows.
 *
 * Collision handling: walk films in id-asc order; first occurrence of a
 * slug wins, subsequent collisions get the `-<films.id>` tiebreaker. This
 * mirrors the runtime upsertFilm retry path.
 *
 * Idempotent: re-running is safe. Films that already have a slug skip the
 * compute; only NULL slugs get populated. The first run does the real work;
 * subsequent runs are no-ops.
 *
 * Usage:
 *   DATABASE_URL='file:./local.db' npx tsx src/db/backfill-slugs.ts
 *   DATABASE_URL='libsql://...' DATABASE_AUTH_TOKEN='...' npx tsx src/db/backfill-slugs.ts
 */

import { eq, isNull } from 'drizzle-orm';
import { db, films } from './index';
import { buildFilmSlug, withIdSuffix } from '@/lib/slug';

async function main() {
  console.log('[backfill-slugs] starting…');

  const all = await db
    .select({
      id: films.id,
      title: films.title,
      year: films.year,
      slug: films.slug,
    })
    .from(films)
    .where(isNull(films.slug))
    .orderBy(films.id);

  console.log(`[backfill-slugs] ${all.length} films need a slug`);

  if (all.length === 0) {
    console.log('[backfill-slugs] nothing to do — all rows already have a slug');
    return;
  }

  // Track slugs we've assigned in this run so we can detect in-batch
  // collisions BEFORE committing them. This handles the rare case of two
  // films with the same (title, year) where the unique index didn't catch
  // them earlier (e.g., scraped_title differs slightly).
  const used = new Set<string>();

  // Also pre-load any slugs that already exist in the DB (post-migration,
  // some films might already have slugs from a partial backfill or new
  // scrape runs while this script wasn't run yet).
  const existing = await db
    .select({ slug: films.slug })
    .from(films);
  for (const row of existing) {
    if (row.slug) used.add(row.slug);
  }

  let assigned = 0;
  let collisions = 0;

  for (const film of all) {
    const baseSlug = buildFilmSlug(film.title, { year: film.year, id: film.id });
    let finalSlug = baseSlug;

    if (used.has(finalSlug)) {
      // Collision — apply id tiebreaker.
      finalSlug = withIdSuffix(baseSlug, film.id);
      collisions++;
      if (used.has(finalSlug)) {
        // Pathological — even the id-suffixed slug collides. Should be
        // impossible since films.id is unique. Log and skip.
        console.warn(
          `[backfill-slugs] film id=${film.id} title="${film.title}" — even id-tiebreaker slug "${finalSlug}" already taken, skipping`,
        );
        continue;
      }
    }

    await db.update(films).set({ slug: finalSlug }).where(eq(films.id, film.id));
    used.add(finalSlug);
    assigned++;
  }

  console.log(
    `[backfill-slugs] done. ${assigned} films updated, ${collisions} collisions resolved`,
  );
}

main().catch((err) => {
  console.error('[backfill-slugs] FATAL:', err);
  process.exit(1);
});
