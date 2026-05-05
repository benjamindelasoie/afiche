# Changelog

All notable changes to Afiche are documented here.

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
