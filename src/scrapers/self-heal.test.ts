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
  AUTO_APPLY_MIN_CONFIDENCE,
} = await import('./self-heal');

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
    const d = classifyProposal(p, 'Luis Ortega', { directors: ['Luis Ortega'], year: 2018 });
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
    expect(d).toEqual({ action: 'queue', reason: 'no director/year corroboration' });
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
