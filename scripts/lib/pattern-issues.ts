/**
 * The GitHub side of Layer 2 — opens `matcher-pattern` issues for the cause
 * groups that `groupMisses` produced. This is the HARNESS, not the agent:
 * issue creation is a write credential (self-healing Decision #9).
 *
 * Dedup is by a stable signature marker embedded in the issue body
 * (`afiche-pattern-sig: <sig>`). GitHub issues ARE the memory — an open issue
 * with the same signature is left alone rather than re-filed, so the loop never
 * spams. Every `gh` call is best-effort: a failure logs and returns, never
 * breaking the scrape/heal that called it.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PatternGroup } from '@/scrapers/heal-patterns';

const exec = promisify(execFile);

/** Labels the loop uses that may not exist on a fresh repo. */
const ENSURE_LABELS: { name: string; color: string; description: string }[] = [
  {
    name: 'matcher-pattern',
    color: 'b60205',
    description: 'Recurring TMDB matcher gap found by self-heal Layer 2',
  },
  {
    name: 'ready-for-agent',
    color: '0e8a16',
    description: 'Fully specified, ready for an AFK agent',
  },
  {
    name: 'ready-for-human',
    color: 'fbca04',
    description: 'Requires human implementation',
  },
];

export interface OpenResult {
  created: { signature: string; url: string }[];
  skipped: { signature: string; reason: string }[];
}

async function gh(args: string[]): Promise<string> {
  const { stdout } = await exec('gh', args, { maxBuffer: 10 * 1024 * 1024 });
  return stdout.trim();
}

async function ensureLabels(): Promise<void> {
  for (const l of ENSURE_LABELS) {
    try {
      // --force updates the label if it already exists; create is idempotent.
      await gh([
        'label',
        'create',
        l.name,
        '--color',
        l.color,
        '--description',
        l.description,
        '--force',
      ]);
    } catch {
      // A repo without label-write permission still works if the labels exist;
      // if they do not, the create below will surface the real error.
    }
  }
}

/** Signatures that already have an OPEN matcher-pattern issue. */
async function openSignatures(): Promise<Set<string>> {
  const sigs = new Set<string>();
  try {
    const raw = await gh([
      'issue',
      'list',
      '--label',
      'matcher-pattern',
      '--state',
      'open',
      '--limit',
      '100',
      '--json',
      'body',
    ]);
    const issues = JSON.parse(raw) as { body: string }[];
    for (const i of issues) {
      const m = i.body?.match(/afiche-pattern-sig:\s*([a-z0-9-]+)/i);
      if (m) sigs.add(m[1]);
    }
  } catch {
    // Cannot list (auth/network) — treat as none open; create may still fail
    // per-issue, which we catch and record as skipped.
  }
  return sigs;
}

/**
 * Open an issue per group whose signature has no open issue yet. `write=false`
 * is a dry run: it reports what WOULD be filed and touches nothing.
 */
export async function openPatternIssues(
  groups: PatternGroup[],
  opts: { write: boolean },
): Promise<OpenResult> {
  const result: OpenResult = { created: [], skipped: [] };
  if (groups.length === 0) return result;

  const existing = await openSignatures();

  if (!opts.write) {
    for (const g of groups) {
      if (existing.has(g.signature)) {
        result.skipped.push({ signature: g.signature, reason: 'open issue exists' });
      } else {
        result.created.push({ signature: g.signature, url: '(dry-run — would create)' });
      }
    }
    return result;
  }

  await ensureLabels();
  for (const g of groups) {
    if (existing.has(g.signature)) {
      result.skipped.push({ signature: g.signature, reason: 'open issue exists' });
      continue;
    }
    try {
      const url = await gh([
        'issue',
        'create',
        '--title',
        g.title,
        '--body',
        g.body,
        ...g.labels.flatMap((l) => ['--label', l]),
      ]);
      result.created.push({ signature: g.signature, url });
    } catch (err) {
      result.skipped.push({
        signature: g.signature,
        reason: `gh create failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return result;
}
