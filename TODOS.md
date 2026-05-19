# TODOs

Captured work that was considered but deferred. Each item has enough context that it can be picked up cold.

---

## 24. Scraper-update cache invalidation: reset `match_source` when a meaningful field changes (STRUCTURAL POLISH)

**What:** When the scraper UPDATEs a meaningful column (`director`, `titleOriginal`, `runtimeMin`, `synopsisEs`) on a row currently at `match_source='none-attempted'`, reset `match_source='none'` in the same transaction so the next enrichment pass retries with the new data.

**Why deferred:** The future-screening filter (shipped 2026-05-19) already handles the most common case: stale-locked films re-enter the enrichment pool automatically when new future screenings appear. The cache-invalidation hook is orthogonal — it covers the case where a row already has future screenings, was previously locked at `'none-attempted'` due to bad scraped data (e.g. MALBA director field contaminated with `(NN')` runtime suffix), and a scraper improvement now produces cleaner data on rescrape. Without this hook, those rows stay locked and need a manual `UPDATE films SET match_source='none'` after every scraper improvement.

**Fix shape:**

- In `src/scrapers/ingest/films.ts:208` (`buildUpdateSet`), track whether the scraper-emitted value differs from what's currently stored. When ≥1 field meaningfully changes, also set `matchSource: 'none'` in the SET clause — but only when the row's current `match_source` is `'none-attempted'`. (Don't touch `'auto'` / `'override'` / `'manual'` rows — those should not be re-searched.)
- Drizzle's `excluded.X != films.X`-style predicate in the SET clause can express "set match_source only when it's currently none-attempted." Otherwise wrap the upsert in a transaction with a follow-up UPDATE.
- Test cases: (a) MALBA scraper re-emits cleaned director on a previously locked row → `match_source` flips to `'none'`. (b) Scraper re-emits identical data → `match_source` unchanged. (c) Scraper updates a field on a row at `'auto'` → `match_source` stays `'auto'`. (d) Scraper updates a field on a row at `'manual'` → `match_source` stays `'manual'`.

**Related:** Session 2026-05-19 surfaced this when MALBA's MOTELX cycle ended before the director-cleanup fix could re-flow through the affected rows. Combined with the future-screening filter, this would have automatically retried those rows on the next rescrape — even if the rescrape happened after the lock-out. Pure quality-of-life; defer until a similar scenario actually bites.

---

## 23. Unenriched films display in scraped casing (UX POLISH)

**What:** Films whose TMDB match has not succeeded (e.g. `match_source ∈ ('none', 'none-attempted')`, or `skip_tmdb=true`) keep their `scraped_title` verbatim in the cartelera. For Lorca-sourced films that's all-caps ("GIOIA MIA: UN VERANO EN SICILIA"); for MALBA bundles or curator-prefixed titles it can be visually noisy ("FUNCIÓN ESPECIAL: …"). Once a film matches TMDB, `films.title` gets overwritten with the canonical casing — but until then, the display is whatever the scraper saw.

**Why deferred:** Not a correctness issue, and the right fix is at the render layer, not the data layer. Per the matcher-normalization decision (session 2026-05-19), `films.scraped_title` is intentionally the audit trail of "what the scraper saw" — re-casing it at scrape time loses that signal and risks bad Spanish title-casing ("La Madre" instead of "La madre"). The display problem is separate from the matching problem.

**Fix shape (when picked up):**

1. **Render-layer smart-case helper.** When a film's `match_source ∈ ('none', 'none-attempted')` AND `title` is all-caps or otherwise obviously raw, apply a Spanish-aware title-casing function for display only. Rough rule: lowercase first, then capitalize first letter; leave articles ("la", "el", "los", "las", "de", "del") lowercase except at position 0. Don't touch the DB.
2. **Or: CSS-only fallback.** `text-transform: none` is the default; consider `font-variant: small-caps` or a "low-confidence" visual treatment that makes the unmatched state legible without needing to re-case the text.
3. Test cases: "GIOIA MIA: UN VERANO EN SICILIA" → "Gioia mia: un verano en Sicilia" (acceptable); "FUNCIÓN ESPECIAL: UN BUEN DÍA + DESPUÉS DE UN BUEN DÍA" → same shape but contains co-feature marker; "PELÍCULA SORPRESA" → "Película sorpresa". Verify the helper doesn't mangle proper-noun-heavy titles ("EL DESPRECIO" → "El desprecio" is fine; "BLADE RUNNER" → "Blade runner" is *technically* less canonical than "Blade Runner" but acceptable as a degradation since the film should match TMDB anyway).
4. Apply at the film-card render component (probably `src/components/film-card.tsx` or wherever the title text is emitted). Single place; reversible.

**Related:** [[project_afiche_state]] tracks the cartelera render layer. [[feedback_afiche_scraper_iteration]] is the principle that motivated leaving this at the render layer rather than the scraper.

**Estimated effort:** 1-2 hours including tests. Best paired with a /design-review pass.

---

## 22. Rescrape still loses enrichment after the 2026-05-07 structural fix (BUG / structural residue)

**What:** Despite v0.2.1.0 + v0.2.3.0 shipping the `scraped_year` split + `tmdb_id`-as-merge-axis fixes for the mutable-key upsert class (memory: `project_afiche_mutable_key_upsert_bug`), the operator continues to observe enrichment data getting "stepped on" during prod rescrapes (reported 2026-05-17). The original bug class is closed; this is a residual mechanism in the same family that the May 7 fix did not cover.

**Why:** The May 7 fix made the upsert *key* stable (`(scraped_title, scraped_year)` no longer mutates between scrapes). But the *update side* of the upsert — what columns get rewritten when a matching row already exists — may still be too aggressive. If `upsertFilm` does `ON CONFLICT (...) DO UPDATE SET poster_url = excluded.poster_url, director = excluded.director, ...` for every column (including enrichment-only columns), the scraper-stage values (mostly NULL for `posterUrl`/`director`/`tmdbId`/etc.) will null out the enriched data on every rescrape. The fix would limit the update to scraper-stage columns only (the title/scraped_title/scraped_year/maybe one or two scraper-emitted hints), leaving enrichment-set columns untouched.

**Hypotheses, ordered by suspected likelihood:**

1. **Field-level overwrite (most likely).** Upsert UPDATE clause covers enrichment-only columns. Investigate `src/scrapers/ingest/` for the `upsertFilm` (or equivalent) implementation; check whether it scopes the SET to scraper-emitted columns. Fix: scope `SET` to only what the scraper actually knows.
2. **Cross-provider title drift.** MALBA emits "Eraserhead", Lugones emits "Eraserhead " (trailing space), VLM-OCR'd Lorca emits "ERASERHEAD" or similar. Three distinct `(scraped_title, scraped_year)` rows for one film. The `tmdb_id`-merge logic resolves after enrichment runs, but during the rescrape→pre-enrichment window the cartelera may render the unenriched duplicate while the enriched original sits orphaned.
3. **Slug regeneration.** `films.slug` is computed from `title` (per `src/lib/slug.ts`). If TMDB's canonical title differs from the scraper's, an enrichment-time `title` update could regenerate the slug — breaking in-flight `/pelicula/<slug>` URLs that crawlers / social previews / personal bookmarks may already point at. Less likely the operator's reported "lost enrichment" issue, but adjacent and worth confirming the slug is locked post-insert (the schema comment at `src/db/schema.ts` line ~135 claims slug is stable "across the project's lifetime"; verify the upsert path doesn't violate that contract).

**How to investigate:**

```sql
-- Diagnostic 1: find rows where the enrichment-only fields are NULL but
-- tmdb_id is set — symptom of a recent overwrite that didn't fully clear
-- tmdb_id (or where enrichment never ran for some reason).
SELECT id, scraped_title, scraped_year, tmdb_id, poster_url, director,
       synopsis_es, match_source, match_confidence
FROM films
WHERE tmdb_id IS NOT NULL
  AND (poster_url IS NULL OR director IS NULL)
ORDER BY id DESC
LIMIT 50;
```

```sql
-- Diagnostic 2: find duplicate (scraped_title, scraped_year) candidates
-- where one row is enriched and another isn't.
SELECT a.id AS enriched_id, b.id AS unenriched_id,
       a.scraped_title, a.scraped_year, a.tmdb_id AS enriched_tmdb_id,
       b.tmdb_id AS unenriched_tmdb_id, b.match_source
FROM films a
JOIN films b ON a.scraped_title = b.scraped_title
              AND a.scraped_year IS NOT DISTINCT FROM b.scraped_year
              AND a.id < b.id
WHERE a.tmdb_id IS NOT NULL
  AND b.tmdb_id IS NULL;
```

Then read `src/scrapers/ingest/` (likely `upsert.ts` or similar) to confirm the `ON CONFLICT DO UPDATE SET` clause's column list.

**Fix shape (assuming hypothesis 1 is right):**

- Restrict the upsert's `SET` to scraper-emitted columns only. The Drizzle pattern:
  ```ts
  onConflictDoUpdate({
    target: [films.scrapedTitle, films.scrapedYear],
    set: { /* only scraper-stage columns: scraped_title, scraped_year (no-op),
             maybe `country` if the scraper extracts it. NEVER poster_url,
             director, tmdb_id, synopsis_es, runtime_min, cast, genres. */ },
  })
  ```
- Pair with a regression test in `src/scrapers/ingest.test.ts`: enrich a film, simulate a rescrape, assert that `poster_url`, `director`, `synopsis_es`, `tmdb_id` remain unchanged.

**Pros:**
- Clean operator workflow — manual TMDB ID patches stop getting overwritten.
- Cuts re-enrichment workload (currently the enrichment loop has to re-resolve TMDB for any film whose data got nulled).
- Closes a class of bug that was never fully closed by May 7.

**Cons / risks:**
- Touches the hottest path in ingest. Regression risk for happy-path scrape correctness if the column scope is too narrow (e.g., if some scraper-emitted hint genuinely should refresh on rescrape).
- Cross-provider title drift (hypothesis 2) is structurally adjacent and may need to be addressed in the same cycle.

**Effort estimate:** S–M (1-3 hours of focused investigation + fix + tests). Possibly L if hypothesis 2 turns out to also be live in prod and needs a normalize-on-write strategy.

**Priority:** P2 — operator-facing pain, affects every prod rescrape currently. Not blocking ship, but every rescrape costs cleanup effort until fixed.

**Per Afiche ship workflow:** scraper + ingest path → branch + PR, not direct-to-main. Pair with a `/plan-eng-review` to lock the column-scoping rule + test plan before implementing.

**Depends on / blocked by:** nothing. Investigation can start from prod evidence (the two diagnostic SQL queries above).

**First-step action:** run the two diagnostic SQL queries against prod, paste a few example rows into the next session, and `/plan-eng-review` from there. The fix is short once the diagnosis is named.

---

## 21. Wall-of-afiches: full-screen interactive poster wall as a second view (CONCEPT)

**What:** A full-screen "Street-View POV" looking at a wall covered in the posters of currently-playing films. The user navigates by panning / scrolling / tilting; the wall is the cartelera but as a *visual lineup*, not a card-by-card list. Idea floated 2026-05-17 at end-of-day — captured here so it survives until next session.

**Why it has legs (more than the usual "fun feature" pitch):**

The name "Afiche" *literally means poster* in Spanish (Argentinismo for *cartel* / *poster*). MALBA, Lugones, and Lorca all have physical afiche walls in their lobbies. Walking past a BA street kiosko or a cinema-front cartelera IS the visual the product name evokes — the brand draws its identity from that exact experience. This makes the wall view a rare case of a "fun" feature that's *fused* to the product's identity, not detached from it. Compare to almost any other "delight" feature that has to justify itself against the product's core — this one inherits the justification from the name.

**The real question — does discovery deserve a second view?**

The cartelera answers *"when can I see X?"* (decision tool — what we have). The wall would answer *"what does the lineup LOOK like right now?"* (mood / discovery / browsing — what we don't). Different jobs. Second views often fail to earn their keep past the first novelty session unless they genuinely serve a job the primary view can't. The honest case for this one: the cartelera serves *decision* well but *discovery* weakly — to browse the city's offering you have to scan card-by-card, and that's not the same as "stand in front of the wall and look at everything at once." So discovery genuinely IS a different intent the cartelera doesn't serve.

The risk: novelty visits, low return engagement. The wall might be tapped once at launch, screenshot for X, then never opened again. Mitigation: the wall is a *secondary* surface, not a primary one — its existence doesn't tax the cartelera's main flow. Even if return engagement is low, the launch-moment / press-moment / X-shareable-screenshot value might justify it standalone.

**Three engineering paths, ~10× effort range:**

| Path | What it is | Effort | Pros | Cons |
|---|---|---|---|---|
| **A. CSS perspective scroll** | Horizontal-scrolling grid of posters with CSS `perspective` + `transform: rotateY()` so the row reads as a flat wall seen at angle. Snap-scroll to center a poster. | S (~4-6 hrs CC) | Zero new deps. Mobile-native (touch scroll). Tab-keyboard accessible by default. Works at 375px width. | Not literally "POV" — the wall is one-dimensional, no looking up/down. The metaphor is suggested, not embodied. |
| **B. WebGL POV (three.js / r3f)** | Real 3D camera over a textured plane of posters. Pan, zoom, look-around via touch/drag/scroll. Optional ambient lighting suggesting venue (gallery? kiosko? street at night?). | L (~16-24 hrs CC + bundle cost) | Embodies the metaphor literally. Most editorially expressive — lighting/angle/depth become design vocabulary. Genuinely *novel* at the BA-cinephile scale. | Mobile touch UX is hard to get right — three.js camera controls are mouse-shaped by default; mobile-good libs exist but add another dep. Bundle cost ~100KB minified for r3f. Accessibility story is rough. |
| **C. Panoramic image** | Server-side composite of all current posters tiled into one wide image; client pans it horizontally like a panorama. Each poster is a clickable region (image map or absolute-positioned anchors over the image). | M (~8-12 hrs CC) | No 3D math. Pre-rendered image is a single asset (CDN-cacheable, deterministic). Mobile pan UX is standard. Could even render as a static OG/X-share image. | The "wall" looks flat from one viewpoint only — no parallax, no atmosphere. Updates require re-rendering the image on every scrape. |

**Constraints worth flagging at implementation time:**

1. **Mobile is the binding constraint.** Most Afiche traffic is likely mobile. A 375px screen can show ~3-4 posters at usable resolution; trying to show "the whole wall at once" on mobile defeats the metaphor. Mobile may need a fundamentally different interaction (vertical scroll past large posters? swipe-deck?) than desktop's wider POV.
2. **DESIGN.md's "carmine offset shadow on posters" is the non-negotiable visual fingerprint.** On a wall view, what happens to the shadows? Stacked posters would clip each other's shadows; a true 3D scene needs to decide whether shadows render in-world or stay 2D-decorative. This is a real design call, not a detail.
3. **Spacing aesthetic — kiosko vs gallery.** Physical kiosko packs posters edge-to-edge with overlap; gallery walls use generous margins. The choice flavors the whole feature — kiosko reads as "what's playing tonight, urgent, dense"; gallery reads as "this season's lineup, curated, contemplative." Either fits Afiche; pick one.
4. **What does the wall do for partial-card / no-poster films?** A wall of posters has no graceful fallback for films without posters (~20% of indie titles per current state). Typographic placeholder posters? Hide them? Group them in a separate "sin afiche" section?
5. **Discoverability — how does a user get to the wall?** Top-nav button? Easter-egg from the masthead? Mobile gesture? The discoverability decision affects how much the wall earns its keep — if it's buried, low engagement is guaranteed.

**Editorial connection deserves a /design-shotgun pass.** The literalness spectrum (A → B → C above) is a design call, not an engineering one. /design-shotgun could generate variants across the spectrum (CSS row, kiosko-dense WebGL, gallery-spacious WebGL, panoramic single image) and the comparison would surface the right shape faster than reasoning about it abstractly.

**Effort estimate:** Wide range — depends on path (S-L). /office-hours session: 30 min. /design-shotgun: ~60 min. Implementation: 4-24 hrs CC depending on path.

**Priority:** P3 — delight, not friction. The friction queue (#20 expired screenings, #16/17 distribution, #19 indexability) addresses known-bad behavior affecting every-evening users; delight queue moves after friction queue. That said: the editorial fit is unusually strong, and a launch-moment / press-moment / X-shareable visual would be high-impact if Afiche ever wants a public push.

**Depends on / blocked by:** Nothing technical. Strategically gated on (a) /office-hours framing decision *"is the right second view a poster wall, or something else (calendar view, programs index, this-week-at-a-glance)?"* — per `feedback_afiche_editorial_revisit.md`, metaphor drives flavor but does NOT veto UX, so the wall must win on UX merit, not just on metaphor strength. (b) /design-shotgun pass to pick the literalness path before any code.

**First-step action:** Run `/office-hours` with the framing question above. If wall wins as the answer: `/design-shotgun` for the A/B/C path. If something else wins: capture the right answer as TODO #22, retire #21 to "did not pursue" with a note explaining why.

**Trigger to revisit:** When the friction queue is healthier (#20 shipped, #16/17 active), OR when a discovery-shaped user signal emerges in conversation ("I wish I could browse what's playing without committing to a date" feedback), OR if the operator wants a launch/press/X-shareable visual moment.

---

## 20. Expired screenings dominate the cartelera at typical evening visit times (UX BUG)

**What:** Today's day section currently renders ALL of today's screenings as full cards regardless of whether they've already started. A user opening Afiche at 20:00 BA sees the 17:00, 18:30, and 19:00 screenings (all already started — "expired") taking full poster+synopsis+metadata card space at the top of today's section, forcing them to scroll past stale content before reaching what's actually still seeable tonight. The dominant cartelera-visit intent at evening hours is *"what's still possible to see tonight?"* — current behavior serves the wrong intent.

**Why:** BA indie screening times cluster in the 18:00-22:00 window. Most Afiche traffic during evening hours is people deciding *right now* what to go see. Past-start screenings at the top of the day section are pure friction for that intent — they consume the page's most valuable real estate (above the fold of today's section) on content the user can no longer act on. This is a real UX bug, not a polish concern; it degrades the dominant use case at the dominant time of use.

**Three coherent solutions:**

| Option | What it does | Pros | Cons |
|---|---|---|---|
| **A. Collapsible toggle** (recommended) | Hide expired by default. Render a single line above today's first upcoming card: *"Ver N funciones ya iniciadas ↓"*. Tap expands. | Preserves info for the rare *"wait what played at 17:00?"* curiosity. Density signal preserved (the count hints at the day's overall activity). Reversible to B if engagement data shows it's never tapped. | Adds a tiny bit of UI surface area (toggle + animation). Implementation needs client-side state if the toggle is interactive (or pure server-side render with a `<details>` element — see below). |
| **B. Hide entirely** | Filter expired screenings out of today's section. No mention they existed. | Simplest. Zero UI. The cleanest "decision tool" interpretation. | Loses information. A cinephile checking *"when else is Bird playing this week?"* on the cartelera would miss that it was at Lorca tonight. |
| **C. Thin one-row text index** | Above today's first upcoming card, render a single horizontal text row: *"Ya pasaron hoy: 17:00 Bird (Lorca) · 19:00 Drama (Cosmos)"*. No poster, no synopsis, no fold-out. | Lowest tax on real estate while still preserving info. Mubi's "previously" pattern. | Long days (8+ expired screenings) will wrap or overflow horizontally. Mobile width is the binding constraint — only the first ~3 might fit before truncation. |

**Recommendation:** **A** (collapsible) for the first cut. Captures both intents (default = "still seeable", expandable = "what played today") without committing to a long-term call. If engagement data later shows the toggle is rarely tapped, demoting to B is one PR. The HTML-native `<details><summary>` element gives this for free with zero JS — pure server-side render, accessible by default, keyboard-friendly.

**"Expired" definition — needs to be explicit:**

Naive: `startsAtUtc < now()`. Better: `startsAtUtc + grace_minutes < now()` where `grace_minutes` is something like 10-15. BA indie cinemas typically have a grace period; a user looking at the cartelera at 19:12 for a 19:00 screening at Lorca can sometimes still walk in. The grace period guards against the edge case of "screening started 30 seconds ago = already gone" which is technically true but feels harsh. Empirically pick a value once and document it.

"Now" MUST be BA-local. The project already has `getIsoWeekStartBA(now)` etc. in `src/lib/iso-week.ts` — same discipline applies. A naive UTC comparison would consider a 21:00 BA screening (00:00 UTC next day) "expired" the moment the cron rolls over UTC midnight, which is wrong.

**Edge cases to handle:**

1. **All of today's screenings are expired.** Late-evening visitor at 23:30 — should the day section render `<details>` with everything inside? Or surface editorial copy *"Las salas ya cerraron por hoy. Mirá lo de mañana ↓"*? The latter aligns with DESIGN.md's voice (cf. the existing empty-day editorial line *"Las salas descansan."*).
2. **The "HOY" chip in the date strip.** If everything today is expired, does HOY still get the carmine fill on initial paint? The date-strip bootstrap currently seeds active=today's `dateKey` regardless of content state. The active state shouldn't change — the user IS still positioned at today's section, just that today's section is mostly archive. The carmine fill following the active section is the correct behavior.
3. **Same problem on `/pelicula/<slug>`.** Past screenings of a single film at the top of the screenings list crowd out future ones too. The fix should compose: whatever pattern lands on the homepage (A/B/C) applies to `/pelicula/` too. Worth doing in one cycle.
4. **SSR staleness.** If a screening is at 20:00:00 BA and SSR renders at 19:59:30 (cached for 60s), a user hitting the cached HTML at 20:00:15 will see the 20:00 screening as "still upcoming" when it's technically already started by the grace-period definition. Acceptable error margin given the grace period itself absorbs this. Don't add per-minute revalidation just for this — the BA cinema-going pattern doesn't reward second-precision freshness.
5. **The Tier-2 Próximamente list isn't affected** — it only contains screenings beyond day 14, all future by definition.

**Effort estimate:** S (~2-3 hrs CC). Mostly a `WHERE` clause on the today-section query + a `<details>` wrapper. Maybe M if applied to `/pelicula/` in the same cycle.

**Priority:** P1 — high-impact, every-evening-user, current behavior actively degrades the dominant intent.

**Depends on / blocked by:** Nothing. The grace-period number is a one-time editorial decision (suggest 15 min, can iterate). BA-now math already exists in `src/lib/iso-week.ts`.

**First-step action:** Decide the grace-period value (15 min recommended), pick Option A/B/C, implement in `src/db/queries.ts` (today-section query filter) + `src/app/page.tsx` (the `<details>` wrapper if Option A). Apply the same pattern to `src/app/pelicula/[slug]/page.tsx`.

---

~~**19. Indexability strategy for `/pelicula/<slug>` — keep noindex or restructure for persistence? (STRATEGIC)**~~ Resolved 2026-05-17 via /office-hours design doc `~/.gstack/projects/kino/benjamin.delasoie-main-design-20260517-135641.md`. **Strategy A locked.** `/pelicula/<slug>` keeps `robots: { index: false }` (`src/app/pelicula/[slug]/page.tsx:97`); curated channels (physical posters + X + newsletter + word-of-mouth) remain primary acquisition; SEO is deferred. Triggers to revisit: (a) curated channels plateau for 4+ weeks AND operator wants more growth, OR (b) Vercel Analytics shows >10% of homepage traffic from Google referrer over a 4-week window while /pelicula/ stays noindex (surprising organic upside that suggests the lifecycle restructure would pay back). Sub-items #13.1 reframed (JSON-LD via shared helper — homepage authoritative; /pelicula/ future-optional) and shipped in same PR; #13.2 strike-closed (slug-history is irrelevant when pages 404 on departure — no SEO link equity to preserve).

**Original framing (preserved for the strategic-decision trail):**

**What:** `/pelicula/<slug>` currently emits `robots: { index: false, follow: true }` (`src/app/pelicula/[slug]/page.tsx:97`). The decision was made during /design-review outside-voice #4 to protect against flap-404 SEO penalties — pages 404 when no upcoming screenings exist, and Google penalizes URLs that flip between 200 and 404 as low-quality. Per-film pages are therefore invisible to search engines by design.

Two strategies are coherent. This TODO is the decision, not the implementation:

### Strategy A: Keep noindex (current state)

Acquisition channels = curated/owned (X #16, newsletter #17, word-of-mouth). SEO is a non-channel. JSON-LD on `/pelicula/<slug>` is a no-op feature (blocked, see TODO #13.1 dependency). The page exists for cinephiles arriving from the cartelera, not for cold search traffic.

**Defensible when:** Afiche stays a hyper-local cinephile cartelera; the audience finds it through channels the operator controls. SEO investment doesn't pay back at this scope.

### Strategy B: Indexability-first via persistent pages

Restructure `/pelicula/<slug>` lifecycle. Page never 404s once a film has had at least one BA screening. Content shifts based on liveness:

- **Live (upcoming screenings exist):** current layout — the "when/where to see it" killer feature.
- **Archived (no upcoming screenings):** "*Film Title* played in BA from May 1-14. [past screenings list]. Currently no upcoming screenings. [related films playing now / streaming links if known]."

Remove `noindex`. Add JSON-LD (`Movie` + `ScreeningEvent` when live; `Movie` only when archived). SEO compounds over months — pages become canonical answers for "film-name + buenos aires" queries. Archive becomes a real product feature: "what played at MALBA in May 2026?" becomes answerable.

**Defensible when:** Afiche aspires to be **the canonical BA cinema reference**, not just this week's cartelera. The brand-with-BA decision (memory: project_afiche_brand_ba) and the user-organized-screenings direction (memory: project_user_organized_screenings) both point this way — both benefit from a stable URL space.

### Decision factors

| Factor | A (noindex) | B (indexable + persistent) |
|---|---|---|
| Acquisition cost | Manual: X, newsletter, word-of-mouth | Compounding: SEO over months, ~free once seeded |
| Engineering investment | Zero new work | M-L effort: lifecycle redesign + archive-state UI + JSON-LD + maybe slug-history (#13.2) |
| Brand positioning | "BA cinephile's cartelera" | "The structured BA cinema index" |
| Failure mode if wrong | Audience plateaus at curated channels' reach | Engineering time spent on a feature that doesn't compound (rare query patterns, no organic traffic) |
| Reversibility | Low cost to flip later | Low cost to add noindex back |

### Why this is upstream of multiple other TODOs

This decision gates:
- **#13.1** (JSON-LD `Movie` + `ScreeningEvent`) — value prop unreachable while `noindex` is on; only useful under Strategy B.
- **#13.2** (slug-history for 301 redirects) — defensive against slug-change incidents under Strategy B; irrelevant under Strategy A (pages 404 anyway).
- **#14** (Programs entity expansion to `/programa/`) — `/programa/` pages would face the same indexability question; coherent answer requires Strategy choice first.
- **#11** (.ics calendar export) — orthogonal; ships under either strategy.
- **#16, #17** (X presence, newsletter) — orthogonal; both work under either strategy.

### Why this isn't a quick-fix decision

The persistent-pages restructure is M-to-L work that needs more than a coding session:

1. **Archive-state UI is a different page genre.** It's not the live page with sections hidden — the dominant content shifts from "when can I see it" to "this film's BA history + where to watch now." Deserves a /design-shotgun pass.
2. **Data model implications.** Current schema treats screenings as the source of truth for "does this film page exist." Persistent pages need a separate "this film has appeared in BA at least once" signal (could be `films.first_screened_in_ba` timestamp, or just `EXISTS (SELECT 1 FROM screenings WHERE film_id = X)` regardless of date).
3. **Editorial commitment for archive states.** A page that says "Currently no upcoming screenings" is editorially flat unless paired with related-film recommendations or streaming-availability lookups. Choosing what goes in the archived state is itself a design call.
4. **Search Console setup + monitoring.** Removing `noindex` should be paired with indexing health monitoring (Search Console properties, crawl coverage reports). Operator workflow change, not just code change.

### Trigger to revisit

- Operator decision that Afiche should expand beyond curated channels (probable signal: stalled audience growth via X/newsletter despite editorial effort).
- Stable editorial cadence on the cartelera makes the live → archive transition uniform across films (need consistent rhythm for archive pages to read as a coherent corpus).
- Time to invest M-L engineering work in a single direction (probably not during /office-hours-pending exploration of user-organized-screenings).

**First-step action:** Spin `/office-hours` on the indexability question itself with the framing *"Is Afiche the cartelera (Strategy A) or the index (Strategy B)?"* — get to a saved design doc with the decision locked. Then either accept Strategy A and strike-close #13.1, OR plan the Strategy B engineering work as a multi-cycle initiative.

**Depends on / blocked by:** Nothing technical. Needs a strategic-direction session and operator commitment.

---

~~**18. Nosferatu disambiguation — MALBA Cineclub Nocturna mismatched to wrong film (BUG)**~~ Resolved structurally 2026-05-11 (v0.2.3.3). Diagnosis: MALBA's Cineclub Nocturna 5 page rendered the film as just "Nosferatu", scraper extracted `scrapedTitle="Nosferatu"` + `director="Werner Herzog"` + no year, TMDB search returned both Eggers 2024 (title="Nosferatu", score 1.0) and Herzog 1979 (title="Nosferatu, fantasma de la noche", score ~0.87). `pickBestMatch` picked Eggers on the higher title score; the director hint was plumbed through but never consulted because the existing director-fallback was a low-confidence rescue path (only fires when `pickBestMatch` returns null). Two complementary fixes ship together in `src/tmdb/`: (1) **director-verification on the top match** in `enrich.ts:145-180` — when a director hint is provided, fetch the top candidate's TMDB credits (already happens) and check `directorsMatch` against the hint; on mismatch, fall through to the existing director-fallback with the top details cached (no duplicate API call); (2) **title-ambiguity guard** in `match.ts` `pickBestMatch` — when top-2 candidates both clear the 0.85 threshold AND tie within `TITLE_AMBIGUITY_EPSILON=0.01`, return null so the caller can disambiguate (covers the adjacent case where TMDB has multiple entries with identical localized titles). Operator-side cleanup: the bad prod row had `match_source='auto'` so a next-scrape rebuild won't re-touch it. Manual patch in Drizzle Studio (set `tmdb_id=5648, match_source='manual', poster_url=NULL`) and run `npm run db:enrich:prod` to re-fetch metadata — or just delete the row since the screening already passed. Tests in `src/tmdb/match.test.ts` + `src/tmdb/enrich.test.ts` lock down both fix paths.

**Original context (preserved for the bug-class trail):**

**What:** MALBA's Cineclub Nocturna 5 page (`https://malba.org.ar/evento/cineclub-nocturna-5/`) is a screening of Werner Herzog's **Nosferatu, fantasma de la noche** (1979, TMDB likely id ~5648). Afiche matched it to Robert Eggers' **Nosferatu** (2024, TMDB id 426063). User-visible: the wrong poster + wrong synopsis on the cartelera.

**Root cause hypothesis (verify before fixing):**

The bug class is "ambiguous title resolved to most-popular TMDB hit." `enrichFilm()` runs a fuzzy search; for a bare "Nosferatu" string with no other disambiguators, TMDB returns the most popular/recent match (Eggers 2024) rather than Herzog 1979.

Two specific failure points to check by inspecting the prod row:

```sql
SELECT id, scraped_title, year, director, tmdb_id, match_source, match_confidence
FROM films
WHERE tmdb_id = 426063 OR scraped_title LIKE '%osferatu%';
```

- **If `director` column is NULL:** the MALBA scraper didn't extract director from the cycle page. Fix is at the scraper layer — figure out which Cineclub Nocturna format is in use and extend the parser to capture director (`src/providers/malba.ts` already has director-extraction for some formats — line ~293 and ~711). With `director: "Werner Herzog"` passed to `enrichFilm`, the director-fallback path at `src/tmdb/enrich.ts:151-164` would walk top-N candidates and pick the right one.
- **If `director` is "Werner Herzog" but `tmdb_id` is 426063 anyway:** the bug is in the matcher — director-fallback didn't fire or didn't recognize the match. Audit `directorsMatch()` at `src/tmdb/enrich.ts:191`.

**Quick fix (operator-side, ship today if you want):** Add to `tmdb-overrides.json`:

```json
{
  "scrapedTitle": "Nosferatu",
  "tmdbId": 5648,
  "note": "Werner Herzog 1979 (Cineclub Nocturna 5). Without override, fuzzy search picks Eggers 2024 (id=426063) — the most popular Nosferatu on TMDB."
}
```

(Verify the TMDB id is actually 5648 before committing — search `tmdb.org` for "Nosferatu the Vampyre 1979".)

Then either:
- Manual patch in Studio: `UPDATE films SET tmdb_id=5648, match_source='manual', poster_url=NULL WHERE id=<the_row>;` then run `npm run db:enrich:prod` to re-fetch metadata
- OR delete the row and let next scrape recreate it; the override will be checked first

**Structural fix path (the right answer for the bug class, not just this one film):**

This is the same TMDB-fuzzy-fails-on-ambiguous-title risk discussed in the architectural review's Smell 1 (Aggregate + Source pattern). Other ambiguous titles likely already silently mismatched too — `Nosferatu` is just the one we caught. Worth a one-shot diagnostic pass:

```sql
-- Find films with low match_confidence — candidates for manual review
SELECT id, scraped_title, year, director, tmdb_id, match_confidence
FROM films
WHERE match_source = 'auto' AND match_confidence < 0.85
ORDER BY match_confidence;
```

If the list is short, eyeball each one against the source venue page. If long, the structural answer is to upgrade the matcher to be stricter about title-uniqueness (e.g., reject any match where TMDB returns 2+ candidates with the same title and we have no director hint — flag as `none-attempted` for operator review instead of guessing).

**Editorial note:** Cycle-context is also a strong signal. "Cineclub Nocturna" is a curated cycle of older / cult / classic films — Eggers 2024 doesn't fit the curatorial profile. A future enhancement: pass `programName` as a hint to TMDB search, weighting older films when the program signals "classic" or "retrospective" framing. Heuristic, but would help on this exact bug class without requiring per-film overrides.

**Depends on / blocked by:** Nothing for the override quick-fix. Structural fix is a milestone-sized refactor (Smell 1 / Aggregate + Source).

**First-step action:** Run the diagnostic SQL above against prod; check the `director` column on the bad row to determine which layer needs the structural fix. Add the override either way as the operator-side patch.

---

~~**15. Synopsis preview clamping inconsistent on desktop (BUG)**~~ Resolved 2026-05-11. Root cause: the synopsis `<p>` in `ScreeningCard` (src/app/page.tsx) co-located `line-clamp-3` with `hidden md:block`. `line-clamp-N` requires `display: -webkit-box` to function; `md:block` is `display: block` inside `@media (min-width: 48rem)`. At equal specificity, the responsive variant wins on source order at the breakpoint and silently defeats the clamp — paragraphs then render at content height (2/4/6+ lines). Fix: pushed `hidden md:block` (and `mt-3`) onto a wrapper `<div>`, leaving the `<p>` with `line-clamp-3` + styling only. Added a regression guard in `src/app/layout-invariants.test.ts` that scans `src/app/**/*.tsx` and fails on any className combining `line-clamp-N` with a display utility (`block`, `hidden`, `flex`, `grid`, ...) — fixture-style, same discipline as the existing `<main>` w-full check. /pelicula/ was not affected (it renders the full synopsis unclamped).

**What:** On desktop, the synopsis preview on film cards (cartelera tier and `/pelicula/` related-film tiles) doesn't clamp to a uniform line count. Some cards show 2 lines, some show 4, some overflow further. The visual rhythm of the row breaks because card heights are unequal.

**Why:** Cards in the same row should have synopsis previews of equal height. Today the height is content-driven (whatever the synopsis happens to be). With Spanish synopses ranging from 80 to 600+ chars, this produces visibly ragged tiles.

**How to investigate:**
- Likely cause: the synopsis preview element doesn't have a `-webkit-line-clamp` rule, OR it has one but the parent's flex/grid alignment doesn't propagate height equally, OR the line-clamp rule competes with `min-height`/`height: auto` that lets longer text expand the card.
- Reproduce: open `/` on desktop (>= md breakpoint), pick any cartelera section with 4+ cards, eyeball synopsis heights. Should be visible immediately on the homepage as currently rendered.
- Likely files: the inline `ScreeningCard` component in `src/app/page.tsx` (per the inline-components-in-page-tsx pattern memory). Search for `synopsis` in that file.

**Fix candidates:**
- A. Add explicit `line-clamp-3` (or whatever target) on the synopsis paragraph + ensure the parent card uses `flex flex-col` with the synopsis as the flex-grow:1 child so the bottom row of metadata stays anchored
- B. Truncate the synopsis text server-side to a fixed char count before rendering (less responsive but bulletproof)
- C. Use `display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden` if `line-clamp` is misbehaving (Tailwind's `line-clamp-N` should set this trio automatically — verify it's not being overridden)

**Trigger to act:** when next polishing the homepage. Visually obvious; not blocking.

**Depends on / blocked by:** Nothing. Pure CSS / component-layer fix.

---

## 16. Twitter/X presence — semi-manual first, bot maybe later

**What:** BA cinephile community is on X (per user's domain knowledge — verified, this is a real audience). Afiche should have a presence there for top-of-funnel discovery. Initial form: NOT a fully-automated bot. Instead:

- Stage 1: Afiche emits a "today's pick" tweet draft via a scheduled job (e.g., daily cron). Draft contains: 1 curator pick + venue + time + a hook. Posted to a private Slack/Telegram/email queue for human review + manual post.
- Stage 2 (only if engagement validates the audience hypothesis): graduate to direct API posting once worth the X API cost.

**Why:** The audience exists and the structured data (cartelera + screenings) is already there. Posting to X is the natural distribution layer for the cinephile community in BA.

**Why NOT a bot from day one:**
- X API: free tier caps at ~50 writes/day with rate limits that choke daily cron in practice. Basic paid tier is $200/month — real cost decision for a personal project.
- Auto-generated tweets read as spam in cinephile spaces. The accounts that work in this community have human editorial voice. A "TONIGHT 22:00 LORCA: Bird" dump gets muted.
- Personal-account-with-Afiche-source is also defensible: Benjamin tweets from his own handle pointing back to Afiche. Lower friction, authentic voice.

**What to build (Stage 1):**
- A `pickOfTheDay()` function that selects 1 screening from today's cartelera based on some curator heuristic (premiere? único? rare director?)
- A `formatTweet(pick)` function that produces a 280-char editorial-voice tweet draft
- A scheduled job that posts the draft to a queue (Slack webhook, Telegram bot, email — cheapest is email to self)
- A way to mark a pick as "already tweeted" so the same film doesn't queue twice (timestamp on the pick? small `tweet_log` table?)

**Editorial voice (DESIGN.md cross-reference):** the project_afiche_editorial_revisit memory says "metaphor drives type/palette/voice but does NOT veto UX". Tweet voice should follow Afiche's editorial flavor — curator-y, knowing, not corporate — without becoming precious.

**Cons / risks:**
- Even semi-manual takes daily attention. Skip days are visible.
- If queue-to-Slack is the trigger and Slack fills with drafts you don't review, the channel goes silent. Pick a delivery mechanism that fits your daily routine.
- BA cinephile community can be small and connected; tone calibration mistakes are visible.

**Depends on / blocked by:** Nothing. Independent of the site's current architecture. Could ship before #17 (newsletter signup) since X is a discovery channel and newsletter is a retention channel — opposite ends of the funnel.

**First-step action:** spike the `pickOfTheDay()` heuristic against the live `screenings` table for a week to see if the picks are actually interesting. If yes, build the queue. If they're flat, the editorial heuristic itself needs work first.

---

## 17. Newsletter signup capture (build now), actual sends (defer)

**What:** Two-stage rollout for an email newsletter:
- Stage 1 (build now): a discreet "get the weekly Afiche" signup form on the homepage + a per-`/pelicula/` capture. Just collect emails. No sending yet.
- Stage 2 (defer until traffic + commitment are real): start sending a weekly digest with curator's pick of the week + 3-5 highlighted screenings.

**Why two stages:** Newsletter is a long-term right channel for the cinephile audience — algorithm-immune, owned, durable. A list of 500 cinephiles you control beats 5000 X followers you rent. BUT a newsletter needs three things to work that Afiche doesn't yet have:
- **Traffic:** signup conversions need to compound. Rough benchmark: 100+ organic weekly visits.
- **Editorial commitment:** writing it weekly for 12+ weeks before judging traction. Otherwise it's "we sent 4 issues to 12 friends, then quietly stopped" — common indie-newsletter failure mode.
- **Clear scope:** weekly digest vs daily? curator pick vs full cartelera? Doesn't compete with the site.

The signup form itself is cheap to build today; starting accumulation early means the first newsletter has a real list, not 12 friends.

**Stage 1 build:**
- Pick a provider. Recommended: **Buttondown** (free tier up to 100 subscribers; built for indie newsletters; clean API). Alternatives: Resend (more transactional-flavored), ConvertKit (overkill for indie scale), self-hosted Listmonk (ops burden).
- One signup component reused on `/` and `/pelicula/<slug>`. Probably inline in `page.tsx` per the inline-components-in-page-tsx pattern memory.
- A POST endpoint that calls the provider's API to add the email. Server action or `/api/newsletter/subscribe` route.
- Argentine privacy law (Ley 25.326) compliance: explicit consent checkbox, plain-language privacy note, easy unsubscribe. Lighter than EU GDPR but exists.
- Optional confirmation email (double opt-in) — best practice for deliverability and list hygiene.

**Stage 2 trigger conditions:** all three must be true before launching actual sends:
- (a) `~100+ organic weekly visits` for at least 4 consecutive weeks
- (b) operator commitment to writing 12+ weeks of weekly issues without skipping
- (c) defined scope ("weekly digest, every Thursday morning, 1 pick + 4 highlights")

**Editorial spec for Stage 2:** ONE pick of the week that ALSO becomes the X tweet (#16) and a "pick of the week" anchor on the site. Don't fragment editorial effort across channels — same writing, three distribution layers.

**Cons / risks:**
- Email infrastructure (deliverability, SPF/DKIM, list management) has a learning curve. Buttondown abstracts most of it.
- A signup form that leads nowhere for 6 months is OK; one that leads to 4 issues then silence is worse than no signup at all. Don't start sending until commitment is locked.
- Discovery problem persists — newsletter doesn't acquire users, only retains them. Pair with #16 for top-of-funnel.

**Depends on / blocked by:** Nothing for Stage 1. Stage 2 depends on Stage 1 + traffic + editorial commitment.

**First-step action:** spike the Buttondown integration on a feature branch, drop the signup form into `/` and `/pelicula/`, ship behind a feature flag if you want to A/B placement.

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

**✅ STATUS UPDATE 2026-05-17 (supersedes 2026-05-11):** Sub-items #13.1 and #13.2 resolved via /office-hours + /plan-eng-review on 2026-05-17. See design doc `~/.gstack/projects/kino/benjamin.delasoie-main-design-20260517-135641.md` and test plan `~/.gstack/projects/kino/benjamin.delasoie-main-eng-review-test-plan-20260517-142914.md`.

- **#13.1 (JSON-LD) — reframed and shipped.** Original framing scoped JSON-LD on `/pelicula/<slug>` as part of a Strategy B SEO play; the May 17 design doc replaced this with a Strategy A scope: shared helper at `src/lib/json-ld.tsx`, homepage emits `@graph<ScreeningEvent>` (7-day high-intent window — the authoritative SEO surface since `/` is publicly indexed), `/pelicula/<slug>` alive emits `Movie + subjectOf<ItemList<ScreeningEvent>>` as future-optionality (read-and-discarded by Google today; pre-baked for the Strategy A revisit-trigger). XSS-safe via `</`→`<\/` escape + U+2028/U+2029 escape in `serialize()`. ScreeningRow extended with `cinema.address` for MovieTheater enrichment.
- **#13.2 (slug-history) — strike-closed.** Strategy A locks `/pelicula/<slug>` to 404 on departure, so there is no SEO link equity to preserve via 301 redirects. Re-open if and only if Strategy A's revisit-trigger fires and noindex is dropped — slug-history becomes load-bearing under any persistent-pages restructure (orphaning risk for indexed URLs).
- **#13.3 (program-name normalization) — still open.** Independent of indexability; re-evaluate when /programa/ pages are planned (TODO #14).

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

**Indexability note (inherited from TODO #19, locked 2026-05-17):** when `/programa/<slug>` pages eventually ship, default them to `robots: { index: false }` (Strategy A precedent). The indexability sub-question is answered upstream — no separate /office-hours needed for /programa/ unless TODO #19's revisit-trigger fires. JSON-LD on `/programa/` would follow the same future-optionality pattern as `/pelicula/`: emit a structured payload via the shared `src/lib/json-ld.tsx` helper, ready for Strategy A flip, but understand Google does not surface it while noindex is on. See `~/.gstack/projects/kino/benjamin.delasoie-main-design-20260517-135641.md`.

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
