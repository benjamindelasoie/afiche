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
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '../..');

// All top-level <main> elements rendered as direct flex children of body.
// Body is `flex flex-col` per layout.tsx. Each of these mains MUST carry
// `w-full` + `min-w-0` to opt out of the `min-width: auto` flex-item
// default that pulls main to its content's natural width on mobile.
const MAIN_FILES = [
  'src/app/page.tsx',
  'src/app/pelicula/[slug]/page.tsx',
  'src/app/pelicula/[slug]/not-found.tsx',
];

describe('layout invariant: <main> elements need w-full + min-w-0', () => {
  it.each(MAIN_FILES)(
    '%s — main has w-full and min-w-0 (flex-item width safety)',
    async (relPath) => {
      const src = await readFile(resolve(projectRoot, relPath), 'utf8');

      // Find the <main className="..."> tag. Permissive regex — handles
      // string literal classnames; if the project ever switches to a
      // template literal or a `cn(...)` helper, update the regex or this
      // assertion strategy. For now, all our mains use the simple form.
      const mainMatch = src.match(/<main\s+className=(["'`])([^"'`]+)\1/);
      expect(
        mainMatch,
        `Expected <main className="..."> in ${relPath}`,
      ).not.toBeNull();
      const classes = mainMatch![2];

      expect(
        classes,
        `Missing w-full in <main> classes ("${classes}"). ` +
          'See CLAUDE.md "Frontend conventions" #1.',
      ).toContain('w-full');

      expect(
        classes,
        `Missing min-w-0 in <main> classes ("${classes}"). ` +
          'See CLAUDE.md "Frontend conventions" #1.',
      ).toContain('min-w-0');
    },
  );

  it('layout.tsx body is the flex-col container these mains depend on', async () => {
    // If body stops being flex-col, the w-full + min-w-0 requirement may
    // be moot — but it's still good defensive practice. This test pins
    // the assumption so a future restructure surfaces a deliberate
    // decision rather than silently breaking the invariant logic.
    const src = await readFile(
      resolve(projectRoot, 'src/app/layout.tsx'),
      'utf8',
    );
    const bodyMatch = src.match(/<body\s+className=(["'`])([^"'`]+)\1/);
    expect(bodyMatch).not.toBeNull();
    const classes = bodyMatch![2];
    expect(classes).toContain('flex');
    expect(classes).toContain('flex-col');
  });
});
