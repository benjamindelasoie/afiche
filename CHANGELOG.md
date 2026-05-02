# Changelog

All notable changes to Afiche are documented here.

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
