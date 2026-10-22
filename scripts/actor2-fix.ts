/**
 * Actor 2 — the fix automation for `ready-for-agent` matcher-pattern issues.
 *
 * Consumes a container-or-placeholder issue that Layer 2 filed, writes the
 * mechanical fix (new skip words in `src/tmdb/container.ts`), adds a regression
 * test, runs the full suite in an isolated worktree, and opens a PR that links
 * the issue — for a HUMAN to review and merge. Actor 2 NEVER merges. It is
 * idempotent: if a PR already exists for the issue (open, merged, or a human's
 * rejecting close), it does nothing.
 *
 * Safety gate: before writing, it checks every already-matched film against the
 * NEW patterns (mirroring production on the noise-stripped title). If any matched
 * film would flip to skip, it aborts and leaves the issue for a human.
 *
 *   npm run actor2:fix -- 58              # open a PR for issue 58
 *   npm run actor2:fix -- 58 --dry-run    # classify + safety-check only
 *   npm run actor2:fix:prod              # first open issue, fix, open a PR
 *
 * Runs in a throwaway git worktree so it never disturbs the live checkout — safe
 * to chain after the scrape. The safety check reads the catalog READ-ONLY.
 */

import 'dotenv/config';
import { readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isNotNull } from 'drizzle-orm';
import { db, films } from '@/db';
import { isNonFilmContainer } from '@/tmdb/container';
import { stripSearchNoise } from '@/tmdb/similarity';
import { suggestContainerPatterns, uncoveredTitles } from '@/scrapers/container-suggest';
import { readSignature } from '@/scrapers/issue-protocol';
import { flagEnabled } from '@/lib/flags';
import { gh, git, run } from './lib/proc';

const SIGNATURE = 'container-or-placeholder';
const CONTAINER_FILE = 'src/tmdb/container.ts';
const CONTAINER_TEST = 'src/tmdb/container.test.ts';

interface Issue {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

interface RawIssue {
  number: number;
  title: string;
  body: string;
  labels: { name: string }[];
}

function toIssue(j: RawIssue): Issue {
  return {
    number: j.number,
    title: j.title,
    body: j.body,
    labels: j.labels.map((l) => l.name),
  };
}

async function pickIssue(explicit: number | null): Promise<Issue | null> {
  if (explicit !== null) {
    const raw = await gh([
      'issue',
      'view',
      String(explicit),
      '--json',
      'number,title,body,labels',
    ]);
    return toIssue(JSON.parse(raw) as RawIssue);
  }
  const raw = await gh([
    'issue',
    'list',
    '--label',
    'matcher-pattern',
    '--label',
    'ready-for-agent',
    '--state',
    'open',
    '--limit',
    '1',
    '--json',
    'number,title,body,labels',
  ]);
  const arr = JSON.parse(raw) as RawIssue[];
  return arr.length > 0 ? toIssue(arr[0]) : null;
}

/** The most recent PR for a branch, in any state, or null if none exists. */
async function prForBranch(
  branch: string,
): Promise<{ url: string; state: string } | null> {
  try {
    const raw = await gh([
      'pr',
      'list',
      '--head',
      branch,
      '--state',
      'all',
      '--limit',
      '1',
      '--json',
      'url,state',
    ]);
    const arr = JSON.parse(raw) as { url: string; state: string }[];
    return arr.length > 0 ? arr[0] : null;
  } catch {
    return null;
  }
}

/** Parse `- <id> — <title>` evidence lines; drop the trailing `— dir. X` tail. */
function parseFilmTitles(body: string): string[] {
  const titles: string[] = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^-\s+\d+\s+—\s+(.+)$/);
    if (!m) continue;
    // Strip a trailing " — dir. Foo" or " (1966)" is kept (part of the title shape).
    const title = m[1].replace(/\s+—\s+dir\.\s+.*$/i, '').trim();
    if (title) titles.push(title);
  }
  return titles;
}

/**
 * No already-matched film may be flipped to a container by the new patterns.
 * Mirrors production exactly: `isNonFilmContainer` applies its patterns to the
 * NOISE-STRIPPED title, so a matched film flips only when a NEW pattern matches
 * its stripped title and it was not already caught.
 */
async function safetyCheck(
  newPatterns: RegExp[],
): Promise<{ ok: boolean; casualties: string[] }> {
  const matched = await db
    .select({ scrapedTitle: films.scrapedTitle })
    .from(films)
    .where(isNotNull(films.tmdbId));
  const casualties = matched
    .map((f) => f.scrapedTitle)
    .filter((t) => {
      if (!t || isNonFilmContainer(t)) return false; // already skipped anyway
      const stripped = stripSearchNoise(t);
      return newPatterns.some((re) => re.test(stripped));
    });
  return { ok: casualties.length === 0, casualties };
}

function insertPatterns(
  source: string,
  regexSources: string[],
  issueNum: number,
): string {
  const opener = 'const CONTAINER_PATTERNS: RegExp[] = [\n';
  const idx = source.indexOf(opener);
  if (idx === -1)
    throw new Error(`could not find CONTAINER_PATTERNS array in ${CONTAINER_FILE}`);
  const block =
    `  // Added by Actor 2 (issue #${issueNum}): container/placeholder skip words.\n` +
    regexSources.map((r) => `  /${r}/i,`).join('\n') +
    '\n';
  const at = idx + opener.length;
  return source.slice(0, at) + block + source.slice(at);
}

function appendTest(source: string, titles: string[], issueNum: number): string {
  const cases = titles.map((t) => `    ['${t.replace(/'/g, "\\'")}', true],`).join('\n');
  const block =
    `\ndescribe('container classifier — issue #${issueNum} regressions', () => {\n` +
    `  it.each([\n${cases}\n  ])('classifies %j as container=%s', (title, expected) => {\n` +
    `    expect(isNonFilmContainer(title as string)).toBe(expected);\n` +
    `  });\n});\n`;
  return source.trimEnd() + '\n' + block;
}

async function main() {
  if (!flagEnabled('ACTOR2_ENABLED')) {
    console.log('Actor 2 disabled via ACTOR2_ENABLED=off — skipping.');
    return;
  }
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const dryRun = args.includes('--dry-run');
  const numArg = args.find((a) => /^\d+$/.test(a));
  const issue = await pickIssue(numArg ? Number(numArg) : null);

  if (!issue) {
    console.log('No open ready-for-agent matcher-pattern issue. Nothing to do.');
    return;
  }
  console.log(`Actor 2 · issue #${issue.number} — ${issue.title}`);

  if (readSignature(issue.body) !== SIGNATURE) {
    console.log(`Issue #${issue.number} is not a ${SIGNATURE} issue — left for a human.`);
    return;
  }

  // Idempotent: never re-open a PR for this issue. If one already exists in ANY
  // state, the human is handling it — open means waiting for review, closed means
  // they rejected the fix, merged means done. Actor 2 proposes once.
  const branch = `actor2/container-issue-${issue.number}`;
  const existingPr = await prForBranch(branch);
  if (existingPr) {
    console.log(
      `PR already exists for #${issue.number} (${existingPr.url}, ${existingPr.state}) — leaving it to you.`,
    );
    return;
  }

  const titles = parseFilmTitles(issue.body);
  const suggestions = suggestContainerPatterns(titles, isNonFilmContainer);
  const uncovered = uncoveredTitles(titles, isNonFilmContainer);
  if (suggestions.length === 0) {
    console.log(
      'No mechanical container keyword found for these titles — left for a human.',
    );
    if (uncovered.length) console.log('Uncovered:', uncovered.join(', '));
    return;
  }
  console.log(`Proposed skip words: ${suggestions.map((s) => s.keyword).join(', ')}`);
  if (uncovered.length)
    console.log(`(still uncovered, not this fix: ${uncovered.join(', ')})`);

  const newPatterns = suggestions.map((s) => new RegExp(s.regexSource, 'i'));
  const safety = await safetyCheck(newPatterns);
  if (!safety.ok) {
    console.log(
      `ABORT — these already-matched films would be wrongly skipped:\n  ${safety.casualties.join('\n  ')}`,
    );
    console.log('Leaving the issue open for a human.');
    return;
  }
  console.log('Safety check passed: no already-matched film is affected.');

  if (dryRun) {
    console.log('Dry run — no branch, no edit, no PR.');
    return;
  }

  // Work in a throwaway worktree so we never touch the live checkout's branch
  // (on the scrape box, a stray branch switch would break the next --ff-only
  // pull). node_modules is symlinked from the main repo so the suite can run.
  const repoRoot = await git(['rev-parse', '--show-toplevel']);
  const wt = join(tmpdir(), `afiche-actor2-${issue.number}-${Date.now()}`);
  await git(['fetch', '--quiet', 'origin', 'main'], repoRoot);
  await git(['worktree', 'add', '--force', '-B', branch, wt, 'origin/main'], repoRoot);

  try {
    await symlink(join(repoRoot, 'node_modules'), join(wt, 'node_modules'), 'dir').catch(
      () => {},
    );

    const containerPath = join(wt, CONTAINER_FILE);
    const testPath = join(wt, CONTAINER_TEST);
    await writeFile(
      containerPath,
      insertPatterns(
        await readFile(containerPath, 'utf8'),
        suggestions.map((s) => s.regexSource),
        issue.number,
      ),
    );
    await writeFile(
      testPath,
      appendTest(
        await readFile(testPath, 'utf8'),
        titles.filter((t) => !uncovered.includes(t)),
        issue.number,
      ),
    );

    console.log('Running the full test suite…');
    await run('npx', ['vitest', 'run'], { cwd: wt, maxBuffer: 40 * 1024 * 1024 });
    await run('npx', ['prettier', '--write', CONTAINER_FILE, CONTAINER_TEST], {
      cwd: wt,
    });
    console.log('Suite green.');

    await git(['add', CONTAINER_FILE, CONTAINER_TEST], wt);
    await git(
      [
        'commit',
        '-m',
        `fix(tmdb): classify container/placeholder titles (Closes #${issue.number})\n\n` +
          `Add skip words ${suggestions.map((s) => s.keyword).join(', ')} to CONTAINER_PATTERNS so the\n` +
          `titles named in #${issue.number} stop re-queuing. Regression test added. Safety-checked:\n` +
          `no already-matched film is affected.\n\n` +
          `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`,
      ],
      wt,
    );
    // Force is safe: Actor 2 is the sole writer of actor2/* branches, and each
    // run rebuilds the branch from origin/main in a fresh worktree.
    await git(['push', '--force', 'origin', `HEAD:${branch}`], wt);

    const prUrl = await gh(
      [
        'pr',
        'create',
        '--base',
        'main',
        '--head',
        branch,
        '--title',
        `fix(tmdb): container skip words for #${issue.number}`,
        '--body',
        `Closes #${issue.number}.\n\nMechanical fix by Actor 2: adds ${suggestions
          .map((s) => '`' + s.keyword + '`')
          .join(
            ', ',
          )} to \`CONTAINER_PATTERNS\`. Regression test added; full suite passes; safety check confirmed no already-matched film flips to skip.\n\n**Review and merge when you're happy** — Actor 2 never merges.`,
        '--label',
        'matcher-pattern',
      ],
      wt,
    );
    console.log(`\nPR opened for your review + merge: ${prUrl}`);
    console.log('Actor 2 will not touch this issue again while the PR exists.');
  } finally {
    await git(['worktree', 'remove', '--force', wt], repoRoot).catch(() => {});
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ actor2-fix failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
