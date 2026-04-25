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

~~**8. MALBA "24:00" midnight parsing — david-lynch-x5 cycle + future midnight cineclubs**~~ Resolved across two commits. Code fix in `7bef51c` (2026-04-23) made the showtime regex tolerate director-less midnight repeats — the actual failure mode was the missing ", de Director" suffix on "24:00 Terciopelo azul", not the hour value (`buildBaLocalToUtc` already mapped 24:00 → next-day 00:00 BA). Fixture-backed regression test in `test/fixtures/malba/evento-david-lynch-x5.html` + 3 new tests in `src/providers/malba.test.ts` lock down the four-Saturday multi-week pattern: parser carries the April month context across subsequent SÁBADO N headers without a month suffix, all eight screenings (4 evenings + 4 director-less midnights) emit cleanly, midnights land at next-day 03:00 UTC.

---

## 7. Rethink card composition (DESIGN — /design-consultation candidate)

**What:** The current card works, but it was sized for an indie-vs-chain contrast that no longer exists (chain/Cinépolis deferred behind Cloudflare). With CICLO + ★ dropped, the card is cleaner, but the spacing, the content mix, and the information hierarchy could still earn a real pass now that we know what the cartelera actually is (all-indie, Spanish-native, weekly edition).

**Starting questions for /design-consultation:**
- What's carmine's job now? Left-bar + card bg tint + cinema name color were all indie-vs-chain differentiators. In a one-type cartelera they're just "the Afiche card look." Is that the right call, or should carmine step back and become a true accent (reserved for time + edition number only)?
- Is the metadata line (`director · year · country · runtime`) earning its space, or is it data-first noise on a card that wants to read editorially? Could the director move up next to the title? Could country/runtime drop on mobile?
- Is the carmine offset shadow on posters still the "non-negotiable fingerprint" once we rethink the rest, or should it flex (bigger on today's first card, smaller elsewhere)?
- Compact card (Tier 2) is currently a scaled-down version of the full card. Should it be a different composition instead (e.g., inline poster + title on one row, metadata on second)?
- What is a card's primary job: "tell me what this film is" (browse) or "tell me when/where I can see it" (decide)? The time IS the biggest element already, but the card body weight doesn't always match that.

**User feedback 2026-04-22 (that triggered this):** *"they are OK now but I feel like we could improve the spacing, what we include in them and how we display it."* Noted after landing CICLO + ★ drop. Bigger rethink deserves its own cycle.

**Depends on / blocked by:** Nothing. Worth doing before the film-detail pages cycle (TODO #6), since the card design will inform what the film-detail page inherits.

---

## 6. Film-level discovery: same-film repeats + "última función" (NEXT CYCLE)

**What:** Today Afiche answers "what's on at 21:00 Thursday?" but not "I saw film X this week, when else can I catch it?" That's the core decision-tool job a cartelera should serve, and the current card list doesn't answer it.

**User flow:** I see Con faldas y a lo loco playing Thursday 21:00, can't make it, want to quickly know if it's playing again this week or soon, and where.

**Two pieces proposed:**
1. **"Última función" label** — when a film's screening is the last one we have scheduled within the visible horizon, tag that card with a carmine `ÚLTIMA FUNCIÓN` pill. Standalone editorial signal, ~1-2h of work, doesn't depend on film-detail pages. Logic: group scraped screenings by `filmId` within the visible window, find `max(startsAtUtc)` per film, flag the matching card.
2. **Same-film repeats discovery** — on cards where the film has >1 upcoming screening, surface it. Avoid hover popups (no hover on mobile; a11y tax). Preferred pattern: a subtle `+3 funciones esta semana →` link under the title that navigates to the film-detail page. That page lists all upcoming screenings of the film across all venues.

**Why it couples with film-detail pages:** item (2) is essentially the film-detail page's whole purpose. Building them in sequence (detail page first, then the card-side "+N funciones" affordance) makes (2) almost free.

**Scaling context:** as providers multiply (Cinépolis, more indies), the "same film, many venues, many times" case becomes common during Oscar season, director homages, anniversary re-releases. Today with ~5 providers the case is already real (Lugones cycles play each film 2-3x within a week).

**Recommendation:** Invoke `/office-hours` with the framing *"film discovery across repeats — one cycle or two?"* — because it's the same user need as film-detail + cinema pages, and should probably be one cycle. Flagged 2026-04-22 while closing the weekly/próximamente restructure.

**Depends on / blocked by:** Nothing blocks it; should sequence after the weekly/próximamente restructure lands.

---

## 5. /design-review 2026-04-22 follow-ups (MEDIUM / POLISH)

Deferred findings from the full live audit of afiche.vercel.app. HIGH-severity items (F-001, F-002, F-003, F-004, F-011) shipped this session. The remaining items below are spec-alignment and polish — real but not trust-damaging.

**F-012 — Masthead "Afiche" rendering glitch: f serif overlaps the i.** Observed 2026-04-23 by Benjamin. The "f" letter's serif appears to overlap the adjacent "i" in the Instrument Serif masthead h1. Could be:
  - Instrument Serif variable-font glyph quirk at clamp scale (`clamp(3.5rem, 12vw, 8rem)`)
  - Aggressive `tracking-tight` + `-0.02em` letter-spacing crushing letters together
  - Font swap period (Georgia fallback doesn't have this issue; switch to loaded font might be what's visible)
  - CSS `text-balance` interaction
  Start by comparing the same string with / without `tracking-tight`, with / without `text-balance`, at several font-sizes. If it's an Instrument Serif rendering bug at large sizes (known in some variable-font implementations), consider swapping to a different serif for the masthead only. Screenshot when next in front of the issue so we can pin down the viewport + weight.

~~**F-005 — CICLO tag on 80 of 81 cards drains signal value.**~~ Resolved 2026-04-22 (/qa). Filter `'cycle'` out of `s.tags` at render; meaningful tags (retrospective, restored, named festivals) still show. ★ star prefix on cinema names also dropped — same universal-signal reasoning. Commit `aca2dde`.

~~**F-006 — DESIGN.md:149 says "Cards stack poster-above-body" on mobile; reality is horizontal poster-left-body-right.**~~ Resolved 2026-04-23 (/qa). DESIGN.md scale table rewritten to match rendered reality, `Responsive Strategy` row updated in commit `7ada2df`.

~~**F-007 — Card title renders at 30px; DESIGN.md scale table specifies display-md = 36px.**~~ Resolved 2026-04-23 (/qa). DESIGN.md scale table now reflects the 30px ceiling as intentional — the 36px number was aspirational and would crowd the italic serif time at current density. Scale rows rewritten to show mobile→desktop ranges explicitly.

~~**F-008 — Posters served at 96px natural, soft on retina displays.**~~ Resolved 2026-04-23 (/qa). The srcset generated by next/image already includes all 16 widths (32w → 3840w) with `sizes="80px"` configured, so 2x DPR browsers correctly pick `w=256`. The earlier "only w=96 at 1x" observation was a truncated-output misread. No code change needed. Verified in commit `052a84f` alongside the priority→fetchPriority fix.

~~**F-009 — Dateline wraps with leading "·" on mobile and tablet.**~~ Resolved 2026-04-23 (/qa). The Esta semana restructure (commit `10c45e4`) moved the dateline into a `SectionHeader` that uses flex + `flex-wrap` with `gap-x-2` — separators land at end-of-line on wrap, never orphaned at the start of the next line. Also: counts are now mobile-hidden (commit `c4ee3a7`) so the subtitle frequently fits on one line at 375.

~~**F-010 — Day banner rhythm: "6 FUNCIONES" drops below the label on mobile 375.**~~ Resolved 2026-04-22 (/qa). Day banner dedup'd to two columns — dropped the redundant serif center date, making the mono label + count fit cleanly on mobile. Commit `48dd7f6`.

**Follow-ups from HIGH fixes this session:**
- ~~**F-004b — Re-introduce real last-scrape timestamp in footer.**~~ Resolved 2026-04-23 (/qa). New query `getLastScrapeTime()` reads `MAX(finished_at)` from `scrape_runs` WHERE `status='success'`. Footer renders "Actualizado el DD de MMMM a las HH:MM" in BA time when non-null, silent otherwise. Commit `0407828`.
- **F-011b — Enrich Lumiton-family synopses from the /evento/ detail page body.** F-011 stopped scraping the truncated tile preview; the detail page has the full synopsis. `parseEventDetail()` in `src/providers/lumiton-agenda.ts:185` currently extracts director/titleOriginal/year/country/runtime — extend it to also extract the synopsis body. Needs fetching one Lumiton detail page to identify the right selector.

---

## Done (this session arc)

**2026-04-20:**
- ✅ Fix re-enrichment loop for persistent misses — commit `cd6b1a9`
- ✅ Log persistence for scraper runs (`scrape_runs` table + `run-log.ts`) — commit `44615b4`
- ✅ MALBA scraper S1 (dense-cycle) with fixture-backed tests — commit `cc6df53`
- ✅ MALBA scraper S2 (single-event / grouped-times) — commit `e616d33`

**2026-04-21:**
- ✅ Cine York scraper (lumiton.ar agenda) — commit `b8def6c`
- ✅ Extracted shared Lumiton agenda parser — commit `90c326b`
- ✅ Centro Cultural Munro + Lumiton providers — commit `86d5c98`
- ✅ Fix: merge null-year film row on enrichment collision — commit `fa9978d`
- ✅ UI responsive polish pass (mobile fixes, copy bugs, tappable cards) — commit `969eba8`
- ✅ **F001** — Unbreak Geist (remove Arial body override) — commit `48cd1f1`
- ✅ **F004, F012, F013** — Design tokens for color + tracking — commit `c1c8098`
  - Also swept up F002, F008, F009, F010, F014, F015, F018 during the globals.css rewrite
- ✅ **F005, F006, F007, F022** — Copy + layout pass — commit `e2aaf14`
- ✅ **F003, F020, F025** — Switch poster img to next/image — commit `3ca2284`
- ✅ **F011, F016, F017, F019, F021, F023, F024** — Semantic + a11y pass — commit `894e9dc`

**Design Score: C+ → A-** (AI Slop Score A throughout). All 25 audit findings resolved. Pre-deploy polish complete.

**2026-04-22 (/design-review live audit):**
- ✅ **F-001** — Masthead dateline: "Semana del" → "Próximas funciones del" when range > 7 days — commit `cd73664`
- ✅ **F-002** — Poster tiles: cream bg placeholder + above-fold `priority` — commit `415489f`
- ✅ **F-003** — Day banners render as `<h2>`, not `<div>` (screen-reader outline) — commit `209603d`
- ✅ **F-004** — Drop broken "última actualización · datos de ejemplo" footer line — commit `736a9b2`
- ✅ **F-011** — Stop scraping truncated Lumiton tile synopses — commit `8ff01fe`
- ✅ **F-011 part 2** — Display guard hides mid-sentence synopses from legacy DB rows — commit `2fb8f4a`

**Baseline → After:** Design Score B+ → A- · AI Slop A (unchanged) · Goodwill Reservoir 65 → ~85. 115 tests passing (was 114; +1 regression test on `isWeekSpan`).

**2026-04-23 (/qa — TODO #5 cleanup, Esta semana restructure aftermath):**
- ✅ **LCP priority wire** — Next 16 deprecated `priority` prop silently; swap to explicit `loading="eager"` + `fetchPriority="high"` on first 3 above-fold cards. Also fixed the `isFirstDay` gate so priority fires even when today has no screenings. Commits `cbf8ba9` (gate) + `052a84f` (Next-16 swap).
- ✅ **F-006 mobile card layout spec drift** — DESIGN.md updated to reflect horizontal render.
- ✅ **F-007 card title size spec drift** — DESIGN.md scale table rewritten with mobile→desktop ranges.
- ✅ **F-008 retina poster resolution** — no code change needed; srcset always covered 2x DPR. Earlier concern was a truncated-output misread.
- ✅ **F-009 dateline wrap** — flex-wrap in SectionHeader handles it cleanly; counts mobile-hidden reduces wrap frequency.

Operational learning logged: **Next.js 16 deprecated the `priority` prop on next/image** — silent no-op; must use `loading` + `fetchPriority` explicitly.

**2026-04-22 (/qa mobile polish, after 3-tier landing):**
- ✅ **Day banner dedup** — dropped redundant serif "23 Abr" center column; mono label + count now fit cleanly on mobile 375 (closed F-010) — commit `48dd7f6`
- ✅ **CICLO tag + ★ star prefix** — both were universal curation signals designed to contrast with chain content; dropped now that cartelera is all-indie (closed F-005) — commit `aca2dde`
- ✅ **Tier 3 original title overflow** — dropped the italic "«Original Title»" subtitle on Próximamente rows; long Spanish titles no longer overflow mobile — commit `fe8303d`

Open question flagged for a future /design-consultation: **what's carmine's job in a one-type cartelera?** Left-bar + card bg + cinema color were indie-vs-chain differentiators; now they're just "the Afiche card look." Rethink candidate.
