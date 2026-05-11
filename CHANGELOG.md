# Changelog

All notable changes to Afiche are documented here.

## [0.2.3.2] - 2026-05-11

### Fixed

- **Synopsis preview now clamps to 3 lines on desktop cartelera cards.** The `<p>` in `ScreeningCard` (`src/app/page.tsx`) carried `line-clamp-3 hidden md:block` on the same element. `line-clamp-N` requires `display: -webkit-box` to function; `md:block` sets `display: block` inside `@media (min-width: 48rem)`. At equal specificity, the responsive variant won on source order at the `md:` breakpoint and silently defeated the clamp — synopses then rendered at content height (2/4/6+ lines depending on text length), producing ragged card heights across each row. Fix: pushed `hidden md:block` onto a wrapper `<div>`, leaving the inner `<p>` with `line-clamp-3` and its `display: -webkit-box` uncontested. Visual rhythm is restored; card heights in a row now line up to the 3-line cap.

### Maintenance

- **New regression guard in `src/app/layout-invariants.test.ts`** scans every `*.tsx` under `src/app/` and fails when any single className combines `line-clamp-N` with a display utility (`block`, `hidden`, `flex`, `grid`, `inline-block`, `inline-flex`, `inline-grid`, `contents`, `flow-root`, `table`, `inline`) — including responsive variants like `md:block`. Fixture-style, no browser needed. Same discipline as the existing `<main>` w-full check (CLAUDE.md frontend-conventions #1). Closes `TODOS.md` #15.

## [0.2.3.1] - 2026-05-07

### Changed

- **Lorca vision call upgraded from Haiku 4.5 to Sonnet 4.6.** Same prompt, same `temperature: 0`, same image-hash cache. Sonnet's OCR accuracy on dense small-text Spanish posters is markedly better — closes the rare residual drift cases (letter-substitution hallucinations like `GIOIA` → `GUIOTA`, stray punctuation like `HERMANO?`) that survived even temperature-0 deterministic decoding on Haiku. Cost goes from ~$0.005 to ~$0.015 per call; with the image-hash cache hitting 6 of 7 days per week, real annual cost is ~$0.78 (vs. ~$0.26 on Haiku). Cache key composes `VISION_MODEL`, so the model swap auto-invalidates — first scrape after deploy burns one Sonnet call to repopulate, then back to cache hits. Uses the alias `claude-sonnet-4-6` (the SDK enum at `node_modules/@anthropic-ai/sdk/resources/messages/messages.d.mts:707` doesn't list a dated snapshot for 4-6 yet — only the alias).

## [0.2.3.0] - 2026-05-07

### Fixed

- **Duplicate film rows from VLM drift, cross-provider format divergence, and pre-fix year-null legacy now collapse automatically.** The session-long bug class — `GIOIA MIA` ↔ `GUIOTA MÍA`, `LA PATAGONIA REBELDE` ↔ `La patagonia rebelde`, `PADRE…HERMANO` ↔ `…HERMANO?` — is closed structurally. The enrichment loop's merge-on-collision predicate is now keyed on `tmdb_id` equality (`mergeIfTmdbIdCollides`) instead of the prior `(scrapedTitle, year)` equality (`mergeIfYearCollides`) which silently missed every case where scraped titles differed. tmdb_id, when known, is the strongest identity signal in the system; once both rows of a duplicate pair enrich, they share it, and the second row of the pair merges into the first deterministically.

### Changed

- **Renamed `mergeIfYearCollides` → `mergeIfTmdbIdCollides`** with the new tmdb_id-keyed predicate (`src/scrapers/ingest/enrichment.ts`). All four scenarios the original function caught are still caught (any time the old merge fired, the new one fires too — both rows eventually share tmdb_id post-enrichment). The rename + predicate change is strictly broader.
- **Extracted shared `mergeFilmInto(loserId, winnerId, warnings?)` helper** to `src/scrapers/ingest/films.ts`. Used by both the enrichment loop's merge and the new dedupe-films cleanup script. One source of truth for the `UPDATE OR IGNORE screenings` + `DELETE films` + cascade pattern.
- **`fetchPendingFilms` now `ORDER BY id DESC`** so when multiple rows in the pending pool collide on tmdb_id (e.g. operator manually patched several rows to the same id), the newer row (higher id) is processed first and loses, while the older row (lower id, anchored slug) survives. For the common single-pending-row VLM-drift case the order is moot.

### Added

- **`scripts/dedupe-films.ts`** — one-shot cleanup for existing duplicates that don't re-enter the enrichment-pending pool (most accumulated dupes have `match_source='auto'` and stay out of pending). Finds every `(tmdb_id, COUNT > 1)` cluster, picks the lowest id as winner per cluster, and runs `mergeFilmInto` on the rest. Dry-run by default; pass `--apply` to mutate. Run via `npm run db:dedupe-films` (local) or `npm run db:dedupe-films:prod` (Turso). Closes the bug class for accumulated duplicates that the structural fix alone wouldn't catch.
- **Index on `films.tmdb_id`** (Drizzle migration `0007_safe_talon`). Keeps the merge predicate at `O(log n)` instead of `O(n)` as the catalog grows. Cheap insurance — < 100KB on disk at current scale.

### Maintenance

- **8 new regression tests** in `src/scrapers/ingest.test.ts` covering the structural fix end-to-end:
  - T1 (VLM drift case — `GIOIA` / `GUIOTA`)
  - T2 (cross-provider format divergence — `LA PATAGONIA REBELDE` / `La patagonia rebelde`)
  - T4 (no-collision negative case — different `tmdb_ids` must not merge)
  - T5 (TMDB miss → no merge attempted, row stays for retry)
  - T6 (manual-patch convergence — operator patches both rows to same `tmdb_id`, second collapses into first)
  - T7a-d (`mergeFilmInto` unit tests: re-point + delete, time-collision + cascade, pure-orphan cleanup, optional warnings array)
  - T8 (dedupe-films integration — multiple clusters + singleton row untouched)
- **Existing 4 merge tests updated** to seed the existing-row's `tmdb_id` (production-realistic — `match_source='auto'` rows always have it set; the prior tests were missing this detail). Describe-block renamed to "merge on tmdb_id collision".
- **293 tests pass** (1 deliberately-skipped live vision test).

## [0.2.2.0] - 2026-05-07

### Added

- **Image-hash cache for the Cine Lorca vision call.** Lorca posts a new cartelera every Thursday and the same poster image is served for the rest of the week. Each daily scrape was paying ~$0.005 for an Anthropic call AND giving Haiku another roll of the dice on title transcription — the structural source of the title-drift duplicate bug (e.g., `GIOIA MIA` ↔ `GUIOTA MÍA`, `PADRE…HERMANO` ↔ `…HERMANO?`). Now the provider hashes the fetched image and short-circuits when the cache key matches what was cached on the last successful parse. Drift surface drops from 7 calls/week to 1. Persisted in two new `providers` columns: `last_image_sha256` and `last_image_parsed` (Drizzle migration `0006_awesome_doctor_doom`). The cache key is `sha256(imageBytes ‖ ':' ‖ VISION_MODEL ‖ ':' ‖ PROMPT_VERSION)` so a model upgrade or a prompt revision automatically invalidates prior parses — bumping `PROMPT_VERSION` (a constant in `cine-lorca.ts`) on a meaningful prompt change forces a fresh vision call on the next run.

### Changed

- **Tuned the Lorca vision call for transcription accuracy.** Four changes to `readCarteleraWithVision` in `src/providers/cine-lorca.ts`:
  - `temperature: 0` — greedy decoding so the same image deterministically produces the same transcription. Eliminates the run-to-run variance that turned `GIOIA` into `GUIOTA` between scrapes.
  - System prompt promoted to the dedicated `system` field — persona + output-format guardrails separated from per-image instructions, per Anthropic instruction-following best practice.
  - Few-shot example added to the user prompt — one worked sample of the JSON shape with mixed time-format normalization (`14.10 hs.` → `14:10`, `16:00 hs.` → `16:00`). Highest-leverage prompt-engineering tool for structured-output OCR.
  - `stop_sequences` added — defensive clip on any runaway prose.

### Fixed

- **`parseHHMM` now accepts both `:` and `.` as time separators.** The Lorca poster mixes `14.10 hs.` (period) and `16:00 hs.` (colon) on the same week — different films use different formats. The vision prompt asks for normalization to colon, but if a stray period-format time slipped through, the previous regex `^(\d{1,2}):(\d{2})$` would silently drop it. New regex `^(\d{1,2})[:.](\d{2})$` accepts both as a defensive backstop.
- **Cache-read hardening against corrupt JSON.** `readImageCache` now wraps the SELECT in try/catch — Drizzle's `mode: 'json'` parses the column during row hydration, so an operator hand-edit or partial write that left invalid JSON in `last_image_parsed` would have aborted the whole scrape run. Now it degrades to a safe cache miss and a fresh vision call.
- **Cache-write failure surfaces in `scrape_runs.warnings`.** Previously `writeImageCache(...).catch(() => {})` swallowed every write failure, so a permanently-failing cache write would mean re-calling Anthropic forever with no signal. Now the catch pushes a warning into the run-log so operators see it in the dashboard.

### Maintenance

- **Bounded the cache validator against Cartesian-explosion payloads.** `isParsedCartelera` now caps `films[]` (≤30), `times[]` per film (≤20), title length (≤200 chars), year (2020-2050), month (1-12), day (1-31). Before, a corrupt or hand-edited `last_image_parsed` JSON could have passed validation and fed `expandScreenings` (films × days × times) a Cartesian explosion of INSERTs. Cap violations degrade to cache miss.
- New test file `src/providers/cine-lorca-cache.test.ts` (16 tests) exercises the cache write/read/round-trip, hash-mismatch miss, overwrite-on-new-image, shape-validation defense, JSON-hydration safety, every cap boundary, and `composeCacheKey` determinism + invalidation.
- Existing `src/providers/cine-lorca.test.ts` gains a regression test for the `parseHHMM` period-format fix and a minimal `@/db` stub so its pure-function tests don't pull the libSQL client.
- Schema docstring updated to reflect that `providers` now holds per-provider state cache fields in addition to health/observability columns.

## [0.2.1.1] - 2026-05-05

### Fixed

- **`/pelicula/<slug>` URLs now render a film-specific preview when shared on WhatsApp/Slack/Twitter/Telegram**, instead of falling through to the Vercel favicon. Root cause: the file-convention `opengraph-image.png` at `src/app/` only attaches to its own route segment (`/`), not nested routes — and the page's `generateMetadata` was returning a child `openGraph` object without `images`, which shallowly replaces the parent's metadata, so `/pelicula/<slug>` emitted no `og:image` at all. Fix: explicitly populate `openGraph.images` and `twitter.images` in the page's `generateMetadata` using the film's TMDB backdrop (16:9 at w1280, ideal for `summary_large_image` cards on Twitter/Slack/Telegram) with the vertical poster (TMDB w500) as fallback for films without a backdrop.

## [0.2.1.0] - 2026-05-05

### Fixed

- **Manually-patched `tmdb_id` values now persist across scrapes.** Previously, films whose `tmdb_id` was patched in Drizzle Studio after auto-match failed would lose the patch on the very next `scrape:prod` run — the cartelera would silently render an unenriched duplicate while the patched row was orphaned. Confirmed in prod 2026-05-05 for "PADRE, MADRE, HERMANA, HERMANO" and "EL DESPRECIO (1963)". Root cause: the films unique index was on `(scraped_title, year)`, but enrichment writes `year` (e.g. resolves a year-less row to 2025). The next re-scrape's lookup for `year IS NULL` then missed the patched row and inserted a fresh unenriched duplicate. Fix: split the immutable `scraped_year` (what the scraper first saw, never updated) from the mutable `year` (what we now believe), and key the unique index on `(scraped_title, scraped_year)`. Re-scrapes now find the existing row regardless of how `year` has evolved.

### Changed

- **New `films.scraped_year` column** (Drizzle migration `0005_spooky_zarek`). Backfilled `scraped_year = year` for every existing row, with manually-patched rows (`match_source = 'manual'`) overridden to `NULL` because we know the scraper originally emitted year=null for those (that's why auto-match failed). One-time consequence: auto-matched rows whose original scraper-emitted year was NULL will create one duplicate on the next scrape, which the existing merge-on-collision logic in `enrichment.ts` collapses automatically — bounded one-time noise in the merge warnings, then stable forever.

### Maintenance

- Three new regression tests in `src/scrapers/ingest.test.ts` lock the manual-patch + re-scrape sequence so this can't silently regress: a re-scrape with year=undefined finds the patched row by `scraped_year IS NULL`, distinct `scraped_year` values stay distinct (the merge logic handles their cleanup), and two consecutive year-less re-scrapes converge on a single row.
- Stale comment block in `enrichment.ts` updated. The merge-on-collision logic is no longer a "prevent unique-constraint violation" mechanism (the new key prevents that automatically); it's now purely cross-provider deduplication.

## [0.2.0.3] - 2026-05-05

### Fixed

- **Sala Lugones "bis" / single-day programs are no longer silently dropped.** The Lugones index page exposes one-off encore screenings (e.g. "Claude Chabrol bis") with a date string like `"Jueves 28 de mayo, 15 y 18 horas"` — a single-day shape that doesn't fit the cycle-style `"Del X al Y"` range syntax the parser handled. Pre-fix, the scraper logged `could not parse date range "..."` and dropped the entire program. Now `parseDateRange` recognizes a fourth syntactic form (`<weekday> <day> de <month>`) and the existing S1 detail-page walker handles the rest, since `matchDayHeader` already accepts month-less day headers (`"Jueves 28"`). Captured the live Chabrol bis detail page as a fixture and added unit + integration regression tests.

### Maintenance

- Documented as a known source-quality limitation: the second film on the Chabrol bis page ("Al anochecer") will still be silently skipped because the source page omits its `<strong>title</strong>` element — the title appears only in the prose intro paragraph. That's a Lugones CMS data-entry gap, not a scraper bug. Recovering it would require regex-on-prose, which is the most fragile possible parser strategy.

## [0.2.0.2] - 2026-05-05

### Changed

- **Day heading collapses flush against the sticky date strip on chip jumps.** Tightened `scroll-padding-top` from 88 px to 70 px so the strip's bottom border and the day banner's top border sit on the same pixel edge — the two 1 px rules read as a single editorial double-rule line. The earlier 88 px left a small gap, which read as two competing parallel lines. The new comment in `globals.css` flags this as a deliberate rule-collapsing choice so future edits don't reintroduce breathing room.

## [0.2.0.1] - 2026-05-05

### Fixed

- **Smooth scroll when tapping date chips on iPhone Safari.** Chip taps used to produce a hard, instantaneous snap on real iOS devices because the page-level smooth-scroll behavior wasn't set; iPhone's larger per-day scroll delta made the jump painfully visible. Desktop emulation hid the bug because adjacent sections often shared a viewport. The whole page now glides between days. Reduced-motion preference is respected — users who opt out of motion still get instant jumps.
- **Day heading lands with breathing room below the sticky date strip.** The previous offset (60 px) was ~9 px short of the strip's actual rendered height and gave zero air between the strip's bottom border and the heading's top border. Replaced two per-element `scroll-mt-[60px]` magic numbers with a single `scroll-padding-top: 88px` on `<html>`, which covers every anchor target on the page and leaves ~20 px of breathing room.

## [0.2.0.0] - 2026-05-03

### Added

- **Sticky date-strip navigation across the homepage.** Tap any of the next 14 days to jump straight to that day's screenings. Today's chip stays carmine the whole time. The active chip's underline tracks where you are as you scroll — and the strip auto-centers the active chip when it leaves view, so you always see "you are here" in context. A trailing "Próximamente →" chip jumps to the further-out programming.
- **Próximamente section** now groups screenings by week ("Semana del 19 al 25 de mayo") instead of as one long flat list. Easier to plan around dates a few weeks out.
- **Frontend regression test** at `src/app/layout-invariants.test.ts`: pins the contract that every top-level `<main>` carries `w-full min-w-0` so a flex-item width foot-gun can't silently overflow mobile again.
- **Tailwind class typo detection** via `eslint-plugin-better-tailwindcss` (V4-compatible). Catches `min-width-0`, `bg-creem`, and other typos that would silently produce no CSS. Wired into `npm run lint`.

### Changed

- **Two-tier homepage** (was three): days 1–14 render as full cards (navigated via the strip), days 15+ render as the week-grouped Próximamente text index. Compact-card variant for week 2 retired — the strip's tap-to-jump replaces scroll-skim, so the visual demotion no longer earned its keep.
- **14-day rolling content window** (was ISO-week-bounded). Cartelera shows `today` through `today+13` regardless of weekday — a Wednesday user always sees Wed → Wed+13 with one-tap navigation to any of them. Edición masthead label still reads "Semana del X al Y" as editorial flavor, decoupled from cartelera content.
- **Today's strip chip displays "HOY"** (mono caps) instead of the day number, mirroring the day-banner HOY pill below — visual + verbal symmetry.
- **Empty-day handling**: a day with zero screenings (rare but possible during festival hiatus) renders an editorial "Las salas descansan" banner instead of being dropped from the list. The corresponding strip chip is muted to 50% opacity, still tappable.

### Fixed

- **Mobile horizontal-overflow bug** on every page with a `<main>` element. Flex-item `min-width: auto` interacting with `mx-auto + max-w-5xl` was sizing main to its content's natural width (~1024px) on a 375px viewport, causing horizontal page scroll and stretching cards beyond viewport. Added `w-full min-w-0` to `<main>` in `page.tsx`, `pelicula/[slug]/page.tsx`, and `pelicula/[slug]/not-found.tsx`. The regression test pins the fix.

### Maintenance

- **Frontend conventions documented** in `CLAUDE.md` — flex-item width foot-gun, sticky+transform composition trap, headless-Chrome mobile-debugging unreliability, recommended layout patterns. Future work catches these gotchas immediately.
- DESIGN.md decisions log entry for the nav refactor + the metaphor-as-flavor-not-veto framing that drove the consolidation.
- Editorial conceit demoted from veto to flavor: editorial / zine / Edición concept drives type, palette, voice, masthead — it does NOT veto user-friendly behavioral decisions. Concrete outcomes: 14-day rolling strip (not ISO-week-bounded), week-2 compact-card density retired, dark mode added to near-future roadmap.

## [0.1.2.0] - 2026-05-02

### Fixed

- **Cine Lorca provider activated.** The provider stopped finding the cartelera image when Lorca dropped the SEO-friendly `cartelera.jpeg` filename in favor of Wix's raw `~mv2` user-upload pathname. Switched the image-URL extractor to anchor on the `~mv2` marker first (with the SEO filename as fallback), preferring the largest rendered variant when multiple are present. Lorca contributes 70 screenings/week.
- **DD/MM date format clarified to vision.** The Spanish prompt now explicitly instructs Claude to interpret `30/04 AL 06/05` as April 30 → May 6 (Argentine DD/MM), not June 5. Added a sanity check on the parsed validity range: if the duration falls outside 4-14 days, the provider refuses to ingest rather than poison Turso with phantom multi-week screenings (Lorca's cycle is always Thursday → Wednesday).

### Documentation

- DEPLOY.md env-file tables now include `ANTHROPIC_API_KEY` with a note that Vercel does NOT need it.

## [0.1.1.0] - 2026-05-01

### Changed

- Split `src/scrapers/ingest.ts` into focused modules under `src/scrapers/ingest/`. The orchestrator collapses from 610 lines to 80; each concern (films upsert, screenings replace, TMDB enrichment + merge-on-collision, provider health, slug-error detection, public types) lives in its own file. Public surface unchanged — every external import (`ingest`, `enrichPendingFilms`, `isSlugUniqueViolation`, `IngestSummary`) re-exports from `./ingest`. All 246 tests + 1 skipped pass without modification.

### Maintenance

- Ignore `.context/` retro snapshots in git (local trend-tracking only).
- Prettier sweep on `src/providers/malba.test.ts` (line wrapping).
