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
  yearCorroborates,
  directorCorroborates,
  titleCorroborates,
  AUTO_APPLY_MIN_CONFIDENCE,
  TITLE_AUTO_APPLY_MIN_CONFIDENCE,
} = await import('./self-heal');

/** An exact, unique, well-established title match — the "unambiguous" case. */
const TITLE_MATCH = {
  directors: [],
  year: null,
  title: 'Terminator 2: el juicio final',
  originalTitle: 'Terminator 2: Judgment Day',
  voteCount: 12000,
  titleUniqueInSet: true,
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
      reason: 'no director/year/title corroboration',
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

  it('queues an exact-title match that is NOT unique in the candidate set', () => {
    const p = makeProposal({
      scrapedTitle: 'TERMINATOR 2 - EL JUICIO FINAL',
      scrapedYear: null,
      confidence: 0.99,
    });
    const d = classifyProposal(p, null, { ...TITLE_MATCH, titleUniqueInSet: false });
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

  it('rejects a non-unique, low-vote, or non-matching title', () => {
    expect(
      titleCorroborates('TERMINATOR 2 - EL JUICIO FINAL', {
        ...TITLE_MATCH,
        titleUniqueInSet: false,
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
        tmdbId: 100,
        confidence: 0.93,
        kind: 'candidate-judged',
        reasoning: 'clear match',
      },
    ]);
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
