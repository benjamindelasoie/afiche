# CLAUDE.md

## Next.js 16 guidance

@AGENTS.md

This project uses Next.js 16 (App Router, React Server Components). Breaking changes vs. older Next.js may exist. Read `AGENTS.md` and `node_modules/next/dist/docs/` before writing Next.js-specific code.

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

Available gstack skills: /office-hours, /plan-ceo-review, /plan-eng-review, /plan-design-review, /design-consultation, /design-shotgun, /design-html, /review, /ship, /land-and-deploy, /canary, /benchmark, /browse, /connect-chrome, /qa, /qa-only, /design-review, /setup-browser-cookies, /setup-deploy, /setup-gbrain, /retro, /investigate, /document-release, /document-generate, /codex, /cso, /autoplan, /plan-devex-review, /devex-review, /careful, /freeze, /guard, /unfreeze, /gstack-upgrade, /learn.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress → invoke context-save; resume → invoke context-restore
- Code quality, health check → invoke health
- Add a new cinema/venue/sala, write a scraper provider → invoke add-venue (project skill in `.claude/skills/`)

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues via the `gh` CLI; external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Design System

Always read `DESIGN.md` before any visual or UI change. All font choices, colors, spacing, motion, and aesthetic direction are defined there. Do not deviate without explicit user approval. Flag any code that contradicts `DESIGN.md` in QA/review.

## Frontend conventions (layout / Tailwind / debugging)

These prevent specific bugs Afiche has hit before. Each is here because it cost real debugging time.

### Layout

1. **Flex items inside the body need `w-full`.** `<body>` is `flex min-h-full flex-col` (sticky-footer pattern). Every direct flex child (`<main>`, page-level wrappers) MUST use `w-full mx-auto max-w-5xl min-w-0 ...` — NOT just `mx-auto max-w-5xl`. Without `w-full`, the flex item sizes to its content's natural width (capped at `max-width`), which silently overflows the viewport on mobile when any descendant has wide natural width (`flex shrink-0` chips, long unbreakable text, etc.). Symptom: `body.scrollWidth > viewport.innerWidth` on mobile, cards stretch to full content width, page horizontally scrolls. Root cause: flex items default to `min-width: auto = min-content`, and `mx-auto` + auto-width competes with cross-axis stretch. (See git log for the 2026-05-03 incident.) `min-w-0` belt-and-suspenders allows shrinking; `w-full` makes the size explicit.

2. **`position: sticky` does NOT compose with CSS transforms** on the same element. Don't mix `sticky` with `translate-x-1/2`, `relative left-1/2`, etc. Sticky positioning is computed on normal-flow position; transforms are applied at paint time, leaving the visual displaced from where sticky thinks the element is. If a sticky element needs to break out of a container, do it via a sibling layout (sticky outside the container) — not via positioning math.

3. **`overflow-x: clip` on `html` or `body` breaks `position: sticky`** on descendants. Use it only on intermediate wrappers. The standard pattern for "no horizontal page scroll" is a properly-sized layout, not body-level overflow rules.

4. **For full-bleed elements inside a max-width layout**, prefer the wrapper-as-sibling pattern: place the full-bleed thing OUTSIDE the centered container in markup. Avoid `w-screen + relative + translate` tricks — they bring sticky / transform compose issues.

### Mobile debugging

5. **Headless Chrome `--window-size=375` is unreliable for layout validation.** It renders content at natural size and downscales the screenshot, hiding overflow bugs. Use one of:
   - Real Chrome dev-tools mobile mode (Cmd-Shift-M / Ctrl-Shift-M) — actually constrains the viewport
   - The iframe-diagnostic pattern: render the page in an `<iframe width="375">` and read `body.scrollWidth`, `documentElement.scrollWidth` via JS. Numbers don't lie; auto-zoom does.
   - Playwright's `page.setViewportSize({ width: 375, height: 667 })` if/when E2E lands

6. **First-line diagnostic for "page looks broken on mobile"**: dump `documentElement.scrollWidth` vs `innerWidth`. If `scrollWidth > innerWidth`, it's a horizontal-overflow bug. Then walk down: which descendant is wider than its parent? That's where the leak is.

### Tailwind hygiene

7. **`eslint-plugin-tailwindcss` is wired in** — class typos (`min-width-0` instead of `min-w-0`) silently produce no CSS, and the linter catches them. Run `npx eslint .` locally; CI enforces.

8. **Prefer `w-full max-w-* mx-auto` over `mx-auto max-w-*`** as the centering idiom. Same visual result, robust against the flex-item-width foot-gun in #1.

## GBrain Search Guidance (configured by /sync-gbrain)
<!-- gstack-gbrain-search-guidance:start -->

GBrain is set up and synced on this machine. The agent should prefer gbrain
over Grep when the question is semantic or when you don't know the exact
identifier yet.

**This worktree is pinned to a worktree-scoped code source** via the
`.gbrain-source` file in the repo root (kubectl-style context).
`gbrain code-def`, `code-refs`, `code-callers`, `code-callees`, `search`, and
`query` from anywhere under this worktree route to that source by default —
no `--source` flag needed (gbrain >= 0.41.38.0; on older gbrain the call-graph
commands need `--source "$(cat .gbrain-source)"`). Conductor sibling worktrees
of the same repo each have their own pin and their own indexed pages, so
semantic results match the code on disk here.

Call-graph queries (`code-callers`/`code-callees`) also need the graph to be
built first — run `/sync-gbrain --dream` (or `--full`) if they return
`count: 0`. This only works if this source's gbrain schema pack extracts code
symbols; on a non-code-aware pack `--dream` completes but the graph stays empty
and reports a WARN. `code-def`/`code-refs` need the same extraction.

Two indexed corpora available via the `gbrain` CLI:
- This worktree's code (auto-pinned via `.gbrain-source`).
- `~/.gstack/` curated memory (registered as `gstack-brain-<user>` source via
  the existing federation pipeline).

Prefer gbrain when:
- "Where is X handled?" / semantic intent, no exact string yet:
    `gbrain search "<terms>"` or `gbrain query "<question>"`
- "Where is symbol Y defined?" / symbol-based code questions:
    `gbrain code-def <symbol>` or `gbrain code-refs <symbol>`
- "What calls Y?" / "What does Y depend on?":
    `gbrain code-callers <symbol>` / `gbrain code-callees <symbol>`
- "What did we decide last time?" / past plans, retros, learnings:
    `gbrain search "<terms>" --source gstack-brain-<user>`

Grep is still right for known exact strings, regex, multiline patterns, and
file globs. Run `/sync-gbrain` after meaningful code changes; for ongoing
auto-sync across all worktrees, run `gbrain autopilot --install` once per
machine — gbrain's daemon handles incremental refresh on a schedule.

Safety: don't run `/sync-gbrain` while `gbrain autopilot` is active — the
orchestrator refuses destructive source ops when it detects a running autopilot
to avoid racing it (#1734). Prefer registering user repos with `gbrain sources
add --path <dir>` (no `--url`): URL-managed sources can auto-reclone, and the
sync code walk for them requires an explicit `--allow-reclone` opt-in.

<!-- gstack-gbrain-search-guidance:end -->
