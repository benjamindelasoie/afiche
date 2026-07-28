/**
 * Layout invariant tests.
 *
 * These tests pin contracts that, if broken, cause the kind of mobile-
 * overflow bug we hit on 2026-05-03. The bug: `<main>` was sized to its
 * content's natural width (~1024px) on a 375px viewport because of a
 * flexbox `min-width: auto` interaction with `mx-auto` + `max-w-5xl`.
 * Symptom: `body.scrollWidth > viewport.innerWidth`, cards stretched
 * full content width, page horizontally scrolled.
 *
 * Root cause + fix documented in CLAUDE.md → "Frontend conventions" → #1.
 *
 * These tests don't simulate a real browser layout (would need Playwright
 * or a real headed browser), but they enforce the static-class contract
 * that was missing. A future contributor stripping `w-full` or `min-w-0`
 * from a top-level `<main>` will fail these tests immediately.
 */

import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '../..');

// Recursively collect all *.tsx files under a directory.
async function collectTsxFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await collectTsxFiles(full)));
    else if (entry.isFile() && entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

// The single editorial-site <main> now lives in PageShell; every public page
// composes it (directly, or via NotFoundShell). Body is `flex flex-col`
// (layout.tsx), so that <main> is a direct flex child and MUST carry `w-full`
// + `min-w-0` to opt out of the `min-width: auto` flex-item default that pulls
// it to content's natural width on mobile (the 2026-05-03 incident). We assert
// the invariant on the ONE component instead of re-checking every page, and
// guard that no page reintroduces a raw, unmanaged <main>.
//
// Admin (src/app/admin/**) is a separate surface with its own layouts and is
// intentionally out of scope.
const ADMIN_RE = /\/admin\//;
const PAGESHELL_FILE = 'src/app/_components/ui/PageShell.tsx';

// global-error.tsx REPLACES the root layout (Next requires it to render its own
// <html>/<body>), so there is no flex body for PageShell's invariant to apply
// to, and it cannot assume the Tailwind layer loaded — its styles are inline by
// necessity. It is the one file that legitimately owns a raw <main>; exempting
// it keeps the landmark for screen readers rather than downgrading to a <div>
// to satisfy a rule that doesn't apply. Every other page must still use
// PageShell.
const RAW_MAIN_EXEMPT = new Set(['src/app/global-error.tsx']);

describe('layout invariant: the editorial <main> lives in PageShell (w-full + min-w-0)', () => {
  it('PageShell renders a <main> carrying w-full and min-w-0', async () => {
    const src = await readFile(resolve(projectRoot, PAGESHELL_FILE), 'utf8');
    expect(src, 'Expected a <main> element in PageShell').toMatch(/<main\b/);
    // The invariant classes live in the cn(...) base string on <main>.
    expect(src, 'PageShell <main> must include w-full (CLAUDE.md #1)').toContain(
      'w-full',
    );
    expect(src, 'PageShell <main> must include min-w-0 (CLAUDE.md #1)').toContain(
      'min-w-0',
    );
  });

  it('no editorial page renders a raw <main> outside PageShell', async () => {
    const tsxFiles = await collectTsxFiles(resolve(projectRoot, 'src/app'));
    const offenders: string[] = [];
    for (const file of tsxFiles) {
      const rel = file.replace(projectRoot + '/', '');
      if (rel === PAGESHELL_FILE || ADMIN_RE.test(rel) || RAW_MAIN_EXEMPT.has(rel))
        continue;
      const src = await readFile(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (/<main\b/.test(line)) offenders.push(`  ${rel}:${i + 1}`);
      });
    }
    expect(
      offenders,
      'Raw <main> found outside PageShell. Route it through <PageShell> so the ' +
        "w-full + min-w-0 flex-item invariant (CLAUDE.md #1) can't be forgotten. Offenders:\n" +
        offenders.join('\n'),
    ).toEqual([]);
  });

  // -----------------------------------------------------------------
  // line-clamp-N + display utility on the same element silently
  // breaks the clamp at runtime.
  //
  // Background: Tailwind's `line-clamp-N` sets
  //   display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: N
  // on the element. Any sibling display utility (`block`, `hidden`,
  // `flex`, `grid`, ...) on the same element — whether as the base or
  // behind a responsive variant like `md:block` — competes for the
  // `display` property and defeats the clamp at that breakpoint.
  // Observable symptom: cards render at content height (2/4/6+ lines)
  // instead of the configured clamp. Pre-fix, the homepage synopsis
  // `<p>` had `line-clamp-3 hidden md:block` co-located; from `md` up,
  // `display: block` won and clamping stopped (TODOS.md #15).
  //
  // Fix pattern: move the visibility utility onto a *wrapper* element
  // so the clamped element owns `display: -webkit-box` exclusively.
  it('no className combines line-clamp-N with a display utility on the same element', async () => {
    const tsxFiles = await collectTsxFiles(resolve(projectRoot, 'src/app'));

    // Display utilities that compete with line-clamp's `display: -webkit-box`.
    // `inline` last — it is a substring of `inline-block` etc., but since we
    // tokenize on whitespace before matching, substring overlap isn't an issue.
    const DISPLAY_UTILS = [
      'block',
      'hidden',
      'flex',
      'grid',
      'inline-block',
      'inline-flex',
      'inline-grid',
      'contents',
      'flow-root',
      'table',
      'inline',
    ];
    // Match: optional variant prefix chain (e.g. `md:`, `dark:md:`) + utility
    const displayRe = new RegExp(`^(?:[a-z0-9-]+:)*(?:${DISPLAY_UTILS.join('|')})$`);
    const clampRe = /^(?:[a-z0-9-]+:)*line-clamp-\d+$/;
    // Permissive className matcher — catches simple string literal classes,
    // including those with curly-brace wrapping but no template interpolation.
    const classNameRe = /className=\{?(["'`])([^"'`]+)\1\}?/g;

    const violations: string[] = [];
    for (const file of tsxFiles) {
      const src = await readFile(file, 'utf8');
      for (const match of src.matchAll(classNameRe)) {
        const classes = match[2];
        const tokens = classes.split(/\s+/).filter(Boolean);
        const hasClamp = tokens.some((t) => clampRe.test(t));
        if (!hasClamp) continue;
        const offender = tokens.find((t) => displayRe.test(t));
        if (offender) {
          const lineNo = src.slice(0, match.index ?? 0).split('\n').length;
          const rel = file.replace(projectRoot + '/', '');
          violations.push(`  ${rel}:${lineNo} — "${classes}" (offender: ${offender})`);
        }
      }
    }

    expect(
      violations,
      'Found line-clamp-N co-located with a display utility on the same element. ' +
        'Move the display utility onto a wrapper. Offenders:\n' +
        violations.join('\n'),
    ).toEqual([]);
  });

  it('layout.tsx body is the flex-col container these mains depend on', async () => {
    // If body stops being flex-col, the w-full + min-w-0 requirement may
    // be moot — but it's still good defensive practice. This test pins
    // the assumption so a future restructure surfaces a deliberate
    // decision rather than silently breaking the invariant logic.
    const src = await readFile(resolve(projectRoot, 'src/app/layout.tsx'), 'utf8');
    const bodyMatch = src.match(/<body\s+className=(["'`])([^"'`]+)\1/);
    expect(bodyMatch).not.toBeNull();
    const classes = bodyMatch![2];
    expect(classes).toContain('flex');
    expect(classes).toContain('flex-col');
  });
});

// ---------------------------------------------------------------------------
// Retired-tint invariant.
//
// `bg-carmine/5` was the old row-hover wash. On 2026-06-07 every row hover
// moved to the canonical de-tinted treatment — `hover:bg-black/[0.025]` plus a
// 3px carmine `before:` left-tick that scales in. DESIGN.md declared the tint
// "retired EVERYWHERE", but /cartelera (Próximamente rows) and /pelicula
// (screening rows) kept it until 2026-06-13 (#34a follow-on). This pins the
// claim so a future edit can't quietly bring the pink wash back.
// ---------------------------------------------------------------------------
describe('retired tint: bg-carmine/5 is gone from every src/app .tsx', () => {
  it('no component re-introduces the retired bg-carmine/5 row tint', async () => {
    const tsxFiles = await collectTsxFiles(resolve(projectRoot, 'src/app'));
    const offenders: string[] = [];
    for (const file of tsxFiles) {
      const src = await readFile(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (line.includes('bg-carmine/5')) {
          offenders.push(`  ${file.replace(projectRoot + '/', '')}:${i + 1}`);
        }
      });
    }
    expect(
      offenders,
      'bg-carmine/5 was retired 2026-06-07 → use hover:bg-black/[0.025] + the ' +
        'carmine before: left-tick (see VenueAgenda / SalaUpcomingIndex). Offenders:\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// JSON-LD mount invariants.
//
// Pin the structural contract that Schema.org JSON-LD ships from the
// surfaces the design doc (20260517-135641) commits to: the homepage and
// the alive /pelicula/<slug> branch. Reverse-pin that the notFound branch
// (rendered by not-found.tsx after the page's notFound() call) does NOT
// emit JSON-LD — semantically wrong under Strategy A (page is noindex
// AND dormant), would risk soft-404 classification.
//
// String-based scan matches the existing layout-invariants discipline —
// no DB or render simulation needed. The runtime correctness of the
// payload itself is covered by src/lib/json-ld.test.ts.
// ---------------------------------------------------------------------------

describe('json-ld mount invariants', () => {
  it.each([
    ['src/app/page.tsx', 'buildHomepageJsonLd'],
    ['src/app/pelicula/[slug]/page.tsx', 'buildFilmPageJsonLd'],
  ] as const)(
    '%s — imports JsonLd + %s from @/lib/json-ld and renders <JsonLd payload=',
    async (relPath, builderName) => {
      const src = await readFile(resolve(projectRoot, relPath), 'utf8');

      // Import line — both symbols pulled from the canonical module.
      const importRe = new RegExp(
        `import\\s+\\{[^}]*\\bJsonLd\\b[^}]*\\b${builderName}\\b[^}]*\\}\\s+from\\s+['"]@/lib/json-ld['"]|` +
          `import\\s+\\{[^}]*\\b${builderName}\\b[^}]*\\bJsonLd\\b[^}]*\\}\\s+from\\s+['"]@/lib/json-ld['"]`,
      );
      expect(
        importRe.test(src),
        `Expected ${relPath} to import { JsonLd, ${builderName} } from '@/lib/json-ld'. ` +
          'See design doc benjamin.delasoie-main-design-20260517-135641.md.',
      ).toBe(true);

      // Render line — the actual mount. Permissive over any JSX attributes
      // between `<JsonLd` and `payload=` (e.g., `key={i}` when the page
      // emits one mount per event).
      expect(
        src,
        `Expected ${relPath} to render <JsonLd ... payload={...}>. ` +
          'See eng-review test plan benjamin.delasoie-main-eng-review-test-plan-20260517-142914.md.',
      ).toMatch(/<JsonLd\s+[^>]*payload=/);
    },
  );

  it('not-found.tsx does NOT emit JSON-LD (notFound branch is dormant)', async () => {
    const src = await readFile(
      resolve(projectRoot, 'src/app/pelicula/[slug]/not-found.tsx'),
      'utf8',
    );
    // No import of JsonLd, no mount. The page's notFound() interrupts
    // render before the page-level JSON-LD mount is reached, so this is
    // structurally guaranteed — but pinning it here means a future dev
    // can't accidentally add a JSON-LD mount on the 404 page (which would
    // emit `Movie` with empty `subjectOf`, semantically wrong and
    // soft-404-prone).
    expect(
      src,
      'not-found.tsx must not import JsonLd. The notFound branch is dormant ' +
        'under Strategy A and must emit no Schema.org structured data.',
    ).not.toMatch(/\bJsonLd\b/);
  });
});
