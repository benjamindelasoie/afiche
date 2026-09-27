// Actor 1 apply core — the safety gate between an agent proposal and a live
// override. These invariants are the eng-review P1 keystones.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeInMemoryDb, type TestDb } from '../../test/helpers/in-memory-db';
import { films, tmdbOverrides } from '@/db/schema';
import type { HealProposal } from './self-heal';

let testDb: TestDb;

vi.mock('@/db', async () => {
  const schema = await vi.importActual<typeof import('@/db/schema')>('@/db/schema');
  return {
    ...schema,
    get db() {
      return testDb;
    },
  };
});

const {
  classifyProposal,
  applyProposal,
  processProposals,
  buildHealProposals,
  computeSummaryFacts,
  yearCorroborates,
  directorCorroborates,
  titleCorroborates,
  runtimeCorroborates,
  AUTO_APPLY_MIN_CONFIDENCE,
  TITLE_AUTO_APPLY_MIN_CONFIDENCE,
  RUNTIME_TOLERANCE_MIN,
} = await import('./self-heal');

/** An exact, dominant, well-established title match — the "unambiguous" case. */
const TITLE_MATCH = {
  directors: [],
  year: null,
  title: 'Terminator 2: el juicio final',
  originalTitle: 'Terminator 2: Judgment Day',
  voteCount: 12000,
  titleDominant: true,
};

const HEAL_FILM = {
  id: 1,
  scrapedTitle: 'Stuck',
  scrapedYear: 2018,
  director: 'Dir',
  titleOriginal: null,
};
// The candidate objects are opaque to buildHealProposals (passed straight to
// the mocked judge), so a minimal stand-in is enough.
const ONE_CANDIDATE = [{ id: 100 }] as never;

function makeProposal(over: Partial<HealProposal> = {}): HealProposal {
  return {
    filmId: 1,
    scrapedTitle: 'A Film',
    scrapedYear: 2018,
    tmdbId: 100,
    confidence: 0.95,
    kind: 'candidate-judged',
    reasoning: 'looks right',
    ...over,
  };
}

const YEAR_MATCH = { directors: [], year: 2018 };
const NO_MATCH = { directors: [], year: null };

describe('classifyProposal — safety invariants', () => {
  it('NEVER auto-applies a web-researched proposal, even at max confidence + full corroboration', () => {
    const p = makeProposal({ kind: 'web-researched', confidence: 1 });
    const d = classifyProposal(p, 'Luis Ortega', {
      directors: ['Luis Ortega'],
      year: 2018,
    });
    expect(d).toEqual({ action: 'queue', reason: 'web-researched: never auto-applies' });
  });

  it('queues a candidate-judged proposal below the raised bar', () => {
    const p = makeProposal({ confidence: AUTO_APPLY_MIN_CONFIDENCE - 0.01 });
    const d = classifyProposal(p, null, YEAR_MATCH);
    expect(d.action).toBe('queue');
  });

  it('queues a confident candidate-judged proposal with NO corroboration', () => {
    const p = makeProposal({ confidence: 0.99 });
    const d = classifyProposal(p, null, NO_MATCH);
    expect(d).toEqual({
      action: 'queue',
      reason: 'no director/year/title/runtime corroboration',
    });
  });

  it('auto-applies a confident candidate-judged proposal with YEAR corroboration', () => {
    const d = classifyProposal(makeProposal(), null, YEAR_MATCH);
    expect(d).toEqual({ action: 'auto-apply' });
  });

  it('auto-applies a confident candidate-judged proposal with DIRECTOR corroboration', () => {
    const p = makeProposal({ scrapedYear: null });
    const d = classifyProposal(p, 'Radu Jude', { directors: ['Radu Jude'], year: null });
    expect(d).toEqual({ action: 'auto-apply' });
  });

  it('auto-applies an exact-unique-title match with no year/director, at the raised bar', () => {
    const p = makeProposal({
      scrapedTitle: 'TERMINATOR 2 - EL JUICIO FINAL',
      scrapedYear: null,
      confidence: 0.99,
    });
    const d = classifyProposal(p, null, TITLE_MATCH);
    expect(d).toEqual({ action: 'auto-apply' });
  });

  it('queues an exact-title match below the raised title bar', () => {
    const p = makeProposal({
      scrapedTitle: 'TERMINATOR 2 - EL JUICIO FINAL',
      scrapedYear: null,
      confidence: TITLE_AUTO_APPLY_MIN_CONFIDENCE - 0.02,
    });
    const d = classifyProposal(p, null, TITLE_MATCH);
    expect(d.action).toBe('queue');
  });

  it('queues an exact-title match with a comparable same-title rival (not dominant)', () => {
    const p = makeProposal({
      scrapedTitle: 'TERMINATOR 2 - EL JUICIO FINAL',
      scrapedYear: null,
      confidence: 0.99,
    });
    const d = classifyProposal(p, null, { ...TITLE_MATCH, titleDominant: false });
    expect(d.action).toBe('queue');
  });

  it('queues an exact-unique-title match on a long-tail film below the vote floor', () => {
    const p = makeProposal({ scrapedYear: null, confidence: 0.99 });
    const d = classifyProposal(p, null, {
      ...TITLE_MATCH,
      title: 'A Film',
      originalTitle: 'A Film',
      voteCount: 3,
    });
    expect(d.action).toBe('queue');
  });

  it('NEVER title-shortcuts past a director that actively disagrees', () => {
    const p = makeProposal({
      scrapedTitle: 'A Film',
      scrapedYear: null,
      confidence: 0.99,
    });
    const d = classifyProposal(p, 'Real Director', {
      ...TITLE_MATCH,
      title: 'A Film',
      originalTitle: 'A Film',
      directors: ['Someone Else'],
    });
    expect(d.action).toBe('queue');
  });

  // --- runtime axis (added after the Los Vencedores incident, 2026-09) -----

  it('auto-applies a confident candidate-judged proposal with RUNTIME corroboration alone', () => {
    const p = makeProposal({ scrapedYear: null, scrapedRuntimeMin: 100 });
    const d = classifyProposal(p, null, { directors: [], year: null, runtime: 99 });
    expect(d).toEqual({ action: 'auto-apply' });
  });

  it('NEVER auto-applies past a runtime that actively contradicts, even with year+director agreeing', () => {
    // The actual Los Vencedores shape: a candidate whose year/director this
    // strict of a mock made agree, but whose runtime (175) is nothing like
    // the venue-scraped listing (100) — a mismatch this large means it's a
    // different film, full stop, no matter what else lines up.
    const p = makeProposal({ confidence: 1, scrapedRuntimeMin: 100 });
    const d = classifyProposal(p, 'Dir', {
      directors: ['Dir'],
      year: p.scrapedYear,
      runtime: 175,
    });
    expect(d).toEqual({
      action: 'queue',
      reason: 'runtime mismatch: listing 100min vs candidate 175min',
    });
  });

  it('NEVER title-shortcuts past a runtime that actively contradicts', () => {
    const p = makeProposal({
      scrapedTitle: 'A Film',
      scrapedYear: null,
      scrapedRuntimeMin: 100,
      confidence: 0.99,
    });
    const d = classifyProposal(p, null, {
      ...TITLE_MATCH,
      title: 'A Film',
      originalTitle: 'A Film',
      runtime: 175,
    });
    expect(d.action).toBe('queue');
  });

  it('does not veto on a missing runtime on either side (absence corroborates nothing, contradicts nothing)', () => {
    const d = classifyProposal(makeProposal(), null, YEAR_MATCH); // no runtime set anywhere
    expect(d).toEqual({ action: 'auto-apply' });
  });
});

describe('titleCorroborates', () => {
  it('accepts an exact, unique, established title match (title or original)', () => {
    expect(titleCorroborates('TERMINATOR 2 - EL JUICIO FINAL', TITLE_MATCH)).toBe(true);
    expect(
      titleCorroborates('terminator 2 judgment day', {
        ...TITLE_MATCH,
        title: 'Otra cosa',
      }),
    ).toBe(true);
  });

  it('rejects a non-dominant, low-vote, or non-matching title', () => {
    expect(
      titleCorroborates('TERMINATOR 2 - EL JUICIO FINAL', {
        ...TITLE_MATCH,
        titleDominant: false,
      }),
    ).toBe(false);
    expect(
      titleCorroborates('TERMINATOR 2 - EL JUICIO FINAL', {
        ...TITLE_MATCH,
        voteCount: 5,
      }),
    ).toBe(false);
    expect(titleCorroborates('Something Else', TITLE_MATCH)).toBe(false);
  });
});

describe('corroboration helpers', () => {
  it('yearCorroborates within tolerance, not beyond', () => {
    expect(yearCorroborates(2018, 2018)).toBe(true);
    expect(yearCorroborates(2018, 2019)).toBe(true); // YEAR_TOLERANCE = 1
    expect(yearCorroborates(2018, 2021)).toBe(false);
    expect(yearCorroborates(null, 2018)).toBe(false);
  });

  it('directorCorroborates on a normalized/near name, not on a mismatch', () => {
    expect(directorCorroborates('Radu Jude', ['Radu Jude'])).toBe(true);
    expect(directorCorroborates('radú  jude', ['Radu Jude'])).toBe(true); // accents + spacing
    expect(directorCorroborates('Radu Jude', ['Luis Ortega'])).toBe(false);
    expect(directorCorroborates(null, ['Radu Jude'])).toBe(false);
    expect(directorCorroborates('Radu Jude', [])).toBe(false);
  });

  it('runtimeCorroborates within tolerance, not beyond', () => {
    // The real case that motivated this axis: Los Vencedores (2026-09)
    // scraped as 100 min, TMDB's correct entry is 99 — 1 minute apart.
    expect(runtimeCorroborates(100, 99)).toBe(true);
    expect(runtimeCorroborates(100, 100 + RUNTIME_TOLERANCE_MIN)).toBe(true);
    expect(runtimeCorroborates(100, 100 + RUNTIME_TOLERANCE_MIN + 1)).toBe(false);
    // The wrong candidate that HAD been picked for that same listing: 175 min.
    expect(runtimeCorroborates(100, 175)).toBe(false);
    expect(runtimeCorroborates(null, 99)).toBe(false);
    expect(runtimeCorroborates(100, null)).toBe(false);
    expect(runtimeCorroborates(undefined, 99)).toBe(false);
  });
});

describe('computeSummaryFacts', () => {
  const RIVAL_LOW_VOTES = {
    id: 1,
    title: 'Metrópolis',
    original_title: 'Metrópolis',
    vote_count: 10,
  };
  const CANONICAL = {
    id: 2,
    title: 'Metrópolis',
    original_title: 'Metropolis',
    vote_count: 3185,
  };

  it('marks the chosen candidate title-dominant when it dwarfs a same-title rival', () => {
    const facts = computeSummaryFacts(
      'METRÓPOLIS',
      [RIVAL_LOW_VOTES, CANONICAL] as never,
      2,
    );
    expect(facts).toEqual({
      title: 'Metrópolis',
      originalTitle: 'Metropolis',
      voteCount: 3185,
      titleDominant: true,
    });
  });

  it('does not mark dominant when a same-title rival is comparable', () => {
    const rival = { ...RIVAL_LOW_VOTES, vote_count: 2000 };
    const facts = computeSummaryFacts('METRÓPOLIS', [rival, CANONICAL] as never, 2);
    expect(facts.titleDominant).toBe(false);
  });

  it('is not dominant when the scraped title does not match the chosen candidate at all', () => {
    const facts = computeSummaryFacts('SOME OTHER TITLE', [CANONICAL] as never, 2);
    expect(facts.titleDominant).toBe(false);
  });
});

describe('applyProposal — DB-only write', () => {
  beforeEach(async () => {
    testDb = await makeInMemoryDb();
  });

  it('writes the durable override and re-opens the film row', async () => {
    const [f] = await testDb
      .insert(films)
      .values({ title: 'A Film', scrapedTitle: 'A Film', matchAttemptVersion: 7 })
      .returning({ id: films.id });

    await applyProposal(makeProposal({ filmId: f.id, tmdbId: 555, scrapedYear: 2018 }));

    const overrides = await testDb.select().from(tmdbOverrides);
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({ tmdbId: 555, source: 'self-heal-judge' });

    const [row] = await testDb.select().from(films).where(eq(films.id, f.id));
    expect(row.matchAttemptVersion).toBeNull();
  });
});

describe('buildHealProposals', () => {
  it('routes a film with no candidates to noCandidate', async () => {
    const res = await buildHealProposals([HEAL_FILM], {
      searchCandidates: async () => [],
      judge: async () => {
        throw new Error('judge should not be called with no candidates');
      },
    });
    expect(res.noCandidate).toEqual([HEAL_FILM]);
    expect(res.proposals).toEqual([]);
  });

  it('routes a judge decline (tmdbId null) to declined', async () => {
    const res = await buildHealProposals([HEAL_FILM], {
      searchCandidates: async () => ONE_CANDIDATE,
      judge: async () => ({ tmdbId: null, confidence: 0.2, reasoning: 'none match' }),
    });
    expect(res.declined).toEqual([HEAL_FILM]);
    expect(res.proposals).toEqual([]);
  });

  it('threads synopsisEs and runtimeMin through to the judge input when present', async () => {
    const filmWithSynopsis = {
      ...HEAL_FILM,
      synopsisEs: 'Joe y Angela están en una situación de pareja muy delicada...',
      runtimeMin: 107,
    };
    let seenInput: unknown;
    await buildHealProposals([filmWithSynopsis], {
      searchCandidates: async () => ONE_CANDIDATE,
      judge: async (input) => {
        seenInput = input;
        return { tmdbId: 100, confidence: 0.9, reasoning: 'ok' };
      },
    });
    expect(seenInput).toMatchObject({
      synopsisEs: filmWithSynopsis.synopsisEs,
      runtimeMin: 107,
    });
  });

  it('omits synopsisEs/runtimeMin from the judge input when absent, and scrapedRuntimeMin on the proposal is null', async () => {
    let seenInput: unknown;
    const res = await buildHealProposals([HEAL_FILM], {
      searchCandidates: async () => ONE_CANDIDATE,
      judge: async (input) => {
        seenInput = input;
        return { tmdbId: 100, confidence: 0.9, reasoning: 'ok' };
      },
    });
    expect((seenInput as { synopsisEs?: unknown }).synopsisEs).toBeUndefined();
    expect((seenInput as { runtimeMin?: unknown }).runtimeMin).toBeUndefined();
    expect(res.proposals[0]?.scrapedRuntimeMin).toBeNull();
  });

  it('isolates a throwing judge into errored, without aborting the run', async () => {
    const good = { ...HEAL_FILM, id: 2, scrapedTitle: 'Good' };
    const res = await buildHealProposals([HEAL_FILM, good], {
      searchCandidates: async () => ONE_CANDIDATE,
      judge: async (input) => {
        if (input.scrapedTitle === 'Stuck') throw new Error('judge blew up');
        return { tmdbId: 100, confidence: 0.9, reasoning: 'ok' };
      },
    });
    expect(res.errored).toEqual([HEAL_FILM]);
    expect(res.proposals).toHaveLength(1);
    expect(res.proposals[0].filmId).toBe(2);
  });

  it('builds a candidate-judged proposal when the judge picks an id', async () => {
    const res = await buildHealProposals([HEAL_FILM], {
      searchCandidates: async () => ONE_CANDIDATE,
      judge: async () => ({ tmdbId: 100, confidence: 0.93, reasoning: 'clear match' }),
    });
    expect(res.proposals).toEqual([
      {
        filmId: 1,
        scrapedTitle: 'Stuck',
        scrapedYear: 2018,
        scrapedRuntimeMin: null,
        tmdbId: 100,
        confidence: 0.93,
        kind: 'candidate-judged',
        reasoning: 'clear match',
      },
    ]);
  });

  it('marks a same-title match dominant when it dwarfs its rival by votes', async () => {
    // The Metrópolis case: canonical film (3185 votes) vs a same-title rival.
    const candidates = [
      { id: 19, title: 'Metrópolis', original_title: 'Metropolis', vote_count: 3185 },
      { id: 9606, title: 'Metrópolis', original_title: 'メトロポリス', vote_count: 578 },
    ] as never;
    const film = { ...HEAL_FILM, scrapedTitle: 'Metrópolis', scrapedYear: null };
    const res = await buildHealProposals([film], {
      searchCandidates: async () => candidates,
      judge: async () => ({ tmdbId: 19, confidence: 0.95, reasoning: 'Lang 1927' }),
    });
    expect(res.summaryFacts.get(film.id)?.titleDominant).toBe(true);
  });

  it('marks a same-title match NOT dominant when the rival is comparable', async () => {
    const candidates = [
      { id: 1, title: 'La invitación', original_title: 'La invitación', vote_count: 300 },
      {
        id: 2,
        title: 'La invitación',
        original_title: 'The Invitation',
        vote_count: 200,
      },
    ] as never;
    const film = { ...HEAL_FILM, scrapedTitle: 'La invitación', scrapedYear: null };
    const res = await buildHealProposals([film], {
      searchCandidates: async () => candidates,
      judge: async () => ({ tmdbId: 1, confidence: 0.95, reasoning: 'guess' }),
    });
    expect(res.summaryFacts.get(film.id)?.titleDominant).toBe(false);
  });
});

describe('processProposals — partition', () => {
  beforeEach(async () => {
    testDb = await makeInMemoryDb();
  });

  it('applies only gated proposals and queues the rest with reasons', async () => {
    const [f] = await testDb
      .insert(films)
      .values({ title: 'Keep', scrapedTitle: 'Keep', matchAttemptVersion: 7 })
      .returning({ id: films.id });

    const good = makeProposal({ filmId: f.id, tmdbId: 1, scrapedYear: 2018 });
    const research = makeProposal({ filmId: f.id, tmdbId: 2, kind: 'web-researched' });

    const result = await processProposals([good, research], async (p) => ({
      scrapedDirector: null,
      candidate: { directors: [], year: p.tmdbId === 1 ? 2018 : null },
    }));

    expect(result.applied).toEqual([good]);
    expect(result.queued).toHaveLength(1);
    expect(result.queued[0].proposal).toEqual(research);
    // Only the applied proposal wrote an override.
    expect(await testDb.select().from(tmdbOverrides)).toHaveLength(1);
  });
});
