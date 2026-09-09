/**
 * Shared subprocess helpers for the self-heal scripts — one `gh`/`git` wrapper
 * so the harness (pattern-issues) and Actor 2 don't each carry their own copy.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const MAX_BUFFER = 10 * 1024 * 1024;

export async function gh(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await exec('gh', args, { maxBuffer: MAX_BUFFER, cwd });
  return stdout.trim();
}

export async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await exec('git', args, { maxBuffer: MAX_BUFFER, cwd });
  return stdout.trim();
}

/** Run an arbitrary command (e.g. npx) — for the few non-gh/git calls. */
export async function run(
  file: string,
  args: string[],
  opts: { cwd?: string; maxBuffer?: number } = {},
): Promise<string> {
  const { stdout } = await exec(file, args, {
    maxBuffer: opts.maxBuffer ?? MAX_BUFFER,
    cwd: opts.cwd,
  });
  return stdout.trim();
}
