# TODOs

Captured work that was considered but deferred. Each item has enough context that it can be picked up cold.

---

## 1. Ship Cinépolis Recoleta scraper

**What:** Build a Cinépolis Recoleta scraper that feeds into the existing ingest pipeline.

**Why:** We already have Lugones and MALBA. Cinépolis is the chain / multiplex leg of the three-cinema scope. Once it lands, aggregate match rate trends become measurable across indie + chain.

**The blocker:** Cinépolis is behind full Cloudflare bot protection — not just rate limiting. Verified 2026-04-20:
- `www.cinepolis.com.ar/*` → 403 Cloudflare challenge
- `microsite.cinepolis.com` (the Next.js backend API their frontend hits) → also 403 Cloudflare
- `pimcore-content.cinepolis.com` → 403 S3 / Pimcore access-denied
- The site is a client-rendered Next.js SPA; `__NEXT_DATA__` has empty `pageProps`, so there's no server-rendered HTML to scrape

Cheerio + plain `fetch()` (the Lugones/MALBA approach) won't work. Options:
- **Playwright** as a devDep with `chromiumSandbox: false` + stealth settings. Works on Ubuntu 23.10+ where AppArmor blocks Chromium's sandbox. ~500MB install. Cloudflare's JS challenge usually auto-passes after a few seconds in a real-enough browser. This is the structurally right choice.
- **gstack browse binary** — exists already, would need the Ubuntu AppArmor workaround (one sudo command). Less standard than Playwright (shelling out to a CLI vs. importing), awkward to ship.
- **Third-party aggregator** — cinesargentinos.com.ar, Google Maps. Changes Afiche's architecture (we depend on someone else's aggregator) and they could go Cloudflare too. Rejected for now.

**Pros of doing it:** Completes the cartelera; chain/indie mix is more informative for the TMDB match-rate revisit (TODO #2).
**Cons:** Playwright is the first real infra escalation — ongoing maintenance cost when Cloudflare updates fingerprinting, extra CI install size.

**Context:** Originally scoped as "the API case" in the 2026-04-19 /office-hours session. That was wrong — the API is behind the same CF wall as the HTML. 2026-04-20 /plan-eng-review + empirical probing revealed this. MALBA's programming page (`malba.org.ar/cine/`) turned out to be server-rendered plain HTML behind a soft rate limit only, so it shipped first.

**Depends on / blocked by:** Nothing technical — just a decision to install Playwright (or the equivalent browser tooling).

---

## 2. Revisit TMDB match-rate strategy after multi-cinema data lands

**What:** Once Cinépolis is also in production and all three cinemas have ≥2 weeks of data, measure aggregate and per-cinema match rates. Decide whether matching needs more work.

**Why:** The 2026-04-20 /plan-eng-review validated empirically that:
- es.wikipedia.org does NOT have articles indexed under Argentine-Spanish release titles
  - Verified `pageid: -1` for: "Mientras la ciudad duerme", "Tempestad de pasiones", "Bajo el poder de la maldad", "Juventud en peligro"
  - es.wiki uses Spain release titles instead: "La jungla de asfalto" (The Asphalt Jungle) DOES exist, pageid 1017211
- `opensearch` returns empty for the failing Argentine titles
- Wikidata `wbsearchentities` by es label is ~50% accurate with confident-wrong failures (returned Crown Vic for "Mientras la ciudad duerme")

Given these findings, the likely right path IF aggregate match rate proves too low is:
- **Approach C from the superseded design doc** (hand-curated `tmdb-overrides.json`): 100% precision, bounded work (~80 entries per cinema-year), survives every Cinépolis/MALBA quirk that shows up
- The Wikipedia and Wikidata pivot plans are both dead ends for BA rep programming

**Useful queries once multi-cinema data is in:**
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

**Context:** Captured in the 2026-04-20 eng-review supersession note at `~/.gstack/projects/kino/benjamin.delasoie-main-design-20260420-203414.md`. Empirical validation data is preserved there so we don't re-run the MediaWiki/Wikidata probes when we come back to this.

**Depends on / blocked by:** TODO #1 (need Cinépolis data to see the true distribution).

---

## 3. MALBA recurring-weekly cycles (S3 strategy)

**What:** The MALBA provider now has two strategies (as of e616d33):
- **S1 — dense-cycle**: `<h3>Programación</h3>` + per-day `<p>` blocks (e.g. Olivera-Aries)
- **S2 — single-event**: prose regex `DAY N de MONTH a las TIME_LIST` (e.g. El Diablo viste a la moda 2)

S3 (recurring-weekly) is still missing. Examples: Hijo mayor, Los dias chinos, Pin de fartie, The Souffleur, LS83, El príncipe de Nanawa — cycles whose listing description is "Sábados a las 18:00" with no concrete date list. Their detail pages MAY have S2-style single-event prose too (some do in practice), so figure out which ones actually still fail by reading the `scrape_runs.warnings` column after the first production run.

**Why:** If a non-trivial fraction of cycles still produce zero screenings after S1+S2, we need a parser for the weekly-recurrence grammar. Otherwise defer — the problem may already be small.

**Options when it's time:**
- **A. Scrape each film's detail page** — each recurring cycle's listing links to per-film detail pages (e.g., `/evento/hijo-mayor/`) that may have S2-compatible prose schedules. Doesn't require new parsing, just more fetches.
- **B. Expand the listing description** — parse "Sábados a las 18:00 En el mes de abril" into a set of Saturdays across April. Brittle but needs no extra fetches.
- **C. Defer** — if real-data warnings show recurring cycles are a small fraction of actual weekly slots, accept the gap.

**Trigger to act:** after a couple of successful end-to-end scrape runs, query `SELECT cinema_id, warnings FROM scrape_runs WHERE status = 'success'` and see which MALBA cycles still surface "no schedule recognized" warnings. If the list is short and recurring, do C. If it's long or growing, do A.

**Depends on / blocked by:** Nothing, but lower priority than TODO #1.

---

## 4. Log persistence query UI / admin

**What:** With `scrape_runs` populated after each run, build a minimal `/admin/runs` page (or CLI) that lists recent runs, their match stats, and warnings.

**Why:** The data is in the DB now, but you still need to SQL it manually. A 30-minute page that shows the last 20 runs per cinema, miss rate trend, and warning clusters would make every subsequent debugging session faster.

**Depends on / blocked by:** Deploying to Vercel makes this more valuable but not required. Can ship locally first.

---

## Done (this session arc, 2026-04-20)

- ✅ Fix re-enrichment loop for persistent misses — commit `cd6b1a9`
- ✅ Log persistence for scraper runs (`scrape_runs` table + `run-log.ts`) — commit `44615b4`
- ✅ MALBA scraper S1 (dense-cycle) with fixture-backed tests — commit `cc6df53`
- ✅ MALBA scraper S2 (single-event / grouped-times) — commit `e616d33`
