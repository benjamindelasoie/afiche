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
import { YEAR_TOLERANCE } from '@/tmdb/match';
import { stripDiacritics, jaroWinkler } from '@/tmdb/similarity';
import { upsertOverride } from '@/tmdb/overrides';
import type { TmdbMovieSummary } from '@/tmdb/client';
import type { JudgeInput, JudgeProposal } from '@/tmdb/judge';

/** Above the human-reviewed 0.85 diff bar: unattended publish needs a higher one. */
export const AUTO_APPLY_MIN_CONFIDENCE = 0.9;

export interface HealProposal {
  filmId: number;
  scrapedTitle: string;
  scrapedYear: number | null;
  tmdbId: number;
  confidence: number;
  kind: 'candidate-judged' | 'web-researched';
  reasoning: string;
}

/** TMDB metadata for the proposed film, used to corroborate the match. */
export interface CandidateFacts {
  directors: string[];
  year: number | null;
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
 * Decide whether a proposal may be auto-applied. Order matters: the
 * web-researched veto comes first so no confidence value can bypass it.
 */
export function classifyProposal(
  p: HealProposal,
  scrapedDirector: string | null,
  candidate: CandidateFacts,
): HealDecision {
  if (p.kind !== 'candidate-judged') {
    return { action: 'queue', reason: 'web-researched: never auto-applies' };
  }
  if (p.confidence < AUTO_APPLY_MIN_CONFIDENCE) {
    return {
      action: 'queue',
      reason: `confidence ${p.confidence.toFixed(2)} < ${AUTO_APPLY_MIN_CONFIDENCE} bar`,
    };
  }
  const corroborated =
    yearCorroborates(p.scrapedYear, candidate.year) ||
    directorCorroborates(scrapedDirector, candidate.directors);
  if (!corroborated) {
    return { action: 'queue', reason: 'no director/year corroboration' };
  }
  return { action: 'auto-apply' };
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

export interface BuildResult {
  proposals: HealProposal[];
  /** Films with no TMDB candidates at all — the web-research / manual tail. */
  noCandidate: HealFilm[];
  /** Films the judge actively declined (candidates existed, none matched). */
  declined: HealFilm[];
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

  for (const f of filmsToHeal) {
    const candidates = await deps.searchCandidates(f);
    if (candidates.length === 0) {
      noCandidate.push(f);
      continue;
    }
    const judged = await deps.judge(
      {
        scrapedTitle: f.scrapedTitle,
        year: f.scrapedYear ?? undefined,
        director: f.director ?? undefined,
        titleOriginal: f.titleOriginal ?? undefined,
      },
      candidates,
    );
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
  }
  return { proposals, noCandidate, declined };
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
