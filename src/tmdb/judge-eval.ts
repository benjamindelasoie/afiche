/**
 * Judge eval — scoring, kept pure so it is unit-tested without any model call.
 *
 * The split that matters: a golden case is REACHABLE only if the correct id is
 * in the candidate set the judge was shown. On reachable cases we measure the
 * judge (precision/recall). On unreachable cases the judge can only decline
 * (the hallucination guard forbids the answer), so a pick there is wrong and a
 * decline is correct — that axis measures the SEARCH's recall, not the judge.
 */

export interface GoldenCase {
  filmId: number;
  expectedTmdbId: number;
  reachable: boolean;
}

export interface JudgeOutcome {
  predicted: number | null;
  confidence: number;
}

export interface CaseResult {
  filmId: number;
  reachable: boolean;
  expected: number;
  predicted: number | null;
  confidence: number;
  correct: boolean;
  /** A wrong, confident pick — the case that would auto-write a bad override. */
  falsePositiveHighConf: boolean;
}

export function scoreCase(
  gold: GoldenCase,
  out: JudgeOutcome,
  autoApplyBar: number,
): CaseResult {
  const correct = out.predicted !== null && out.predicted === gold.expectedTmdbId;
  const wrongPick = out.predicted !== null && !correct;
  return {
    filmId: gold.filmId,
    reachable: gold.reachable,
    expected: gold.expectedTmdbId,
    predicted: out.predicted,
    confidence: out.confidence,
    correct,
    falsePositiveHighConf: wrongPick && out.confidence >= autoApplyBar,
  };
}

export interface EvalMetrics {
  total: number;
  reachable: number;
  unreachable: number;
  /** On the reachable set: */
  picks: number;
  correct: number;
  precision: number; // correct / picks (1 when no picks)
  recall: number; // correct / reachable (1 when none reachable)
  falsePositivesHighConf: number;
  /** On the unreachable set: */
  unreachableDeclinedCorrectly: number;
  unreachableFalsePicks: number;
}

export function aggregate(results: CaseResult[]): EvalMetrics {
  const reachable = results.filter((r) => r.reachable);
  const unreachable = results.filter((r) => !r.reachable);

  const picks = reachable.filter((r) => r.predicted !== null).length;
  const correct = reachable.filter((r) => r.correct).length;

  return {
    total: results.length,
    reachable: reachable.length,
    unreachable: unreachable.length,
    picks,
    correct,
    precision: picks === 0 ? 1 : correct / picks,
    recall: reachable.length === 0 ? 1 : correct / reachable.length,
    falsePositivesHighConf: results.filter((r) => r.falsePositiveHighConf).length,
    unreachableDeclinedCorrectly: unreachable.filter((r) => r.predicted === null).length,
    unreachableFalsePicks: unreachable.filter((r) => r.predicted !== null).length,
  };
}

export interface Baseline {
  precision: number;
  recall: number;
  falsePositivesHighConf: number;
}

/**
 * Compare against a committed baseline. Precision/recall may not drop by more
 * than `margin`; high-confidence false positives may not increase at all — that
 * is the safety-critical number the whole gate exists to keep at zero.
 */
export function compareToBaseline(
  m: EvalMetrics,
  base: Baseline,
  margin = 0.05,
): { ok: boolean; regressions: string[] } {
  const regressions: string[] = [];
  if (m.precision < base.precision - margin) {
    regressions.push(
      `precision ${m.precision.toFixed(3)} < baseline ${base.precision.toFixed(3)} - ${margin}`,
    );
  }
  if (m.recall < base.recall - margin) {
    regressions.push(
      `recall ${m.recall.toFixed(3)} < baseline ${base.recall.toFixed(3)} - ${margin}`,
    );
  }
  if (m.falsePositivesHighConf > base.falsePositivesHighConf) {
    regressions.push(
      `high-confidence false positives ${m.falsePositivesHighConf} > baseline ${base.falsePositivesHighConf}`,
    );
  }
  return { ok: regressions.length === 0, regressions };
}
