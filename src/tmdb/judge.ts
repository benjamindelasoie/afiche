/**
 * LLM judge for the residual unmatched tail.
 *
 * The deterministic matcher is the first and best line: it's free, it never
 * drifts, and after the non-Latin-credit and subtitle fixes it clears most of
 * the pool. What it cannot do is world knowledge. When a venue lists an
 * Argentine release title TMDB doesn't carry, or three films share an exact
 * title and only one plausibly plays a Palermo cineclub, string similarity has
 * no more signal to extract — but a model that has read about these films does.
 *
 * SCOPE: this runs AFTER the matcher has failed, over candidates the matcher
 * already fetched. It never widens the search and never replaces scoring.
 *
 * THE HALLUCINATION GUARD IS THE WHOLE DESIGN. The model is handed a numbered
 * candidate list and must answer with one of those ids or null. It cannot
 * emit a TMDB id from memory, because `judgeCandidates` rejects any id that
 * isn't in the set it was shown. That reduces the worst case from "invented an
 * id pointing at an unrelated film" to "picked the wrong film off a shortlist
 * the matcher already considered plausible" — the same failure mode a
 * threshold nudge would have, and one an operator can see and revert.
 *
 * Output is a PROPOSAL, never a write. `scripts/judge-unmatched.ts` turns
 * accepted proposals into `tmdb-overrides.json` entries, so the approval gate
 * is a git diff and the write path is the override lookup that already runs
 * first in `enrichFilm`. Nothing new touches the DB.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { TmdbMovieSummary } from './client';

/**
 * Cheap model on purpose: this is a shortlist disambiguation, not an
 * open-ended research task, and the candidate list does the retrieval. Pinned
 * to a snapshot rather than an alias so a silent alias move can't change
 * verdicts under us — the same reasoning as cine-lorca's VISION_MODEL note,
 * minus the cache-key coupling, since proposals here are reviewed by a human
 * before they take effect.
 */
export const JUDGE_MODEL = 'claude-haiku-4-5-20251001';
export const JUDGE_MAX_TOKENS = 1024;
/** Deterministic-as-possible: this is a classification, not a generation. */
export const JUDGE_TEMPERATURE = 0;

/**
 * Below this the proposal is printed for review but never written. Set high:
 * the entire point of the tail is that it's hard, so a judge that is merely
 * "fairly sure" is not worth an override entry that then takes precedence
 * over all future matching.
 */
export const JUDGE_AUTO_ACCEPT_CONFIDENCE = 0.85;

export interface JudgeInput {
  scrapedTitle: string;
  year?: number;
  director?: string;
  titleOriginal?: string;
  /** Venue names programming the film — real context for a local-cinema call. */
  venues?: string[];
}

export interface JudgeProposal {
  /** A TMDB id FROM THE CANDIDATE LIST, or null for "none of these". */
  tmdbId: number | null;
  confidence: number;
  reasoning: string;
}

const SYSTEM_PROMPT = `You identify which TMDB entry corresponds to a film screening listed by an independent cinema in Buenos Aires.

You will be given the listing as the venue printed it, plus a numbered list of TMDB candidates that a fuzzy title matcher already retrieved and failed to choose between.

Rules:
- Answer with a tmdb_id from the candidate list, or null. NEVER write a tmdb_id that is not in the list, even if you believe you know the correct one — a missing entry is a valid and useful answer.
- Argentine and Spanish release titles often differ completely from the original. "Perros de la calle" is Reservoir Dogs. Use that knowledge.
- The venues are indie/arthouse cinemas and cineclubs. A retrospective classic or a festival documentary is far more likely than a blockbuster with a coincidentally similar title.
- A year in the listing is the venue's claim about the film's production year, not the screening date. It can be off by one, or wrong.
- Be decisive about confidence. Use >0.85 only when the identification is essentially certain. Use <0.5 when you are guessing.

Respond with ONLY a JSON object, no markdown fences, no commentary:
{"tmdb_id": <number|null>, "confidence": <0..1>, "reasoning": "<one sentence>"}`;

/** Render a candidate compactly — enough to identify, cheap in tokens. */
function formatCandidate(c: TmdbMovieSummary, i: number): string {
  const year = c.release_date ? c.release_date.slice(0, 4) : '????';
  const orig =
    c.original_title && c.original_title !== c.title
      ? ` [orig: ${c.original_title}]`
      : '';
  const overview = c.overview ? ` — ${c.overview.slice(0, 180)}` : '';
  return `${i + 1}. tmdb_id=${c.id} "${c.title}"${orig} (${year})${overview}`;
}

export function buildUserPrompt(
  input: JudgeInput,
  candidates: TmdbMovieSummary[],
): string {
  const lines = [`Listing title: ${input.scrapedTitle}`];
  if (input.year !== undefined) lines.push(`Listing year: ${input.year}`);
  if (input.director) lines.push(`Listing director: ${input.director}`);
  if (input.titleOriginal) lines.push(`Listing original title: ${input.titleOriginal}`);
  if (input.venues?.length) lines.push(`Programmed by: ${input.venues.join(', ')}`);
  lines.push('', 'TMDB candidates:', ...candidates.map(formatCandidate));
  return lines.join('\n');
}

/**
 * Parse the judge's reply. Tolerant of ```json fences because models add them
 * despite instructions; strict about everything else, since a malformed
 * verdict must not become a silent "no match".
 */
export function parseJudgeResponse(raw: string): JudgeProposal {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`judge returned non-JSON: ${raw.slice(0, 200)}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('judge returned a non-object');
  }

  const o = parsed as Record<string, unknown>;
  const rawId = o.tmdb_id;
  const tmdbId =
    rawId === null || rawId === undefined
      ? null
      : typeof rawId === 'number' && Number.isInteger(rawId)
        ? rawId
        : (() => {
            throw new Error(`judge returned a non-integer tmdb_id: ${String(rawId)}`);
          })();

  const confidence = typeof o.confidence === 'number' ? o.confidence : 0;
  const reasoning = typeof o.reasoning === 'string' ? o.reasoning.trim() : '';

  return {
    tmdbId,
    confidence: Math.min(1, Math.max(0, confidence)),
    reasoning,
  };
}

/**
 * Ask the judge to pick a candidate. Returns a proposal, never a write.
 *
 * Any id the model returns that wasn't in `candidates` is discarded and
 * downgraded to "no match" with the reasoning preserved for the operator —
 * that's the hallucination guard, and it's enforced here rather than trusted
 * to the prompt.
 */
export async function judgeCandidates(
  input: JudgeInput,
  candidates: TmdbMovieSummary[],
  client?: Anthropic,
): Promise<JudgeProposal> {
  if (candidates.length === 0) {
    return { tmdbId: null, confidence: 0, reasoning: 'no candidates to choose from' };
  }

  const anthropic = client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const message = await anthropic.messages.create({
    model: JUDGE_MODEL,
    max_tokens: JUDGE_MAX_TOKENS,
    temperature: JUDGE_TEMPERATURE,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(input, candidates) }],
  });

  const textBlock = message.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('judge response had no text content');
  }

  const proposal = parseJudgeResponse(textBlock.text);
  if (proposal.tmdbId === null) return proposal;

  const allowed = new Set(candidates.map((c) => c.id));
  if (!allowed.has(proposal.tmdbId)) {
    return {
      tmdbId: null,
      confidence: 0,
      reasoning: `rejected out-of-set id ${proposal.tmdbId} (model said: ${proposal.reasoning})`,
    };
  }

  return proposal;
}
