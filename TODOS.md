# TODOs

Captured work that was considered but deferred. Each item has enough context that it can be picked up cold.

---

## 1. Ship Cinépolis Recoleta + MALBA scrapers

**What:** Build the remaining two scrapers from the original scope (Playwright-based for Cinépolis's API/JSON case, cheerio or Playwright for MALBA's CMS). Connect them to the existing ingest pipeline.

**Why:** Lugones alone is one cinema's slice of the week. Two reasons this is the real priority:
1. The week view only becomes useful at 3+ cinemas of coverage.
2. The 42% TMDB match rate is heavily Lugones-weighted (1950s noir under Argentine titles is the worst case). Cinépolis programs current global releases and will match near 100% out of the box. MALBA is moderate. Aggregate match rate across all three cinemas is likely 70-80% without any new matching code.

**Pros:** Unlocks the product. Gives real cross-cinema data on where TMDB matching actually breaks. Makes the original office-hours plan from 2026-04-19 complete.

**Cons:** Cinépolis may require Playwright for the JS-rendered API response. MALBA's CMS is "weird" per prior notes and may need deeper scraper work. Neither is blocker-level.

**Context:** Original assignment from the 2026-04-19 office hours. Partially blocked by Lugones debugging, then by the TMDB match rate rabbit hole (which the 2026-04-20 /plan-eng-review rejected as premature). Picking it back up now. Both predecessors (the `none-attempted` retry semantics fix and the `scrape_runs` observability table) are in place, so new scrapers will benefit from both from day one.

**Depends on / blocked by:** Nothing.

---

## 2. Revisit TMDB match-rate strategy after multi-cinema data lands

**What:** Once Cinépolis + MALBA scrapers are in production and have produced ≥2 weeks of data, measure the aggregate match rate across all three cinemas and the per-cinema breakdown. Decide whether matching still needs work, and if so, pick a strategy based on actual failure distribution.

**Why:** The 2026-04-20 /plan-eng-review session validated empirically that:
- es.wikipedia.org does NOT have articles indexed under Argentine-Spanish release titles
  - Verified `pageid: -1` for: "Mientras la ciudad duerme", "Tempestad de pasiones", "Bajo el poder de la maldad", "Juventud en peligro"
  - es.wiki uses Spain release titles instead: "La jungla de asfalto" (The Asphalt Jungle) DOES exist, pageid 1017211
- `opensearch` returns empty for the failing Argentine titles
- Wikidata `wbsearchentities` by es label is ~50% accurate with confident-wrong failures (returned Crown Vic for "Mientras la ciudad duerme")

Given these findings, the likely right path IF aggregate match rate proves too low is:
- **Approach C from the superseded design doc** (hand-curated `tmdb-overrides.json`): 100% precision, bounded work (~80 entries per cinema-year), survives every Cinépolis/MALBA quirk that shows up
- The Wikipedia and Wikidata pivot plans are both dead ends for BA rep programming

**Useful query once multi-cinema data is in:**
```sql
-- overall match rate
SELECT match_source, COUNT(*) FROM films GROUP BY match_source;

-- per-cinema miss distribution (join via screenings)
SELECT c.id, f.match_source, COUNT(*)
FROM films f
JOIN screenings s ON s.film_id = f.id
JOIN cinemas c ON c.id = s.cinema_id
GROUP BY c.id, f.match_source
ORDER BY c.id, f.match_source;
```

**Pros:** Avoids premature optimization. The problem may shrink on its own once Lugones is no longer the only cinema in the dataset.

**Cons:** If we're wrong and the match problem persists, we've delayed the fix by the time it takes to ship two scrapers.

**Context:** Captured in the 2026-04-20 eng-review supersession note at `~/.gstack/projects/kino/benjamin.delasoie-main-design-20260420-203414.md`. Empirical validation data is preserved there so we don't re-run the MediaWiki/Wikidata probes when we come back to this.

**Depends on / blocked by:** TODO #1 (need the multi-cinema data first).

---

## Done (this session)

- ✅ Fix re-enrichment loop for persistent misses — commit `cd6b1a9`
- ✅ Log persistence for scraper runs — `scrape_runs` table + `run-log.ts` module, commit `44615b4`
