# Changelog

All notable changes to Afiche are documented here.

## [0.1.1.0] - 2026-05-01

### Changed

- Split `src/scrapers/ingest.ts` into focused modules under `src/scrapers/ingest/`. The orchestrator collapses from 610 lines to 80; each concern (films upsert, screenings replace, TMDB enrichment + merge-on-collision, provider health, slug-error detection, public types) lives in its own file. Public surface unchanged — every external import (`ingest`, `enrichPendingFilms`, `isSlugUniqueViolation`, `IngestSummary`) re-exports from `./ingest`. All 246 tests + 1 skipped pass without modification.

### Maintenance

- Ignore `.context/` retro snapshots in git (local trend-tracking only).
- Prettier sweep on `src/providers/malba.test.ts` (line wrapping).
