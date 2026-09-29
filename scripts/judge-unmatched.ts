/**
 * Run the LLM judge over films the deterministic matcher couldn't place, and
 * propose `tmdb-overrides.json` entries.
 *
 * Dry-run by default — it prints proposals and writes nothing. `--write`
 * persists the ones that clear `classifyProposal`'s corroboration gate (the
 * SAME gate `scripts/self-heal.ts`'s automated pipeline uses — see that
 * import) to tmdb-overrides.json, which means the approval gate is a git diff
 * and the write path is the override lookup that already runs first inside
 * enrichFilm. No new DB column, no new match_source, and `git revert` undoes
 * a bad batch.
 *
 * Confidence alone is NOT the accept bar — a confident judge verdict still
 * needs director, year, title, or runtime corroboration against the real
 * TMDB movie detail before it writes anything. Until 2026-09 this tool used
 * bare `confidence >= 0.85` with no corroboration at all: the Los Vencedores
 * incident (a real 0.92 miss, no year/director in the listing to check
 * against) would have gone straight into the committed overrides file had
 * anyone run `--write` on it that day. It didn't, only because nobody had.
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
import { hasTmdbToken, getMovie, extractDirectors } from '@/tmdb/client';
import { searchCandidates } from '@/tmdb/candidate-search';
import { normalizeTitle } from '@/tmdb/similarity';
import { judgeCandidates, JUDGE_MODEL, type JudgeProposal } from '@/tmdb/judge';
import {
  classifyProposal,
  computeSummaryFacts,
  type HealProposal,
  type CandidateFacts,
} from '@/scrapers/self-heal';

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
  synopsisEs: string | null;
  runtimeMin: number | null;
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
      synopsisEs: films.synopsisEs,
      runtimeMin: films.runtimeMin,
      venues: sql<string>`group_concat(distinct ${cinemas.name})`,
    })
    .from(films)
    .innerJoin(screenings, eq(screenings.filmId, films.id))
    .innerJoin(cinemas, eq(cinemas.id, screenings.cinemaId))
    .where(and(isNull(films.tmdbId), gt(screenings.startsAtUtc, new Date())))
    .groupBy(films.id)
    .orderBy(films.scrapedTitle);
}

/** Same shape scripts/self-heal.ts's candidateFacts fetches — kept in sync by
 * hand since the two scripts don't share a runner, only the library code. */
async function candidateFacts(tmdbId: number): Promise<CandidateFacts> {
  const d = await getMovie(tmdbId);
  return {
    directors: extractDirectors(d),
    year: d?.release_date ? Number(d.release_date.slice(0, 4)) : null,
    runtime: d?.runtime ?? null,
  };
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

// Same normalized key src/tmdb/overrides.ts's findOverride uses — otherwise
// this dry-run "already have an override" check can drift from what actually
// matches at enrichment time (e.g. an accent variant it'd wrongly re-judge).
function overrideKey(title: string, year?: number): string {
  return `${normalizeTitle(title)}::${year ?? ''}`;
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
  let queued = 0;
  let declined = 0;

  for (const f of pending) {
    const year = f.scrapedYear ?? undefined;
    if (existing.has(overrideKey(f.scrapedTitle, year))) continue;

    const candidates = await searchCandidates(f);
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
          synopsisEs: f.synopsisEs ?? undefined,
          runtimeMin: f.runtimeMin ?? undefined,
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

    // Same safety gate the automated self-heal pipeline enforces before
    // writing anything — director/year/title/runtime corroboration, not
    // confidence alone. This tool used to accept on bare confidence >= 0.85
    // with no corroboration at all: a wrong-but-confident pick (the Los
    // Vencedores incident, 2026-09 — a real 0.92 miss with neither year nor
    // director present) would have been written straight to the committed
    // overrides file. `classifyProposal` is the one place that decision is
    // made now, so this tool and the automated pipeline cannot drift apart.
    const healProposal: HealProposal = {
      filmId: f.id,
      scrapedTitle: f.scrapedTitle,
      scrapedYear: f.scrapedYear,
      scrapedRuntimeMin: f.runtimeMin,
      tmdbId: proposal.tmdbId,
      confidence: proposal.confidence,
      kind: 'candidate-judged',
      reasoning: proposal.reasoning,
    };
    const candidateFactsResult: CandidateFacts = {
      ...(await candidateFacts(proposal.tmdbId)),
      ...computeSummaryFacts(f.scrapedTitle, candidates, proposal.tmdbId),
    };
    const decision = classifyProposal(healProposal, f.director, candidateFactsResult);

    const mark = decision.action === 'auto-apply' ? '✓' : '?';
    const why = decision.action === 'queue' ? ` (${decision.reason})` : '';
    console.log(
      `${mark} ${f.scrapedTitle}${year ? ` (${year})` : ''} → ${picked.title} ` +
        `[tmdb ${picked.id}] conf=${proposal.confidence.toFixed(2)}${why}\n    ${proposal.reasoning}`,
    );

    if (decision.action !== 'auto-apply') {
      queued++;
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
    `\n── ${accepted.length} accepted · ${queued} queued (corroboration gate) · ` +
      `${declined} declined · ` +
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
