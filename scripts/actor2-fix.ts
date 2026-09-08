/**
 * Actor 2 — the fix automation for `ready-for-agent` matcher-pattern issues.
 *
 * Consumes a container-or-placeholder issue that Layer 2 filed, writes the
 * mechanical fix (new skip words in `src/tmdb/container.ts`), adds a regression
 * test, runs the full suite, and opens a PR that links the issue — for HUMAN
 * merge (self-healing Decision #10: no auto-merge until the gate is redesigned).
 *
 * Safety gate (adapted Decision #10 "only adds matches, never damages"): before
 * writing, it checks every already-matched film against the NEW patterns. If any
 * matched film would become a skip, it aborts and leaves the issue for a human.
 *
 *   npm run actor2:fix            # first open ready-for-agent issue
 *   npm run actor2:fix -- 58      # a specific issue number
 *   npm run actor2:fix -- 58 --dry-run
 *
 * Runs on a dev machine. The safety check reads the catalog READ-ONLY.
 */

import 'dotenv/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { isNotNull } from 'drizzle-orm';
import { db, films } from '@/db';
import { isNonFilmContainer } from '@/tmdb/container';
import { stripSearchNoise } from '@/tmdb/similarity';
import { suggestContainerPatterns, uncoveredTitles } from '@/scrapers/container-suggest';

const exec = promisify(execFile);
const SIGNATURE = 'container-or-placeholder';
const CONTAINER_FILE = 'src/tmdb/container.ts';
const CONTAINER_TEST = 'src/tmdb/container.test.ts';

async function gh(args: string[]): Promise<string> {
  const { stdout } = await exec('gh', args, { maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

async function git(args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

interface Issue {
  number: number;
  title: string;
  body: string;
  labels: string[];
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
    const j = JSON.parse(raw);
    return {
      number: j.number,
      title: j.title,
      body: j.body,
      labels: j.labels.map((l: { name: string }) => l.name),
    };
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
  const arr = JSON.parse(raw) as {
    number: number;
    title: string;
    body: string;
    labels: { name: string }[];
  }[];
  if (arr.length === 0) return null;
  const j = arr[0];
  return {
    number: j.number,
    title: j.title,
    body: j.body,
    labels: j.labels.map((l) => l.name),
  };
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
      return newPatterns.some((re) => re.test(stripSearchNoise(t)));
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
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const dryRun = args.includes('--dry-run');
  const numArg = args.find((a) => /^\d+$/.test(a));
  const issue = await pickIssue(numArg ? Number(numArg) : null);

  if (!issue) {
    console.log('No open ready-for-agent matcher-pattern issue. Nothing to do.');
    return;
  }
  console.log(`Actor 2 · issue #${issue.number} — ${issue.title}`);

  if (!issue.body.includes(`afiche-pattern-sig: ${SIGNATURE}`)) {
    console.log(`Issue #${issue.number} is not a ${SIGNATURE} issue — left for a human.`);
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

  const originalBranch = await git(['branch', '--show-current']);
  const branch = `actor2/container-issue-${issue.number}`;
  await exec('git', ['fetch', '--quiet', 'origin', 'main']);
  await git(['checkout', '-B', branch, 'origin/main']);

  try {
    const containerSrc = await readFile(CONTAINER_FILE, 'utf8');
    await writeFile(
      CONTAINER_FILE,
      insertPatterns(
        containerSrc,
        suggestions.map((s) => s.regexSource),
        issue.number,
      ),
    );
    const testSrc = await readFile(CONTAINER_TEST, 'utf8');
    await writeFile(
      CONTAINER_TEST,
      appendTest(
        testSrc,
        titles.filter((t) => !uncovered.includes(t)),
        issue.number,
      ),
    );

    console.log('Running the full test suite…');
    await exec('npx', ['vitest', 'run'], { maxBuffer: 40 * 1024 * 1024 });
    await exec('npx', ['prettier', '--write', CONTAINER_FILE, CONTAINER_TEST]);
    console.log('Suite green.');

    await git(['add', CONTAINER_FILE, CONTAINER_TEST]);
    await git([
      'commit',
      '-m',
      `fix(tmdb): classify container/placeholder titles (Closes #${issue.number})\n\n` +
        `Add skip words ${suggestions.map((s) => s.keyword).join(', ')} to CONTAINER_PATTERNS so the\n` +
        `titles named in #${issue.number} stop re-queuing. Regression test added. Safety-checked:\n` +
        `no already-matched film is affected.\n\n` +
        `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`,
    ]);
    await git(['push', '--force-with-lease', 'origin', `HEAD:${branch}`]);

    const prUrl = await gh([
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
        )} to \`CONTAINER_PATTERNS\`. Regression test added; full suite passes; safety check confirmed no already-matched film flips to skip.\n\n**Human merge** (auto-merge gate not yet redesigned — Decision #10).`,
      '--label',
      'matcher-pattern',
    ]);
    console.log(`\nPR opened for human merge: ${prUrl}`);
  } finally {
    if (originalBranch) await git(['checkout', originalBranch]);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ actor2-fix failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
