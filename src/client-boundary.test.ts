/**
 * Client/server boundary invariant — no Client Component may reach `@/db/client`.
 *
 * This exists because of a total production outage on 2026-07-28. `db/client.ts`
 * throws at module evaluation when DATABASE_URL is unset, which is always true in
 * a browser. It reached the client bundle through a chain nobody would spot in
 * review:
 *
 *     app/error.tsx ('use client')
 *       -> @/app/_components/ui        (barrel — re-exports everything)
 *         -> PageFooter
 *           -> @/lib/edition           (formatLastScrape)
 *             -> @/db/queries          (formatTimeBA — a pure Intl call!)
 *               -> @/db/index -> @/db/client -> throw
 *
 * Hydration died on every route and the global error boundary replaced the whole
 * site with "La cartelera no está disponible." The catch: `next build` passed,
 * `tsc --noEmit` passed, and all 734 tests passed while shipping it — the throw
 * only happens in a browser, so nothing in CI ran the code. Server-rendered HTML
 * was perfect, which is why `curl` looked healthy the entire time it was down.
 *
 * Hence a static check rather than a runtime one. It walks the real import graph
 * from every 'use client' entry point and fails if `db/client.ts` is reachable,
 * printing the offending chain.
 *
 * Two edges are deliberately NOT followed, because neither ships to the browser:
 *   - `import type` / `export type` — erased at compile time. DateStrip.tsx
 *     legitimately does `import type { DayGroup } from '@/db/queries'`.
 *   - `'use server'` modules — an RPC boundary. Next replaces the import with a
 *     network stub, so admin/runs/refresh-button.tsx importing ./actions (which
 *     genuinely touches the DB) is correct and must not fail here.
 *
 * The narrow fix for a failure is to move the pure helper you actually need out
 * of the DB module graph, not to delete the import.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));
const FORBIDDEN = resolve(SRC, 'db/client.ts');

/** Source files, minus tests — a test importing the DB is fine. */
function allSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') allSourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/**
 * Drop comments before scanning for imports. Load-bearing: several modules
 * *describe* this very bug in prose and name '@/db/queries' inside a comment.
 * Without this, the walker would invent an edge that does not exist.
 */
function stripComments(src: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const line of src.split('\n')) {
    const t = line.trim();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      continue;
    }
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true;
      continue;
    }
    if (t.startsWith('//') || t.startsWith('*')) continue;
    out.push(line);
  }
  return out.join('\n');
}

function hasDirective(src: string, directive: 'use client' | 'use server'): boolean {
  // Directives must lead the module, so only the head matters.
  return new RegExp(`^\\s*['"]${directive}['"]`, 'm').test(
    stripComments(src).split('\n').slice(0, 5).join('\n'),
  );
}

/** Module specifiers this file pulls in at runtime (type-only edges excluded). */
function valueImports(src: string): string[] {
  const clean = stripComments(src);
  const specs: string[] = [];

  // `import ... from 'x'` / `export ... from 'x'`, skipping `import type`.
  const withFrom = /\b(?:import|export)\s+(type\s+)?([\s\S]*?)from\s*['"]([^'"]+)['"]/g;
  for (const m of clean.matchAll(withFrom)) {
    if (m[1]) continue; // `import type { ... } from` — erased
    specs.push(m[3]);
  }

  // Side-effect imports: `import 'x'`.
  for (const m of clean.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) specs.push(m[1]);

  return specs;
}

/** Resolve a local specifier to a file. Bare package names return null. */
function resolveSpec(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = resolve(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null;

  for (const cand of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
    base,
  ]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

/** BFS from a client entry point; returns the import chain to db/client.ts. */
function pathToForbidden(entry: string): string[] | null {
  const queue: string[][] = [[entry]];
  const seen = new Set([entry]);

  while (queue.length > 0) {
    const chain = queue.shift()!;
    const file = chain[chain.length - 1];
    const src = readFileSync(file, 'utf8');

    // 'use server' is an RPC boundary — the module never reaches the browser.
    if (file !== entry && hasDirective(src, 'use server')) continue;

    for (const spec of valueImports(src)) {
      const target = resolveSpec(spec, file);
      if (!target) continue;
      if (target === FORBIDDEN) return [...chain, target];
      if (!seen.has(target)) {
        seen.add(target);
        queue.push([...chain, target]);
      }
    }
  }
  return null;
}

const rel = (p: string) => `src/${p.slice(SRC.length + 1)}`;

describe('client/server boundary', () => {
  const clientEntries = allSourceFiles(SRC).filter((f) =>
    hasDirective(readFileSync(f, 'utf8'), 'use client'),
  );

  it("finds the repo's Client Components", () => {
    // Guards the guard: if the directive scan silently matched nothing, every
    // assertion below would vacuously pass and this file would protect nothing.
    expect(clientEntries.length).toBeGreaterThan(0);
  });

  it('db/client.ts exists at the path this test forbids', () => {
    // Same reason: a rename would make the reachability check unfalsifiable.
    expect(existsSync(FORBIDDEN)).toBe(true);
  });

  it.each(clientEntries.map((f) => [rel(f), f]))(
    '%s does not reach db/client.ts',
    (_name, entry) => {
      const chain = pathToForbidden(entry as string);
      expect(
        chain,
        chain
          ? `Client Component pulls the DB client into the browser bundle:\n  ${chain
              .map(rel)
              .join('\n    -> ')}\n\ndb/client.ts throws at module evaluation when ` +
              `DATABASE_URL is unset, which is always true in a browser — this ` +
              `breaks hydration on every route that loads this chunk.\nMove the ` +
              `value you need into a DB-free module (see @/lib/date-ranges).`
          : undefined,
      ).toBeNull();
    },
  );
});
