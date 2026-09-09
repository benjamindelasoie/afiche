/**
 * Actor 1 apply core — the safety-critical gate between an agent proposal and
 * a live override.
 *
 * The agent only PROPOSES; this module decides whether a proposal may be
 * auto-applied and, if so, performs the DB-only write. Two invariants
 * (self-healing Decisions #2 / #9, eng-review keystones):
 *   - a web-researched proposal is NEVER auto-applied (no candidate set means
 *     no hallucination guard), and
 *   - a candidate-judged proposal auto-applies only above a raised confidence
 *     bar AND with director-or-year corroboration — candidate membership alone
 *     is not correctness.
 */

import { eq } from 'drizzle-orm';
import { db, films } from '@/db';
import {
  YEAR_TOLERANCE,
  TITLE_DOMINANCE_RATIO,
  TITLE_MIN_VOTE_COUNT,
} from '@/tmdb/match';
import { stripDiacritics, jaroWinkler } from '@/tmdb/similarity';
import { upsertOverride } from '@/tmdb/overrides';
import type { TmdbMovieSummary } from '@/tmdb/client';
import type { JudgeInput, JudgeProposal } from '@/tmdb/judge';

/** Above the human-reviewed 0.85 diff bar: unattended publish needs a higher one. */
export const AUTO_APPLY_MIN_CONFIDENCE = 0.9;

/** Title-only path has no year/director to lean on, so it demands more of the judge. */
export const TITLE_AUTO_APPLY_MIN_CONFIDENCE = 0.95;

// The vote floor and dominance ratio this gate applies now live in
// `@/tmdb/match`, which reached the same rule for the same reason one layer
// down (a title tie the matcher itself must break). Re-exported so existing
// importers of the self-heal names keep working and the two layers cannot
// drift to different numbers.
export { TITLE_DOMINANCE_RATIO, TITLE_MIN_VOTE_COUNT };

export interface HealProposal {
  filmId: number;
  scrapedTitle: string;
  scrapedYear: number | null;
  tmdbId: number;
  confidence: number;
  kind: 'candidate-judged' | 'web-researched';
  reasoning: string;
}

/**
 * TMDB metadata for the proposed film, used to corroborate the match. The
 * director/year come from the movie detail; the title fields come from the
 * search summary and are optional so callers that only corroborate on
 * year/director (and older tests) stay valid.
 */
export interface CandidateFacts {
  directors: string[];
  year: number | null;
  title?: string;
  originalTitle?: string;
  voteCount?: number;
  /**
   * The chosen candidate exact-matches the scraped title AND dominates every
   * other same-title candidate by vote count (ratio >= TITLE_DOMINANCE_RATIO).
   * True with no rivals; false when a comparable same-title film exists.
   */
  titleDominant?: boolean;
}

export type HealDecision = { action: 'auto-apply' } | { action: 'queue'; reason: string };

function normalizeName(s: string): string {
  return stripDiacritics(s.toLowerCase())
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function yearCorroborates(
  scrapedYear: number | null,
  candidateYear: number | null,
): boolean {
  if (scrapedYear == null || candidateYear == null) return false;
  return Math.abs(scrapedYear - candidateYear) <= YEAR_TOLERANCE;
}

export function directorCorroborates(
  scrapedDirector: string | null,
  candidateDirectors: string[],
): boolean {
  if (!scrapedDirector) return false;
  const s = normalizeName(scrapedDirector);
  if (!s) return false;
  return candidateDirectors.some((d) => {
    const c = normalizeName(d);
    return c.length > 0 && (c === s || jaroWinkler(c, s) >= 0.9);
  });
}

/**
 * Exact-title corroboration: the scraped title IS the evidence. True only when
 * the scraped title normalizes-equal to the candidate's title or original
 * title, that candidate DOMINATES any same-title rival by vote count (no live
 * same-name ambiguity), and the film is one TMDB actually knows (vote floor —
 * filters obscure long-tail wrong picks).
 */
export function titleCorroborates(
  scrapedTitle: string,
  candidate: CandidateFacts,
): boolean {
  if (!candidate.titleDominant) return false;
  if ((candidate.voteCount ?? 0) < TITLE_MIN_VOTE_COUNT) return false;
  const s = normalizeName(scrapedTitle);
  if (!s) return false;
  return (
    normalizeName(candidate.title ?? '') === s ||
    normalizeName(candidate.originalTitle ?? '') === s
  );
}

/**
 * Decide whether a proposal may be auto-applied. Order matters: the
 * web-researched veto comes first so no confidence value can bypass it. Two
 * auto-apply paths, both candidate-judged only:
 *   - year/director corroboration at the standard bar, or
 *   - exact-dominant-title corroboration at a raised bar, provided no year or
 *     director actively disagrees (a title shortcut never overrides a mismatch).
 */
export function classifyProposal(
  p: HealProposal,
  scrapedDirector: string | null,
  candidate: CandidateFacts,
): HealDecision {
  if (p.kind !== 'candidate-judged') {
    return { action: 'queue', reason: 'web-researched: never auto-applies' };
  }

  const yearOk = yearCorroborates(p.scrapedYear, candidate.year);
  const directorOk = directorCorroborates(scrapedDirector, candidate.directors);

  if (p.confidence >= AUTO_APPLY_MIN_CONFIDENCE && (yearOk || directorOk)) {
    return { action: 'auto-apply' };
  }

  // Title path: a scraped year/director that exists but disagrees is a veto.
  const yearContradicts = p.scrapedYear != null && candidate.year != null && !yearOk;
  const directorContradicts =
    scrapedDirector != null && candidate.directors.length > 0 && !directorOk;
  if (
    p.confidence >= TITLE_AUTO_APPLY_MIN_CONFIDENCE &&
    titleCorroborates(p.scrapedTitle, candidate) &&
    !yearContradicts &&
    !directorContradicts
  ) {
    return { action: 'auto-apply' };
  }

  if (p.confidence < AUTO_APPLY_MIN_CONFIDENCE) {
    return {
      action: 'queue',
      reason: `confidence ${p.confidence.toFixed(2)} < ${AUTO_APPLY_MIN_CONFIDENCE} bar`,
    };
  }
  if (
    titleCorroborates(p.scrapedTitle, candidate) &&
    p.confidence < TITLE_AUTO_APPLY_MIN_CONFIDENCE
  ) {
    return {
      action: 'queue',
      reason: `title-exact but confidence ${p.confidence.toFixed(2)} < ${TITLE_AUTO_APPLY_MIN_CONFIDENCE}`,
    };
  }
  return { action: 'queue', reason: 'no director/year/title corroboration' };
}

/**
 * Perform the DB-only apply: write the durable override and null the film's
 * match_attempt_version so the next enrich re-opens and fills it in. No git.
 */
export async function applyProposal(p: HealProposal): Promise<void> {
  await upsertOverride({
    scrapedTitle: p.scrapedTitle,
    year: p.scrapedYear ?? undefined,
    tmdbId: p.tmdbId,
    note: `self-heal: ${p.reasoning}`,
    source: 'self-heal-judge',
    confidence: p.confidence,
  });
  await db.update(films).set({ matchAttemptVersion: null }).where(eq(films.id, p.filmId));
}

export interface QueuedProposal {
  proposal: HealProposal;
  reason: string;
}

export interface ProcessResult {
  applied: HealProposal[];
  queued: QueuedProposal[];
}

/** A stuck film the harness will try to heal (subset of the audit's StuckFilm). */
export interface HealFilm {
  id: number;
  scrapedTitle: string;
  scrapedYear: number | null;
  director: string | null;
  titleOriginal: string | null;
}

/** Injected side-effects, so the proposal builder stays unit-testable. */
export interface HealDeps {
  searchCandidates: (film: HealFilm) => Promise<TmdbMovieSummary[]>;
  judge: (input: JudgeInput, candidates: TmdbMovieSummary[]) => Promise<JudgeProposal>;
}

/** Title/vote facts from the search summary, needed for the title path. */
export interface CandidateSummaryFacts {
  title: string;
  originalTitle: string;
  voteCount: number;
  titleDominant: boolean;
}

export interface BuildResult {
  proposals: HealProposal[];
  /** Films with no TMDB candidates at all — the web-research / manual tail. */
  noCandidate: HealFilm[];
  /** Films the judge actively declined (candidates existed, none matched). */
  declined: HealFilm[];
  /** Films the judge threw on (e.g. unparseable after retries) — isolated, not fatal. */
  errored: HealFilm[];
  /** Per-proposal (keyed by filmId) summary facts, merged into CandidateFacts. */
  summaryFacts: Map<number, CandidateSummaryFacts>;
}

/**
 * Turn stuck films into candidate-judged proposals via the existing SDK judge.
 * No auto-apply happens here — this only proposes; processProposals gates.
 */
export async function buildHealProposals(
  filmsToHeal: HealFilm[],
  deps: HealDeps,
): Promise<BuildResult> {
  const proposals: HealProposal[] = [];
  const noCandidate: HealFilm[] = [];
  const declined: HealFilm[] = [];
  const errored: HealFilm[] = [];
  const summaryFacts = new Map<number, CandidateSummaryFacts>();

  for (const f of filmsToHeal) {
    const candidates = await deps.searchCandidates(f);
    if (candidates.length === 0) {
      noCandidate.push(f);
      continue;
    }
    let judged;
    try {
      judged = await deps.judge(
        {
          scrapedTitle: f.scrapedTitle,
          year: f.scrapedYear ?? undefined,
          director: f.director ?? undefined,
          titleOriginal: f.titleOriginal ?? undefined,
        },
        candidates,
      );
    } catch {
      // One film's judge failure (unparseable after retries, transient API
      // error) must not abort the whole heal run — isolate and continue.
      errored.push(f);
      continue;
    }
    if (judged.tmdbId === null) {
      declined.push(f);
      continue;
    }
    proposals.push({
      filmId: f.id,
      scrapedTitle: f.scrapedTitle,
      scrapedYear: f.scrapedYear,
      tmdbId: judged.tmdbId,
      confidence: judged.confidence,
      kind: 'candidate-judged',
      reasoning: judged.reasoning,
    });

    const chosen = candidates.find((c) => c.id === judged.tmdbId);
    const sNorm = normalizeName(f.scrapedTitle);
    const exact = candidates.filter(
      (c) =>
        normalizeName(c.title ?? '') === sNorm ||
        normalizeName(c.original_title ?? '') === sNorm,
    );
    const chosenVotes = chosen?.vote_count ?? 0;
    const chosenIsExact = exact.some((c) => c.id === judged.tmdbId);
    const rivalVotes = Math.max(
      0,
      ...exact.filter((c) => c.id !== judged.tmdbId).map((c) => c.vote_count ?? 0),
    );
    summaryFacts.set(f.id, {
      title: chosen?.title ?? '',
      originalTitle: chosen?.original_title ?? '',
      voteCount: chosenVotes,
      titleDominant:
        sNorm.length > 0 &&
        chosenIsExact &&
        chosenVotes >= TITLE_DOMINANCE_RATIO * rivalVotes,
    });
  }
  return { proposals, noCandidate, declined, errored, summaryFacts };
}

/**
 * Classify every proposal, auto-apply the ones that clear the gate, and return
 * the applied + queued partition. `resolve` supplies the scraped director and
 * the TMDB candidate facts (the harness fetches these from the film row + TMDB).
 */
export async function processProposals(
  proposals: HealProposal[],
  resolve: (
    p: HealProposal,
  ) => Promise<{ scrapedDirector: string | null; candidate: CandidateFacts }>,
): Promise<ProcessResult> {
  const applied: HealProposal[] = [];
  const queued: QueuedProposal[] = [];
  for (const p of proposals) {
    const { scrapedDirector, candidate } = await resolve(p);
    const decision = classifyProposal(p, scrapedDirector, candidate);
    if (decision.action === 'auto-apply') {
      await applyProposal(p);
      applied.push(p);
    } else {
      queued.push({ proposal: p, reason: decision.reason });
    }
  }
  return { applied, queued };
}
