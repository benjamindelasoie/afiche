/**
 * Tests for the LLM judge. The Anthropic client is injected, so no network.
 *
 * The guard under test is the one that makes the whole approach safe: the
 * model may only pick from the candidate list it was shown. Everything else
 * here is prompt shaping and response tolerance.
 */

import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import type { TmdbMovieSummary } from './client';
import {
  judgeCandidates,
  parseJudgeResponse,
  buildUserPrompt,
  JUDGE_MODEL,
} from './judge';

function candidate(overrides: Partial<TmdbMovieSummary>): TmdbMovieSummary {
  return {
    id: 0,
    title: '',
    original_title: '',
    original_language: 'en',
    release_date: '',
    overview: '',
    poster_path: null,
    backdrop_path: null,
    popularity: 0,
    vote_count: 0,
    vote_average: 0,
    ...overrides,
  };
}

/** Minimal stand-in for the Anthropic SDK returning one text block. */
function stubClient(text: string) {
  const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text }] });
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const RESERVOIR = candidate({
  id: 500,
  title: 'Perros de reserva',
  original_title: 'Reservoir Dogs',
  release_date: '1992-09-02',
});
const DECOY = candidate({
  id: 999,
  title: 'Perros de la calle',
  original_title: 'Street Dogs',
  release_date: '2015-01-01',
});

describe('parseJudgeResponse', () => {
  it('reads a clean verdict', () => {
    expect(
      parseJudgeResponse('{"tmdb_id": 500, "confidence": 0.93, "reasoning": "x"}'),
    ).toEqual({ tmdbId: 500, confidence: 0.93, reasoning: 'x' });
  });

  it('tolerates markdown fences the prompt forbids', () => {
    const r = parseJudgeResponse(
      '```json\n{"tmdb_id": 500, "confidence": 1, "reasoning": "y"}\n```',
    );
    expect(r.tmdbId).toBe(500);
  });

  it('accepts an explicit null verdict', () => {
    const r = parseJudgeResponse(
      '{"tmdb_id": null, "confidence": 0, "reasoning": "not here"}',
    );
    expect(r.tmdbId).toBeNull();
  });

  it('clamps confidence into [0,1]', () => {
    expect(
      parseJudgeResponse('{"tmdb_id":1,"confidence":4,"reasoning":""}').confidence,
    ).toBe(1);
    expect(
      parseJudgeResponse('{"tmdb_id":1,"confidence":-2,"reasoning":""}').confidence,
    ).toBe(0);
  });

  it('throws rather than silently reading a malformed verdict as "no match"', () => {
    expect(() => parseJudgeResponse('I think it is Reservoir Dogs')).toThrow(/non-JSON/);
    expect(() => parseJudgeResponse('{"tmdb_id": "500"}')).toThrow(/non-integer/);
  });
});

describe('buildUserPrompt', () => {
  it('includes the listing context and every candidate id', () => {
    const p = buildUserPrompt(
      { scrapedTitle: 'PERROS DE LA CALLE', year: 1992, venues: ['Cineclub Lucero'] },
      [RESERVOIR, DECOY],
    );
    expect(p).toContain('PERROS DE LA CALLE');
    expect(p).toContain('Listing year: 1992');
    expect(p).toContain('Cineclub Lucero');
    expect(p).toContain('tmdb_id=500');
    expect(p).toContain('tmdb_id=999');
  });

  it('omits absent fields rather than printing empties', () => {
    const p = buildUserPrompt({ scrapedTitle: 'SUSPIRIA' }, [RESERVOIR]);
    expect(p).not.toContain('Listing year');
    expect(p).not.toContain('Listing director');
    expect(p).not.toContain('Programmed by');
  });
});

describe('judgeCandidates — hallucination guard', () => {
  const input = { scrapedTitle: 'PERROS DE LA CALLE', year: 1992 };

  it('accepts an id that is in the candidate set', async () => {
    const { client, create } = stubClient(
      '{"tmdb_id": 500, "confidence": 0.95, "reasoning": "AR release title for Reservoir Dogs"}',
    );
    const r = await judgeCandidates(input, [RESERVOIR, DECOY], client);
    expect(r.tmdbId).toBe(500);
    expect(r.confidence).toBeCloseTo(0.95);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: JUDGE_MODEL }));
  });

  it('REJECTS an id the model produced from memory', async () => {
    // 111 is a real TMDB id for Scarface — plausible, well-known, and NOT in
    // the shortlist. Trusting it would be the failure mode that makes an LLM
    // unsafe here, so it must be discarded rather than written.
    const { client } = stubClient(
      '{"tmdb_id": 111, "confidence": 0.99, "reasoning": "I am certain"}',
    );
    const r = await judgeCandidates(input, [RESERVOIR, DECOY], client);
    expect(r.tmdbId).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.reasoning).toContain('rejected out-of-set id 111');
    // The model's own words survive so the operator can see what it claimed.
    expect(r.reasoning).toContain('I am certain');
  });

  it('passes a null verdict through untouched', async () => {
    const { client } = stubClient(
      '{"tmdb_id": null, "confidence": 0.2, "reasoning": "none of these"}',
    );
    const r = await judgeCandidates(input, [RESERVOIR, DECOY], client);
    expect(r.tmdbId).toBeNull();
    expect(r.reasoning).toBe('none of these');
  });

  it('short-circuits without calling the model when there is nothing to choose', async () => {
    const { client, create } = stubClient('unused');
    const r = await judgeCandidates(input, [], client);
    expect(r.tmdbId).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
