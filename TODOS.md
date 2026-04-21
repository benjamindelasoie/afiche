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

## 5. Design-review findings backlog (F002-F025, from 2026-04-21 audit)

Full audit report at `~/.gstack/projects/kino/designs/design-audit-20260421-0022/design-audit-afiche.md`.
Overall Design Score at time of audit: **C+**.  AI Slop Score: **A**.
F001 (Arial-not-Geist critical) fixed in commit `48cd1f1`. Remaining:

### High impact (fix these next, move C+ → B+)

- **F002 — Synopsis measure 96 chars/line on desktop.** `src/app/page.tsx:108` — change `max-w-2xl` → `max-w-prose` or `max-w-xl`.
- **F003 — `<img>` tags missing `width`/`height`.** Causes CLS as posters load. `src/app/page.tsx:82-87` — add `width={80} height={112}` or switch to `next/image`.
- **F004 — Color tokens declared but unused.** `globals.css:3-13` declares `--background`/`--foreground`/`--color-*`, but 10+ inline hexes in page.tsx. Add `--color-cream: #f4ebd8; --color-carmine: #c1272d; --color-ink: #1a1a1a;` to `@theme`, swap inline hexes for `bg-cream`/`text-carmine`/`text-ink`.
- **F005 — Spacing rhythm ad-hoc.** Mixes `py-8`, `py-16`, `mt-6`, `mt-10`, `mt-12`, `space-y-12`, `mb-6`, `mb-2`, `space-y-4`, `mt-20`, `pt-8`, `mt-1`, `mt-2`, `mt-3`. Pick one rhythm (4/8/12/16/24/48) and stick.

### Medium impact

- **F006 — Alignment inconsistency.** Masthead + week-context center-aligned, day headers + cards left-aligned. `src/app/page.tsx:36` vs `:50`. Recommend left-aligning the week-context line.
- **F007 — Dev-oriented empty state copy.** "Ejecutá `npm run db:seed`..." would ship to prod if DB is empty. `src/app/page.tsx:45-47` — change to user-facing copy, keep dev hint gated on `NODE_ENV !== 'production'`.
- **F008 — Dead `prefers-color-scheme: dark` block in globals.css.** `globals.css:15-20` — delete. Brand is cream, not adaptive.
- **F009 — Transitions don't respect `prefers-reduced-motion`.** Add global rule in globals.css: `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; } }`.
- **F010 — Chain card opacity change isn't animated.** `transition-shadow` only covers shadow; opacity jumps. `src/app/page.tsx:129` — change to `transition-[box-shadow,opacity]`.
- **F011 — Today is visually marked (black bg) but not semantically labeled.** `src/app/page.tsx:33-36` — add `aria-current="date"` on the banner when `day.isToday`, and a visible "HOY" pill inside.
- **F012 — `text-[10px]` borderline WCAG** at standard viewing distance. Used in 5 places. Bump to `text-[11px]` or define an eyebrow token.
- **F013 — Tracking values ad-hoc.** `tracking-[0.3em]`, `tracking-[0.25em]`, `tracking-[0.2em]`, `tracking-widest`, `tracking-wide`. Collapse to 2 tokens (eyebrow = 0.25em, heading = 0.2em).
- **F014 — Card hover shadow duplicates poster shadow.** The poster's `shadow-[4px_4px_0_#c1272d]` is the zine signature; duplicating on card hover dilutes it. `src/app/page.tsx:127` — replace hover with `hover:bg-[#c1272d]/10` or `hover:border-[3px]`.
- **F015 — `opacity-80` on commercial cinema cards reads "broken/loading".** Use `text-neutral-500` + no accent to de-emphasize instead. `src/app/page.tsx:129`.

### Polish

- **F016 — No `text-wrap: balance` on headings.** Add `text-balance` (Tailwind 4) to h1/h2/h3.
- **F017 — No `tabular-nums` on times.** Add `tabular-nums` on the time `<p>`.
- **F018 — No visited-link state.** Add `a:visited { opacity: 0.75 }` scoped to cards in globals.css.
- **F019 — No active/pressed state on cards.** Add `active:translate-y-[1px]` to the tappable card classes.
- **F020 — Images missing `decoding="async"`.** Minor perf polish.
- **F021 — Director meta wraps on mobile with 4 segments.** Hide country on mobile: wrap in `<span className="hidden sm:inline"> · {country}</span>`.
- **F022 — Within-day card gap tight.** `space-y-4` → `space-y-5` or `space-y-6`.
- **F023 — No `<time datetime>` wrapping the time display.** Screen readers + SEO lose machine-readable time. Wrap the `{formatTimeBA(...)}` `<p>` in `<time dateTime={s.startsAtUtc.toISOString()}>...</time>`.
- **F024 — No skip-link, no `aria-current` on today banner.** Basic a11y polish. (Overlaps with F011.)
- **F025 — Raw `<img>` with `eslint-disable`.** Switch to `next/image` for blur-up + format negotiation. You're self-hosting posters already.

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
