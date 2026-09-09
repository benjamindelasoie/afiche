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
import { z } from 'zod';
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
/** Total attempts (initial + retries) to get a well-formed verdict per film. */
export const JUDGE_MAX_ATTEMPTS = 3;

/**
 * The verdict contract. tmdb_id and confidence are decision-critical, so a reply
 * missing or mistyping them is malformed and triggers a retry; reasoning is
 * advisory and defaults to empty. Extra keys are ignored. Confidence is clamped
 * to [0,1] after validation — an out-of-range number is a value bug, not a
 * format bug, and does not warrant a retry.
 */
const JudgeResponseSchema = z.object({
  tmdb_id: z.union([z.number().int(), z.null()]),
  confidence: z.number(),
  reasoning: z.string().default(''),
});

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

/** Thrown when a reply cannot be parsed into a valid verdict — retriable. */
export class JudgeParseError extends Error {}

/**
 * Parse the judge's reply against the verdict schema. Tolerant of ```json fences
 * because models add them despite instructions; strict about the contract, since
 * a malformed verdict must not become a silent "no match". Throws JudgeParseError
 * on any format violation so the caller can retry.
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
    throw new JudgeParseError(`judge returned non-JSON: ${raw.slice(0, 200)}`);
  }

  const result = JudgeResponseSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new JudgeParseError(`judge verdict failed schema: ${issues}`);
  }

  return {
    tmdbId: result.data.tmdb_id,
    confidence: Math.min(1, Math.max(0, result.data.confidence)),
    reasoning: result.data.reasoning.trim(),
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
  const allowed = new Set(candidates.map((c) => c.id));

  // Retry only on a malformed reply — a formatting blip, not a verdict. A valid
  // verdict (including a rejected out-of-set id) returns immediately.
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: buildUserPrompt(input, candidates) },
  ];
  let lastError: unknown;
  for (let attempt = 1; attempt <= JUDGE_MAX_ATTEMPTS; attempt++) {
    const message = await anthropic.messages.create({
      model: JUDGE_MODEL,
      max_tokens: JUDGE_MAX_TOKENS,
      temperature: JUDGE_TEMPERATURE,
      system: SYSTEM_PROMPT,
      messages,
    });
    const textBlock = message.content.find((b) => b.type === 'text');
    const text = textBlock && textBlock.type === 'text' ? textBlock.text : '';

    try {
      const proposal = parseJudgeResponse(text);
      if (proposal.tmdbId === null) return proposal;
      if (!allowed.has(proposal.tmdbId)) {
        return {
          tmdbId: null,
          confidence: 0,
          reasoning: `rejected out-of-set id ${proposal.tmdbId} (model said: ${proposal.reasoning})`,
        };
      }
      return proposal;
    } catch (err) {
      if (!(err instanceof JudgeParseError)) throw err;
      lastError = err;
      if (attempt < JUDGE_MAX_ATTEMPTS) {
        messages.push({ role: 'assistant', content: text || '(empty)' });
        messages.push({ role: 'user', content: RETRY_NUDGE });
      }
    }
  }
  throw new JudgeParseError(
    `judge produced no valid verdict in ${JUDGE_MAX_ATTEMPTS} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

const RETRY_NUDGE =
  'Your previous reply was not valid. Respond with ONLY a JSON object of the form ' +
  '{"tmdb_id": <number|null>, "confidence": <0..1>, "reasoning": "<one sentence>"} — ' +
  'no markdown fences, no commentary.';
