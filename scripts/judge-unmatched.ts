/**
 * Run the LLM judge over films the deterministic matcher couldn't place, and
 * propose `tmdb-overrides.json` entries.
 *
 * Dry-run by default — it prints proposals and writes nothing. `--write`
 * persists the confident ones to tmdb-overrides.json, which means the approval
 * gate is a git diff and the write path is the override lookup that already
 * runs first inside enrichFilm. No new DB column, no new match_source, and
 * `git revert` undoes a bad batch.
 *
 * Only films with a FUTURE screening are considered — the same "active" pool
 * the operator sees on the site, since a stale film costs nobody anything.
 * Films for which TMDB search returns no candidates at all are skipped and
 * counted: there is nothing for a judge to choose between, and those need a
 * manual override or a different source.
 *
 * Run:
 *   npm run db:judge-unmatched            # dry run, local
 *   npm run db:judge-unmatched -- --write
 *   npm run db:judge-unmatched:prod -- --write
 */

import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { db, films, screenings, cinemas } from '@/db';
import { searchMovies, hasTmdbToken, type TmdbMovieSummary } from '@/tmdb/client';
import { stripSearchNoise } from '@/tmdb/similarity';
import {
  judgeCandidates,
  JUDGE_AUTO_ACCEPT_CONFIDENCE,
  JUDGE_MODEL,
  type JudgeProposal,
} from '@/tmdb/judge';

const OVERRIDES_PATH = resolve(process.cwd(), 'tmdb-overrides.json');

interface OverrideEntry {
  scrapedTitle: string;
  year?: number;
  tmdbId: number;
  note?: string;
}

interface PendingFilm {
  id: number;
  scrapedTitle: string;
  scrapedYear: number | null;
  director: string | null;
  titleOriginal: string | null;
  venues: string;
}

async function loadPending(): Promise<PendingFilm[]> {
  return db
    .select({
      id: films.id,
      scrapedTitle: films.scrapedTitle,
      scrapedYear: films.scrapedYear,
      director: films.director,
      titleOriginal: films.titleOriginal,
      venues: sql<string>`group_concat(distinct ${cinemas.name})`,
    })
    .from(films)
    .innerJoin(screenings, eq(screenings.filmId, films.id))
    .innerJoin(cinemas, eq(cinemas.id, screenings.cinemaId))
    .where(and(isNull(films.tmdbId), gt(screenings.startsAtUtc, new Date())))
    .groupBy(films.id)
    .orderBy(films.scrapedTitle);
}

/** Same query shaping enrichFilm uses, so the judge sees the same shortlist. */
async function candidatesFor(f: PendingFilm): Promise<TmdbMovieSummary[]> {
  const year = f.scrapedYear ?? undefined;
  const queries = [f.scrapedTitle];
  if (f.titleOriginal && f.titleOriginal !== f.scrapedTitle)
    queries.push(f.titleOriginal);
  const cleaned = stripSearchNoise(f.scrapedTitle);
  if (cleaned !== f.scrapedTitle) queries.push(cleaned);

  const seen = new Set<number>();
  const out: TmdbMovieSummary[] = [];
  for (const q of queries) {
    for (const r of await searchMovies(q, year)) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        out.push(r);
      }
    }
  }
  return out;
}

async function readOverrides(): Promise<{
  raw: Record<string, unknown>;
  list: OverrideEntry[];
}> {
  const raw = JSON.parse(await readFile(OVERRIDES_PATH, 'utf8')) as Record<
    string,
    unknown
  >;
  return { raw, list: (raw.overrides as OverrideEntry[] | undefined) ?? [] };
}

function overrideKey(title: string, year?: number): string {
  return `${title.toLowerCase()}::${year ?? ''}`;
}

async function main() {
  const write = process.argv.includes('--write');
  if (!hasTmdbToken()) throw new Error('TMDB_API_TOKEN is not set');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');

  const pending = await loadPending();
  console.log(
    `⚖️  Judging ${pending.length} active unmatched film(s) with ${JUDGE_MODEL}` +
      `${write ? '' : '  (dry run — pass --write to persist)'}\n`,
  );

  const { raw, list } = await readOverrides();
  const existing = new Set(list.map((o) => overrideKey(o.scrapedTitle, o.year)));

  const accepted: OverrideEntry[] = [];
  const judged: number[] = [];
  let noCandidates = 0;
  let lowConfidence = 0;
  let declined = 0;

  for (const f of pending) {
    const year = f.scrapedYear ?? undefined;
    if (existing.has(overrideKey(f.scrapedTitle, year))) continue;

    const candidates = await candidatesFor(f);
    if (candidates.length === 0) {
      noCandidates++;
      console.log(`· ${f.scrapedTitle} — no TMDB candidates; needs a manual override`);
      continue;
    }

    let proposal: JudgeProposal;
    try {
      proposal = await judgeCandidates(
        {
          scrapedTitle: f.scrapedTitle,
          year,
          director: f.director ?? undefined,
          titleOriginal: f.titleOriginal ?? undefined,
          venues: f.venues ? f.venues.split(',') : undefined,
        },
        candidates,
      );
    } catch (err) {
      console.log(`✗ ${f.scrapedTitle} — judge error: ${(err as Error).message}`);
      continue;
    }

    if (proposal.tmdbId === null) {
      declined++;
      console.log(`· ${f.scrapedTitle} — declined: ${proposal.reasoning}`);
      continue;
    }

    const picked = candidates.find((c) => c.id === proposal.tmdbId)!;
    const mark = proposal.confidence >= JUDGE_AUTO_ACCEPT_CONFIDENCE ? '✓' : '?';
    console.log(
      `${mark} ${f.scrapedTitle}${year ? ` (${year})` : ''} → ${picked.title} ` +
        `[tmdb ${picked.id}] conf=${proposal.confidence.toFixed(2)}\n    ${proposal.reasoning}`,
    );

    if (proposal.confidence < JUDGE_AUTO_ACCEPT_CONFIDENCE) {
      lowConfidence++;
      continue;
    }
    judged.push(f.id);
    accepted.push({
      scrapedTitle: f.scrapedTitle,
      ...(year !== undefined ? { year } : {}),
      tmdbId: picked.id,
      note:
        `LLM judge (${JUDGE_MODEL}, confidence ${proposal.confidence.toFixed(2)}): ` +
        `${proposal.reasoning} — tmdb.org/movie/${picked.id}`,
    });
  }

  console.log(
    `\n── ${accepted.length} accepted · ${lowConfidence} below the ` +
      `${JUDGE_AUTO_ACCEPT_CONFIDENCE} bar · ${declined} declined · ` +
      `${noCandidates} with no candidates`,
  );

  if (!write) {
    console.log('Dry run — nothing written. Re-run with --write to persist.');
    return;
  }
  if (accepted.length === 0) {
    console.log('Nothing to write.');
    return;
  }

  raw.overrides = [...list, ...accepted];
  await writeFile(OVERRIDES_PATH, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');

  // Re-open the rows we just wrote overrides for.
  //
  // `fetchPendingFilms` excludes deterministic misses already stamped with the
  // current MATCHER_VERSION, which is right for a matcher that hasn't changed —
  // but an override IS new information for that row, and nothing else clears
  // the stamp. Without this, the override sits in the file and the next
  // `db:enrich` reports "enriched: 0", because the row it applies to never
  // enters the pool. Nulling the version is the same signal a matcher bump
  // sends, scoped to exactly the films we touched.
  //
  // NOTE: hand-added overrides have the same problem. The documented manual
  // workflow sidesteps it by setting films.tmdb_id in Studio, which re-opens
  // the row through a different clause — but an override added on its own
  // stays inert. Worth fixing centrally; out of scope here.
  await db
    .update(films)
    .set({ matchAttemptVersion: null })
    .where(inArray(films.id, judged));

  console.log(
    `Wrote ${accepted.length} override(s) to tmdb-overrides.json and re-opened ` +
      `the matching film rows.\n` +
      'Review the diff, then run `npm run db:enrich` to apply them.',
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ judge-unmatched failed:', err);
    process.exit(1);
  });
