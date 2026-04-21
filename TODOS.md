# TODOs

Captured work that was considered but deferred. Each item has enough context that it can be picked up cold.

---

## 1. Fix re-enrichment loop for persistent misses

**What:** Change `enrichPendingFilms` in `src/scrapers/ingest.ts:185` to filter out films that have already been attempted and failed, not only films that have never been attempted.

**Why:** Today the filter is `match_source = 'none'`. Successfully-matched films are excluded (good). But films that fail TMDB match also stay at `'none'`, so every scraper run re-queries TMDB for every persistent miss. At ~58% miss rate × ~100 films/week × daily scrapes = ~400 redundant TMDB calls per week. Wasteful, noisy in logs, and couples scrape success to TMDB's availability for films that definitely aren't resolving.

**Pros:** Eliminates silent waste. Logs get clean — a miss shows up once, not every day. Reduces TMDB API surface. Sets up the matching rate to stabilize at a knowable ceiling instead of constantly re-computing.

**Cons:** Introduces an enum value (`'none-attempted'`). Re-triggering enrichment after improving the matcher requires a manual SQL reset (`UPDATE films SET match_source='none' WHERE …`). The override file path is unaffected — it always runs before the sentinel filter — so manual overrides still work.

**Context:** This is a tiny, isolated PR (~10 min of work). Discovered during the 2026-04-20 /plan-eng-review as eng-review Issue 1. Approved by user. Keep scope strictly to:
1. Migration: extend `match_source` enum in `src/db/schema.ts` to add `'none-attempted'`
2. Flyway/Drizzle migration generated via `drizzle-kit generate`
3. `src/scrapers/ingest.ts:185`: after calling `enrichFilm`, if the delta is null, set `match_source='none-attempted'` before the sleep

**Depends on / blocked by:** Nothing. Do this before the Cinépolis/MALBA scrapers so those get the improved retry semantics from day one.

---

## 2. Ship Cinépolis Recoleta + MALBA scrapers

**What:** Build the remaining two scrapers from the original scope (Playwright-based for Cinépolis's API/JSON case, cheerio or Playwright for MALBA's CMS). Connect them to the existing ingest pipeline.

**Why:** Lugones alone is one cinema's slice of the week. Two reasons this is the real priority:
1. The week view only becomes useful at 3+ cinemas of coverage.
2. The 42% TMDB match rate is heavily Lugones-weighted (1950s noir under Argentine titles is the worst case). Cinépolis programs current global releases and will match near 100% out of the box. MALBA is moderate. Aggregate match rate across all three cinemas is likely 70-80% without any new matching code.

**Pros:** Unlocks the product. Gives real cross-cinema data on where TMDB matching actually breaks. Makes the original office-hours plan from 2026-04-19 complete.

**Cons:** Cinépolis may require Playwright for the JS-rendered API response. MALBA's CMS is "weird" per prior notes and may need deeper scraper work. Neither is blocker-level.

**Context:** Original assignment from the 2026-04-19 office hours. Partially blocked by Lugones debugging, then by the TMDB match rate rabbit hole (which the 2026-04-20 /plan-eng-review rejected as premature). Picking it back up now.

**Depends on / blocked by:** TODO #1 first (so the new scrapers get the improved retry semantics from their first run).

---

## 3. Revisit TMDB match-rate strategy after multi-cinema data lands

**What:** Once Cinépolis + MALBA scrapers are in production and have produced ≥2 weeks of data, measure the aggregate match rate across all three cinemas and the per-cinema breakdown. Decide whether matching still needs work, and if so, pick a strategy based on actual failure distribution.

**Why:** The 2026-04-20 /plan-eng-review session validated empirically that:
- es.wikipedia.org does NOT have articles indexed under Argentine-Spanish release titles
  - Verified `pageid: -1` for: "Mientras la ciudad duerme", "Tempestad de pasiones", "Bajo el poder de la maldad", "Juventud en peligro"
  - es.wiki uses Spain release titles instead: "La jungla de asfalto" (The Asphalt Jungle) DOES exist, pageid 1017211
- `opensearch` returns empty for the failing Argentine titles
- Wikidata `wbsearchentities` by es label is ~50% accurate with confident-wrong failures (returned Crown Vic for "Mientras la ciudad duerme")

Given these findings, the likely right path IF aggregate match rate proves too low is:
- **Approach C from the design doc** (hand-curated `tmdb-overrides.json`): 100% precision, bounded work (~80 entries per cinema-year), survives every Cinépolis/MALBA quirk that shows up
- The Wikipedia and Wikidata pivot plans are both dead ends for BA rep programming

**Pros:** Avoids premature optimization. The problem may shrink on its own once Lugones is no longer the only cinema in the dataset.

**Cons:** If we're wrong and the match problem persists, we've delayed the fix by the time it takes to ship two scrapers.

**Context:** Captured in the 2026-04-20 eng-review supersession note at `~/.gstack/projects/kino/benjamin.delasoie-main-design-20260420-203414.md`. Empirical validation data is preserved there so we don't re-run the MediaWiki/Wikidata probes when we come back to this.

**Depends on / blocked by:** TODO #2 (need the multi-cinema data first).

---

## 4. Log persistence for scraper runs in production

**What:** When the scraper runs on Vercel cron (or wherever it lands in production), stdout logs are ephemeral and truncated. Design a log persistence strategy so you can actually read what the scraper did, find persistent misses, and mine the data.

**Why:** Several current and future workflows depend on being able to grep the scraper output after a run: finding unmatched films to add to `tmdb-overrides.json`, debugging a provider that suddenly returns zero screenings, auditing TMDB match-path distribution over time. Today this is trivial because you run locally; it breaks the moment the scraper runs headlessly.

**Pros:** Makes production scraper runs diagnosable. Necessary groundwork for any real observability (a dashboard showing match-rate trend, provider health over time, etc).

**Cons:** Adds surface area. A SQLite table (e.g., `scrape_runs` with a `log_payload` JSON column) is the simplest option, but you also want retention policies so the DB doesn't bloat.

**Context:** Flagged during the 2026-04-20 /plan-eng-review (Issue 3 in Architecture, deferred). Not a blocker for the current pre-deploy phase; becomes urgent the week you cut over to Vercel cron.

**Depends on / blocked by:** Deploy to production.
