import { describe, it, expect } from 'vitest';
import {
  scoreCase,
  aggregate,
  compareToBaseline,
  type GoldenCase,
  type CaseResult,
} from './judge-eval';

const BAR = 0.9;
const reach = (over: Partial<GoldenCase> = {}): GoldenCase => ({
  filmId: 1,
  expectedTmdbId: 100,
  reachable: true,
  ...over,
});

describe('scoreCase', () => {
  it('marks a correct pick correct, no false positive', () => {
    const r = scoreCase(reach(), { predicted: 100, confidence: 0.95 }, BAR);
    expect(r.correct).toBe(true);
    expect(r.falsePositiveHighConf).toBe(false);
  });

  it('flags a confident wrong pick as a high-confidence false positive', () => {
    const r = scoreCase(reach(), { predicted: 200, confidence: 0.95 }, BAR);
    expect(r.correct).toBe(false);
    expect(r.falsePositiveHighConf).toBe(true);
  });

  it('a wrong pick below the bar is NOT a high-confidence false positive', () => {
    const r = scoreCase(reach(), { predicted: 200, confidence: 0.5 }, BAR);
    expect(r.falsePositiveHighConf).toBe(false);
  });

  it('a decline is neither correct nor a false positive', () => {
    const r = scoreCase(reach(), { predicted: null, confidence: 0 }, BAR);
    expect(r.correct).toBe(false);
    expect(r.falsePositiveHighConf).toBe(false);
  });
});

describe('aggregate', () => {
  it('computes precision/recall on the reachable set only', () => {
    const results: CaseResult[] = [
      scoreCase(
        reach({ filmId: 1, expectedTmdbId: 10 }),
        { predicted: 10, confidence: 0.9 },
        BAR,
      ),
      scoreCase(
        reach({ filmId: 2, expectedTmdbId: 20 }),
        { predicted: 99, confidence: 0.5 },
        BAR,
      ),
      scoreCase(
        reach({ filmId: 3, expectedTmdbId: 30 }),
        { predicted: null, confidence: 0 },
        BAR,
      ),
      // unreachable: a decline is correct handling, a pick is a wrong pick
      scoreCase(
        reach({ filmId: 4, expectedTmdbId: 40, reachable: false }),
        { predicted: null, confidence: 0 },
        BAR,
      ),
      scoreCase(
        reach({ filmId: 5, expectedTmdbId: 50, reachable: false }),
        { predicted: 88, confidence: 0.8 },
        BAR,
      ),
    ];
    const m = aggregate(results);
    expect(m.reachable).toBe(3);
    expect(m.unreachable).toBe(2);
    expect(m.picks).toBe(2); // films 1 and 2 picked
    expect(m.correct).toBe(1); // only film 1
    expect(m.precision).toBeCloseTo(0.5); // 1 of 2 picks
    expect(m.recall).toBeCloseTo(1 / 3); // 1 of 3 reachable
    expect(m.unreachableDeclinedCorrectly).toBe(1);
    expect(m.unreachableFalsePicks).toBe(1);
  });
});

describe('compareToBaseline', () => {
  const base = { precision: 0.9, recall: 0.8, falsePositivesHighConf: 0 };

  it('passes when within margin and no new false positives', () => {
    const r = compareToBaseline(
      { ...base, precision: 0.87, recall: 0.77 } as never,
      base,
      0.05,
    );
    expect(r.ok).toBe(true);
  });

  it('fails on a precision drop beyond the margin', () => {
    const r = compareToBaseline({ ...base, precision: 0.8 } as never, base, 0.05);
    expect(r.ok).toBe(false);
    expect(r.regressions[0]).toMatch(/precision/);
  });

  it('fails on ANY increase in high-confidence false positives', () => {
    const r = compareToBaseline(
      { ...base, falsePositivesHighConf: 1 } as never,
      base,
      0.05,
    );
    expect(r.ok).toBe(false);
    expect(r.regressions[0]).toMatch(/false positive/);
  });
});
