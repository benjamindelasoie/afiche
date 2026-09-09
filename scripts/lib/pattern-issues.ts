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

import type { PatternGroup } from '@/scrapers/heal-patterns';
import { readSignature } from '@/scrapers/issue-protocol';
import { gh } from './proc';

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

async function ensureLabels(): Promise<void> {
  // The three creates are independent and idempotent (--force upserts) — fire
  // them together. A repo without label-write permission still works if the
  // labels exist; if they do not, the issue create below surfaces the error.
  await Promise.all(
    ENSURE_LABELS.map((l) =>
      gh([
        'label',
        'create',
        l.name,
        '--color',
        l.color,
        '--description',
        l.description,
        '--force',
      ]).catch(() => {}),
    ),
  );
}

/** A just-fixed cause is on cooldown: don't re-file while the fix propagates. */
const CLOSED_COOLDOWN_DAYS = 14;

/**
 * Signatures that are "taken": an OPEN matcher-pattern issue, OR one closed
 * within the cooldown. The cooldown closes the window where a fix PR has merged
 * (closing the issue) but the scrape box has not yet pulled the fix, so one more
 * run would otherwise re-open a duplicate of a cause that is already handled.
 */
async function takenSignatures(now: Date): Promise<Set<string>> {
  const sigs = new Set<string>();
  const cooldownStart = now.getTime() - CLOSED_COOLDOWN_DAYS * 86_400_000;
  try {
    const raw = await gh([
      'issue',
      'list',
      '--label',
      'matcher-pattern',
      '--state',
      'all',
      '--limit',
      '100',
      '--json',
      'body,state,closedAt',
    ]);
    const issues = JSON.parse(raw) as {
      body: string;
      state: string;
      closedAt: string | null;
    }[];
    for (const i of issues) {
      const sig = readSignature(i.body);
      if (!sig) continue;
      const isOpen = i.state?.toUpperCase() === 'OPEN';
      const recentlyClosed =
        i.closedAt != null && new Date(i.closedAt).getTime() >= cooldownStart;
      if (isOpen || recentlyClosed) sigs.add(sig);
    }
  } catch {
    // Cannot list (auth/network) — treat as none taken; create may still fail
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

  const existing = await takenSignatures(new Date());

  if (!opts.write) {
    for (const g of groups) {
      if (existing.has(g.signature)) {
        result.skipped.push({
          signature: g.signature,
          reason: 'open or recently-fixed issue exists',
        });
      } else {
        result.created.push({ signature: g.signature, url: '(dry-run — would create)' });
      }
    }
    return result;
  }

  await ensureLabels();
  for (const g of groups) {
    if (existing.has(g.signature)) {
      result.skipped.push({
        signature: g.signature,
        reason: 'open or recently-fixed issue exists',
      });
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
