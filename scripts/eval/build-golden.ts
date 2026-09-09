/**
 * Build the judge golden set — freeze (listing → correct tmdbId) pairs with the
 * candidate list production would show the judge, so the eval is deterministic
 * in everything but the model.
 *
 * Ground truth: films a HUMAN matched (`match_source = 'manual'`) plus the
 * hand-verified `tmdb-overrides.json` seed. For each we run the real
 * `searchCandidates` once and record whether the correct id is even reachable
 * (in the candidate set) — the judge can only be graded on reachable cases.
 *
 *   npm run eval:judge:build:prod
 *
 * Writes test/fixtures/judge-golden.json (committed). Re-run to refresh.
 */

import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { db, films, screenings, cinemas } from '@/db';
import { hasTmdbToken } from '@/tmdb/client';
import { searchCandidates } from '@/tmdb/candidate-search';
import type { JudgeInput } from '@/tmdb/judge';
import type { TmdbMovieSummary } from '@/tmdb/client';

interface GoldenFixture {
  filmId: number;
  source: 'manual-film' | 'json-override';
  input: JudgeInput;
  expectedTmdbId: number;
  reachable: boolean;
  candidates: TmdbMovieSummary[];
}

interface Seed {
  filmId: number;
  source: 'manual-film' | 'json-override';
  scrapedTitle: string;
  scrapedYear: number | null;
  director: string | null;
  titleOriginal: string | null;
  venues: string[];
  expectedTmdbId: number;
}

async function manualFilmSeeds(): Promise<Seed[]> {
  const rows = await db
    .select({
      id: films.id,
      scrapedTitle: films.scrapedTitle,
      scrapedYear: films.scrapedYear,
      director: films.director,
      titleOriginal: films.titleOriginal,
      tmdbId: films.tmdbId,
      venues: sql<string | null>`group_concat(distinct ${cinemas.name})`,
    })
    .from(films)
    .leftJoin(screenings, eq(screenings.filmId, films.id))
    .leftJoin(cinemas, eq(cinemas.id, screenings.cinemaId))
    .where(and(eq(films.matchSource, 'manual'), isNotNull(films.tmdbId)))
    .groupBy(films.id);

  return rows
    .filter((r) => r.tmdbId != null)
    .map((r) => ({
      filmId: r.id,
      source: 'manual-film' as const,
      scrapedTitle: r.scrapedTitle,
      scrapedYear: r.scrapedYear,
      director: r.director,
      titleOriginal: r.titleOriginal,
      venues: r.venues ? r.venues.split(',') : [],
      expectedTmdbId: r.tmdbId!,
    }));
}

async function jsonOverrideSeeds(): Promise<Seed[]> {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, '..', '..', 'tmdb-overrides.json');
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as {
      overrides: { scrapedTitle: string; year?: number; tmdbId: number }[];
    };
    return (parsed.overrides ?? [])
      .filter((o) => o.scrapedTitle && o.tmdbId)
      .map((o, i) => ({
        filmId: -(i + 1), // synthetic: JSON overrides have no film row
        source: 'json-override' as const,
        scrapedTitle: o.scrapedTitle,
        scrapedYear: o.year ?? null,
        director: null,
        titleOriginal: null,
        venues: [],
        expectedTmdbId: o.tmdbId,
      }));
  } catch {
    return [];
  }
}

async function main() {
  if (!hasTmdbToken()) throw new Error('TMDB_API_TOKEN is not set');

  const seeds = [...(await manualFilmSeeds()), ...(await jsonOverrideSeeds())];
  console.log(`Freezing ${seeds.length} golden cases (searching TMDB)…`);

  const fixtures: GoldenFixture[] = [];
  let reachableCount = 0;
  for (const s of seeds) {
    const candidates = await searchCandidates({
      scrapedTitle: s.scrapedTitle,
      scrapedYear: s.scrapedYear,
      titleOriginal: s.titleOriginal,
    });
    const reachable = candidates.some((c) => c.id === s.expectedTmdbId);
    if (reachable) reachableCount++;
    const input: JudgeInput = { scrapedTitle: s.scrapedTitle };
    if (s.scrapedYear != null) input.year = s.scrapedYear;
    if (s.director) input.director = s.director;
    if (s.titleOriginal) input.titleOriginal = s.titleOriginal;
    if (s.venues.length) input.venues = s.venues;
    fixtures.push({
      filmId: s.filmId,
      source: s.source,
      input,
      expectedTmdbId: s.expectedTmdbId,
      reachable,
      candidates,
    });
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const out = resolve(here, '..', '..', 'test', 'fixtures', 'judge-golden.json');
  await writeFile(out, JSON.stringify(fixtures, null, 2) + '\n');
  console.log(
    `Wrote ${fixtures.length} cases → ${out}\n` +
      `reachable: ${reachableCount} · unreachable (search miss): ${fixtures.length - reachableCount}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ build-golden failed:', err);
    process.exit(1);
  });
