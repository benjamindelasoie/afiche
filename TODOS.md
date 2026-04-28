# TODOs

Captured work that was considered but deferred. Each item has enough context that it can be picked up cold.

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

## 9. Capture a real MALBA per-film fixture and pin parseFilmSynopsis end-to-end

**What:** `parseFilmSynopsis` and `enrichFromFilmDetailPages` shipped 2026-04-24 with synthetic-HTML unit tests + a real-data spot-check against `evento-olivera-aries.html` (a cycle page, same Elementor structure as per-film). MALBA's rate limiter (HTTP 429) was active during the implementation window and blocked capturing a real per-film fixture (e.g. `https://malba.org.ar/evento/una-historia-sencilla/`).

**Why:** The cycle-page spot-check confirms the `.elementor-widget-text-editor` selector picks up the longest body, but a real per-film page may carry an additional cycle-context block, sidebar widgets, or attribution variants ("Texto: NAME" with colon, multi-author). Without a fixture-backed end-to-end test, we won't catch a structural drift on real per-film pages until production warnings flag it.

**Action:** Once MALBA's rate limit resets (try outside peak hours), run:

```bash
mkdir -p test/fixtures/malba
curl -sS \
  -H "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  -H "Accept-Language: es-AR,es;q=0.9" \
  "https://malba.org.ar/evento/una-historia-sencilla/" \
  > test/fixtures/malba/evento-una-historia-sencilla.html
```

Then add an end-to-end test in `src/providers/malba.test.ts`:
- Asserts `parseFilmSynopsis(realFilmHtml)` starts with the published synopsis text
- Confirms the `.elementor-widget-text-editor` longest-wins heuristic still picks the right block when cycle-context widgets are present
- Checks the "Texto de NAME" attribution strip handles whatever variant MALBA actually uses on per-film pages

If the heuristic fails on real-page shape, refine the selector (e.g. scope to a specific Elementor section ID, or filter widgets nested under the article container).

**Depends on / blocked by:** MALBA rate-limit reset. Retried 2026-04-25 from the residential IP; `https://malba.org.ar/*` (listing + per-film) still returned HTTP 429 across multiple UAs, so the rate limit looks IP-scoped and persistent rather than burst-only. Try again after a multi-day gap, from a different IP, or via the gstack browse stealth path.

---

## 4. Log persistence query UI / admin

**What:** With `scrape_runs` populated after each run, build a minimal `/admin/runs` page (or CLI) that lists recent runs, their match stats, and warnings.

**Why:** The data is in the DB now, but you still need to SQL it manually. A 30-minute page that shows the last 20 runs per cinema, miss rate trend, and warning clusters would make every subsequent debugging session faster.

**Depends on / blocked by:** Deploying to Vercel makes this more valuable but not required. Can ship locally first.

---

~~**8. MALBA "24:00" midnight parsing — david-lynch-x5 cycle + future midnight cineclubs**~~ Resolved across two commits. Code fix in `7bef51c` (2026-04-23) made the showtime regex tolerate director-less midnight repeats — the actual failure mode was the missing ", de Director" suffix on "24:00 Terciopelo azul", not the hour value (`buildBaLocalToUtc` already mapped 24:00 → next-day 00:00 BA). Fixture-backed regression test in `test/fixtures/malba/evento-david-lynch-x5.html` + 3 new tests in `src/providers/malba.test.ts` lock down the four-Saturday multi-week pattern: parser carries the April month context across subsequent SÁBADO N headers without a month suffix, all eight screenings (4 evenings + 4 director-less midnights) emit cleanly, midnights land at next-day 03:00 UTC.

---

## 7. Rethink card composition (DESIGN — /design-consultation candidate) [PARTIAL — IN FLIGHT 2026-04-25]

**What:** The current card works, but it was sized for an indie-vs-chain contrast that no longer exists (chain/Cinépolis deferred behind Cloudflare). With CICLO + ★ dropped, the card is cleaner, but the spacing, the content mix, and the information hierarchy could still earn a real pass now that we know what the cartelera actually is (all-indie, Spanish-native, weekly edition).

**Starting questions for /design-consultation:**
- What's carmine's job now? Left-bar + card bg tint + cinema name color were all indie-vs-chain differentiators. In a one-type cartelera they're just "the Afiche card look." Is that the right call, or should carmine step back and become a true accent (reserved for time + edition number only)?
- Is the metadata line (`director · year · country · runtime`) earning its space, or is it data-first noise on a card that wants to read editorially? Could the director move up next to the title? Could country/runtime drop on mobile?
- Is the carmine offset shadow on posters still the "non-negotiable fingerprint" once we rethink the rest, or should it flex (bigger on today's first card, smaller elsewhere)?
- Compact card (Tier 2) is currently a scaled-down version of the full card. Should it be a different composition instead (e.g., inline poster + title on one row, metadata on second)?
- What is a card's primary job: "tell me what this film is" (browse) or "tell me when/where I can see it" (decide)? The time IS the biggest element already, but the card body weight doesn't always match that.

**User feedback 2026-04-22 (that triggered this):** *"they are OK now but I feel like we could improve the spacing, what we include in them and how we display it."* Noted after landing CICLO + ★ drop. Bigger rethink deserves its own cycle.

**Status update 2026-04-25:** the programs+/pelicula/ plan (`~/.gstack/projects/kino/benjamin.delasoie-main-design-20260425-200910.md`) ships a `<ProgramPill>` on cards and the mobile-synopsis `hidden md:block` cleanup, which addresses two of the bullets above. The bigger question (what is carmine's job, what is a card's primary job) is still open and remains a /design-consultation candidate after the programs+/pelicula/ cycle lands.

**Depends on / blocked by:** Nothing. Worth doing before the film-detail pages cycle (TODO #6), since the card design will inform what the film-detail page inherits.

---

## 6. Film-level discovery: same-film repeats + "última función" [IN FLIGHT 2026-04-25 — superseded by programs+/pelicula/ plan]

**What:** Today Afiche answers "what's on at 21:00 Thursday?" but not "I saw film X this week, when else can I catch it?" That's the core decision-tool job a cartelera should serve, and the current card list doesn't answer it.

**User flow:** I see Con faldas y a lo loco playing Thursday 21:00, can't make it, want to quickly know if it's playing again this week or soon, and where.

**Two pieces proposed:**
1. **"Última función" label** — when a film's screening is the last one we have scheduled within the visible horizon, tag that card with a carmine `ÚLTIMA FUNCIÓN` pill. Standalone editorial signal, ~1-2h of work, doesn't depend on film-detail pages. Logic: group scraped screenings by `filmId` within the visible window, find `max(startsAtUtc)` per film, flag the matching card.
2. **Same-film repeats discovery** — on cards where the film has >1 upcoming screening, surface it. Avoid hover popups (no hover on mobile; a11y tax). Preferred pattern: a subtle `+3 funciones esta semana →` link under the title that navigates to the film-detail page. That page lists all upcoming screenings of the film across all venues.

**Why it couples with film-detail pages:** item (2) is essentially the film-detail page's whole purpose. Building them in sequence (detail page first, then the card-side "+N funciones" affordance) makes (2) almost free.

**Scaling context:** as providers multiply (Cinépolis, more indies), the "same film, many venues, many times" case becomes common during Oscar season, director homages, anniversary re-releases. Today with ~5 providers the case is already real (Lugones cycles play each film 2-3x within a week).

**Recommendation:** Invoke `/office-hours` with the framing *"film discovery across repeats — one cycle or two?"* — because it's the same user need as film-detail + cinema pages, and should probably be one cycle. Flagged 2026-04-22 while closing the weekly/próximamente restructure.

**Status update 2026-04-25:** /office-hours ran on this and produced the design doc at `~/.gstack/projects/kino/benjamin.delasoie-main-design-20260425-200910.md` (see also CEO plan `~/.gstack/projects/kino/ceo-plans/2026-04-25-programs-and-pelicula.md`). Both items above ship in the same cycle: ÚLTIMA FUNCIÓN pill in Phase 3 + the `+N funciones` affordance becomes a Link on the card title that navigates to /pelicula/<slug>. Same-film repeats discovery becomes the killer feature on /pelicula/ (cross-venue all-screenings).

**Depends on / blocked by:** Nothing blocks it; should sequence after the weekly/próximamente restructure lands.

---

## 11. Add-to-calendar (.ics) per screening on /pelicula/

**What:** Per-screening add-to-calendar action on /pelicula/<slug>. A small "agendar ⤵" link on each row downloads a `.ics` (VCALENDAR) file the user opens in Google Calendar / Apple Calendar / Outlook. Pure server-rendered: a route at `src/app/api/screening/[id].ics/route.ts` returns a VCALENDAR string with the screening time, film title, cinema, and source URL.

**Why:** The cinephile workflow on /pelicula/ ends with "remind myself of this." Today: screenshot the date, manually add to calendar. With .ics: one tap, all major calendar tools eat it. Distinctive aggregator-shaped feature — no individual cinema's site can offer this for the FULL BA cartelera (they only know about their own screenings).

**Pros:**
- Genuinely distinctive: aggregator-shaped, no single venue can offer this for the city
- Small effort: ~40 lines for the route handler + ~10 lines UI element
- Aligns with the "when can I see it" job that drove /pelicula/ existence

**Cons:**
- Adds an API route + UI element to the surface area
- VCALENDAR escape rules for film titles with quotes / colons need test coverage

**Context:** Deferred from /plan-ceo-review 2026-04-25 (cherry-pick D5). The CEO review reasoned: validate /pelicula/ usage first, then ship .ics as a v2 feature once we know users visit the page. Trigger to act = post-launch usage shows /pelicula/ has real visits AND users surface the manual-calendar dance as a friction point (anecdotal in cinephile chats, or feature requests).

**Effort estimate:** S (~2-3 hrs CC). **Priority:** P3.

**Depends on / blocked by:** /pelicula/ MVP shipped (Phase 2 of the programs+/pelicula/ plan).

---

## 12. Expand TMDB enrichment beyond synopsis (cast, prizes, tagline)

**What:** Three TMDB enrichment additions for /pelicula/, deferred from the programs+/pelicula/ cycle:

1. **Cast block**: top 5-10 names per film via TMDB `/movie/{id}/credits`. Schema: new `cast JSON` field on `films` (or normalized `film_cast` table). UI: small block on /pelicula/ between metadata and screenings.
2. **Prizes/awards block**: TMDB has thin awards data; real coverage requires Wikipedia/Wikidata scraping, IMDB (no public API), or Rotten Tomatoes/Letterboxd (also scraping). UI: small "Galardones" block ("Cannes 2001, Premio del Jurado", etc.).
3. **TMDB tagline as additional synopsis fallback**: TMDB returns a `tagline` field separate from `overview`. Often present even when `overview` is blank. Add as a fallback step in the synopsis chain after `language=es` blank.

**Why:** Makes the "learn about the film" job richer on /pelicula/ — moves the page from "title + synopsis + screenings" to "title + cast + prizes + synopsis + screenings". Distinctive vs. competitors: Letterboxd shows ratings (we don't), IMDB shows everything (we won't), Afiche shows curatorial relevance ("Cannes-winning, screening at Lugones this Saturday").

**Pros:**
- Significantly increases editorial weight of /pelicula/
- Cast is cheap data (TMDB has it on credits endpoint)
- Tagline is cheaper still (already on the movie response)

**Cons:**
- Cast: schema change + UI design (top 5? With photos? Just names?) ≈ M effort
- Prizes: real infra work (Wikipedia/Wikidata scraping or graph queries) ≈ L effort
- Risk of /pelicula/ becoming "a worse IMDB with showtimes" if we add too much

**Context:** Deferred from /office-hours D5 (synopsis-only enrichment for the cycle that ships /pelicula/ MVP). Trigger to act = /pelicula/ has shipped, baseline usage data exists, decision to invest more in the "learn about the film" job is informed by actual visit patterns.

**Effort estimate:** Tagline = S, Cast = M, Prizes = L. **Priority:** P3.

**Depends on / blocked by:** /pelicula/ MVP shipped (Phase 2 of the programs+/pelicula/ plan).

---

## 13. /pelicula/ post-launch hardening (JSON-LD, slug-history, normalization)

**What:** Three hardening additions for /pelicula/ after the MVP ships:

1. **JSON-LD `Movie` + `ScreeningEvent` schema**: structured data on /pelicula/ via `<script type="application/ld+json">`. Lets Google's local cinema panel / knowledge panel pull from /pelicula/ as a structured source for "what's playing in BA" queries. ~30 lines of schema generation, no new dependencies.
2. **Slug-history table for 301 redirects**: `films.slug` is set at first-insert and stays. If a TMDB match later changes `films.title` (uncommon but real), the slug stays — but if we ever WANT to migrate a film to a new slug (better Spanish translation, fixed typo), the old URL should 301 to the new one. Schema: new `film_slug_history` table (filmId, oldSlug, archivedAt) + middleware that catches 404 on /pelicula/<slug>, looks up oldSlug, redirects.
3. **Program name normalization**: the programs-as-string design accepts capitalization/punctuation drift across scrapes ("Olivera-Aries" vs "Olivera–Aries"). Add a `program_name_normalized` derived column at write time (lowercase-trim-collapse). Enables future "all screenings in this program" grouping queries without cleanup migrations later.

**Why:** Each one is post-launch polish that doesn't earn space in the MVP but is real eventual debt:
- JSON-LD is free SEO that turns BA-cinephile traffic into a structured data source other tools can consume.
- Slug-history defends against a real edge case (slug mismatch after title correction) before it bites in production.
- Normalization removes the eventual cleanup migration when /programa/ ships.

**Pros:** Each is bounded scope with a clear payoff.
**Cons:** Premature for the MVP cycle; each is pure speculation about future need.

**Context:** Surfaced by /plan-ceo-review 2026-04-25 outside-voice subagent (#4 SEO flap, #6 normalization, plus design doc deferred slug-history). Trigger to act:
- JSON-LD: when non-cinephile traffic (Google search) becomes a meaningful share of /pelicula/ visits.
- Slug-history: first observed slug-change incident in production (TMDB title update changed canonical), OR before second production migration.
- Normalization: when /programa/ pages start to be planned (the CICLO universal-noise risk re-emerges if program names drift across scrapes).

**Effort estimate:** Each is S; combined M. **Priority:** P3.

**Depends on / blocked by:** /pelicula/ MVP shipped + ~1-3 months of production observation.

---

## 14. Programs entity expansion (/programa/ pages + entity table)

**What:** Promote `programName` from a denormalized text column on `screenings` to a first-class entity. New `programs` table (id, slug, cinemaId, name, normalized_name, started_at, ended_at, descriptionEs). Migrate existing string values to FK references. Build /programa/<slug> pages with a curatorial argument, the program's films, and the program's dates.

**Why:** /office-hours D2 (2026-04-25) explicitly rejected /programa/ pages as the principal Afiche concept — "the conceptual unit of afiche remains the screening" — because no killer feature surfaced. The CEO review preserved this rejection. But the underlying domain truth is real: programs ARE the curatorial backbone of indie cinema (Lugones cycles, MALBA programs, festival weeks). When a killer feature DOES surface (cross-venue gravity views, editorial program directory, when-cinephile-traffic-warrants-it), the work becomes worth doing.

**Pros:**
- Programs become a navigable, shareable entity
- Cross-venue program views become possible ("BA's Lynch moment: 5 at Malba, 2 at Lugones")
- Editorial directory ("Esta semana en BA, 14 ciclos en curso") becomes a thing to build

**Cons:**
- Migration touches every screening row (write the FK, drop the text column)
- Without a killer feature, /programa/ pages mirror the venue's own pages — the failure mode that retired /programa/ in /office-hours

**Context:** /office-hours design doc (2026-04-25) deferred this. Outside voice from /plan-ceo-review (#6) flagged the eventual normalization problem that this work resolves. Trigger to act = a clear killer feature for /programa/ surfaces, OR program-name normalization debt makes per-program queries painful.

**Effort estimate:** L (~1-2 weeks human / ~3-5 hrs CC for the entity migration; UI work depends on chosen direction). **Priority:** P3.

**Depends on / blocked by:** Nothing technical; blocked by the absence of a killer feature for /programa/.

---

## 5. /design-review 2026-04-22 follow-ups (MEDIUM / POLISH)

Deferred findings from the full live audit of afiche.vercel.app. HIGH-severity items (F-001, F-002, F-003, F-004, F-011) shipped this session. The remaining items below are spec-alignment and polish — real but not trust-damaging.

~~**F-012 — Masthead "Afiche" rendering glitch: f serif overlaps the i.**~~ Resolved 2026-04-23 (commit `a566ce8`). Two compounding causes: `tracking-tight` (-0.025em) was a hair tighter than DESIGN.md's display-xl spec (-0.02em), and `font-feature-settings` was browser default — so the fi ligature that Instrument Serif ships with never engaged. Fix: `tracking-[-0.02em]` + `fontKerning: 'normal'` + `fontFeatureSettings: '"liga", "kern"'` on the masthead h1. Same commit also corrected card-title tracking from `tracking-tight` to DESIGN.md's display-md spec (`tracking-[-0.01em]`) for legibility at 24-30px. Visual verification next time on the deployed site.

~~**F-005 — CICLO tag on 80 of 81 cards drains signal value.**~~ Resolved 2026-04-22 (/qa). Filter `'cycle'` out of `s.tags` at render; meaningful tags (retrospective, restored, named festivals) still show. ★ star prefix on cinema names also dropped — same universal-signal reasoning. Commit `aca2dde`.

~~**F-006 — DESIGN.md:149 says "Cards stack poster-above-body" on mobile; reality is horizontal poster-left-body-right.**~~ Resolved 2026-04-23 (/qa). DESIGN.md scale table rewritten to match rendered reality, `Responsive Strategy` row updated in commit `7ada2df`.

~~**F-007 — Card title renders at 30px; DESIGN.md scale table specifies display-md = 36px.**~~ Resolved 2026-04-23 (/qa). DESIGN.md scale table now reflects the 30px ceiling as intentional — the 36px number was aspirational and would crowd the italic serif time at current density. Scale rows rewritten to show mobile→desktop ranges explicitly.

~~**F-008 — Posters served at 96px natural, soft on retina displays.**~~ Resolved 2026-04-23 (/qa). The srcset generated by next/image already includes all 16 widths (32w → 3840w) with `sizes="80px"` configured, so 2x DPR browsers correctly pick `w=256`. The earlier "only w=96 at 1x" observation was a truncated-output misread. No code change needed. Verified in commit `052a84f` alongside the priority→fetchPriority fix.

~~**F-009 — Dateline wraps with leading "·" on mobile and tablet.**~~ Resolved 2026-04-23 (/qa). The Esta semana restructure (commit `10c45e4`) moved the dateline into a `SectionHeader` that uses flex + `flex-wrap` with `gap-x-2` — separators land at end-of-line on wrap, never orphaned at the start of the next line. Also: counts are now mobile-hidden (commit `c4ee3a7`) so the subtitle frequently fits on one line at 375.

~~**F-010 — Day banner rhythm: "6 FUNCIONES" drops below the label on mobile 375.**~~ Resolved 2026-04-22 (/qa). Day banner dedup'd to two columns — dropped the redundant serif center date, making the mono label + count fit cleanly on mobile. Commit `48dd7f6`.

**Follow-ups from HIGH fixes this session:**
- ~~**F-004b — Re-introduce real last-scrape timestamp in footer.**~~ Resolved 2026-04-23 (/qa). New query `getLastScrapeTime()` reads `MAX(finished_at)` from `scrape_runs` WHERE `status='success'`. Footer renders "Actualizado el DD de MMMM a las HH:MM" in BA time when non-null, silent otherwise. Commit `0407828`.
- ~~**F-011b — Enrich Lumiton-family synopses from the /evento/ detail page body.**~~ Resolved 2026-04-24. `parseEventDetail()` in `src/providers/lumiton-agenda.ts` now also extracts `synopsis` from the `article .prose` block. Strip rule: `<em>` children removed before joining `<p>` text — Lumiton's editorial convention reliably wraps venue + entrance metadata ("en Cine York ...", "Entrada Gratuita ...") in `<em>`, never editorial italics, so the strip cleanly separates editorial prose from venue noise. `enrichFromDetailPages()` writes through to `screening.synopsisEs` only when the agenda layer left it blank (provider-fields-win precedent preserved). 7 new tests cover happy path, missing-prose, em-only-prose, multi-paragraph join, agenda-doesn't-clobber, and ends-with-terminal-punctuation (so the F-011 `isCompleteSynopsis` display guard accepts the result).

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
