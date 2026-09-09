/**
 * Run the judge eval — grade the LLM judge against the frozen golden set.
 *
 * Deterministic in everything but the model: the candidate lists are frozen, so
 * a metric move is the model or the prompt, not TMDB. Reports precision/recall
 * on the reachable set, the safety-critical high-confidence-false-positive
 * count, and the search-reachability split. Exits nonzero on a regression vs the
 * committed baseline (so it can gate CI).
 *
 *   npm run eval:judge:prod                    # grade against the baseline
 *   npm run eval:judge:prod -- --update-baseline
 *
 * Needs ANTHROPIC_API_KEY (real Haiku calls, ~one per case, pennies).
 */

import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  judgeCandidates,
  JUDGE_AUTO_ACCEPT_CONFIDENCE,
  type JudgeInput,
} from '@/tmdb/judge';
import type { TmdbMovieSummary } from '@/tmdb/client';
import {
  scoreCase,
  aggregate,
  compareToBaseline,
  type CaseResult,
  type Baseline,
} from '@/tmdb/judge-eval';

interface GoldenFixture {
  filmId: number;
  source: string;
  input: JudgeInput;
  expectedTmdbId: number;
  reachable: boolean;
  candidates: TmdbMovieSummary[];
}

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN = resolve(here, '..', '..', 'test', 'fixtures', 'judge-golden.json');
const BASELINE = resolve(
  here,
  '..',
  '..',
  'test',
  'fixtures',
  'judge-eval-baseline.json',
);

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const updateBaseline = process.argv.includes('--update-baseline');

  const fixtures = JSON.parse(await readFile(GOLDEN, 'utf8')) as GoldenFixture[];
  console.log(`Grading the judge on ${fixtures.length} golden cases…\n`);

  const results: CaseResult[] = [];
  for (const f of fixtures) {
    const verdict = await judgeCandidates(f.input, f.candidates).catch(() => ({
      tmdbId: null,
      confidence: 0,
      reasoning: 'errored',
    }));
    const r = scoreCase(
      { filmId: f.filmId, expectedTmdbId: f.expectedTmdbId, reachable: f.reachable },
      { predicted: verdict.tmdbId, confidence: verdict.confidence },
      JUDGE_AUTO_ACCEPT_CONFIDENCE,
    );
    results.push(r);
    if (r.reachable && !r.correct) {
      const mark = r.falsePositiveHighConf ? '‼️ HIGH-CONF WRONG' : '· miss';
      console.log(
        `${mark}  "${f.input.scrapedTitle}" expected ${r.expected}, got ${r.predicted} (conf ${r.confidence.toFixed(2)})`,
      );
    }
  }

  const m = aggregate(results);
  console.log(
    `\n=== Judge eval ===\n` +
      `cases: ${m.total} (reachable ${m.reachable} · unreachable/search-miss ${m.unreachable})\n` +
      `precision: ${m.precision.toFixed(3)}  (correct ${m.correct} / picks ${m.picks})\n` +
      `recall:    ${m.recall.toFixed(3)}  (correct ${m.correct} / reachable ${m.reachable})\n` +
      `high-confidence false positives: ${m.falsePositivesHighConf}\n` +
      `unreachable handled: ${m.unreachableDeclinedCorrectly} declined · ${m.unreachableFalsePicks} wrong-pick`,
  );

  if (updateBaseline) {
    const base: Baseline = {
      precision: Number(m.precision.toFixed(3)),
      recall: Number(m.recall.toFixed(3)),
      falsePositivesHighConf: m.falsePositivesHighConf,
    };
    await writeFile(BASELINE, JSON.stringify(base, null, 2) + '\n');
    console.log(`\nBaseline written → ${BASELINE}`);
    return;
  }

  let base: Baseline | null = null;
  try {
    base = JSON.parse(await readFile(BASELINE, 'utf8')) as Baseline;
  } catch {
    console.log('\nNo baseline yet — run with --update-baseline to set one.');
    return;
  }

  const cmp = compareToBaseline(m, base);
  if (cmp.ok) {
    console.log('\n✅ No regression vs baseline.');
  } else {
    console.log(`\n❌ Regression vs baseline:\n  ${cmp.regressions.join('\n  ')}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('❌ judge eval failed:', err);
  process.exit(1);
});
