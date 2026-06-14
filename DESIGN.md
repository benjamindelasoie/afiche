# Design System — Afiche

## Product Context
- **What this is:** Curated weekly cinema cartelera for Buenos Aires
- **Who it's for:** BA cinephiles scanning "what's playing this week"
- **Space:** Editorial / curated cinema listings
- **Project type:** Single-page web app (Next.js 16 App Router, Tailwind 4, Turso)

## Memorable Thing
> "This feels like a zine someone made with care."

Every subsequent design decision serves this memorable thing.

## Aesthetic Direction
- **Direction:** Editorial zine, Argentine weekly
- **Decoration level:** Intentional (not minimal, not expressive)
- **Mood:** Handmade, editorial, confidently provincial. Página/12 culture section meets Screen Slate meets riso print.
- **Reference peers (positive):** screenslate.com, metrograph.com, mubi.com
- **Explicit counter-examples:** chain cinema sites (multiplex.com.ar), institutional CMS (Lugones website)

## Color
- **Approach:** Restrained. 4 hues, 0 gradients.
- **Cream** `#f6efe2` — background, paper. Refined from legacy `#f4ebd8` (less yellow, more paper-feeling).
- **Carmine** `#c1272d` — accent, offset shadows, time, tag pills, decorative rules
- **Ink** `#1a1a1a` — primary text, titles, borders
- **Ink gray** `#7a6e5a` — secondary text, metadata, de-emphasized content
- **Dark mode:** Explicitly deferred. Cream-only is the signature statement. Most editorial cinema peers (Screen Slate, Metrograph) ship one palette on purpose; inverted surfaces are a SaaS convention borrowed via convention, not a cinema-editorial one. Revisit only if users explicitly request it; treat as v2.

## Typography
- **Display** (masthead, day banners, film titles, time, section headers): **Instrument Serif** — variable, Google Fonts, modern editorial.
- **Body · UI** (prose, metadata, CTAs): **Geist** — workhorse sans, `next/font` wired.
- **Data · micro-caps** (eyebrow, cinema names, tags, tracked labels): **Geist Mono** — `next/font` wired.
- **Loading:** Next.js `next/font/google` with `display: 'swap'` and Georgia as serif fallback. Brief FOUT acceptable; FOIT (invisible text) is worse for a scan-first product. `next/font` auto-generates `size-adjust` on Georgia to minimize layout shift.

### Scale
| Role | Size | Line | Tracking | Weight |
|------|------|------|----------|--------|
| display-xl (masthead) | clamp(3.5rem, 12vw, 8rem) | 0.9 | -0.02em | 400 |
| display-page-title (venue name on /sala/[id]) | clamp(2.5rem, 8vw, 4.5rem) | 0.95 | -0.01em | 400 |
| display-lg (section header: Destacados / Próximamente) | 2.25rem mobile / 3rem md | 1 | 0 | 400i |
| display-md (indie card title) | 1.5rem mobile / 1.875rem sm (text-2xl / text-3xl) | 1.1 | -0.01em | 400 |
| display-sm (subtitle, original title, compact card title) | 1.25rem mobile / 1.5rem sm | 1.25 | 0 | 400i |
| time-xl (time on full indie card) | 2.25rem italic (text-4xl) | 1 | 0 | 400i |
| time-lg (time on compact card + Tier 3 index row) | 1.875rem italic (text-3xl) | 1 | 0 | 400i |
| body-base | 1rem | 1.5 | 0 | 400 |
| body-sm (synopsis) | 0.875rem | 1.55 | 0 | 400 |
| body-xs (metadata) | 0.75rem | 1.55 | 0 | 400 |
| eyebrow | 0.6875rem upper | 1.6 | 0.25em | 400 mono |
| card-caps | 0.6875rem upper | 1.6 | 0.2em | 500 mono |

Scale ranges track what actually renders at 375 / 640 / 768 viewports; desktop takes the upper bound. Earlier revisions of this table claimed 2.25rem for card titles — that was aspirational, never shipped. 1.5rem → 1.875rem reads better at the current card density and leaves the italic serif time as the decisive element.

Time uses `font-variant-numeric: tabular-nums` everywhere.

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable — between newspaper-dense and web-app-spacious.
- **Scale:** 2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64)

## Layout
- **Approach:** Grid-disciplined list for cards, asymmetric editorial chrome for masthead + dateline + footer. Sticky date-strip nav between masthead and content.
- **Grid:** Single column on mobile, content max-width 64rem (1024px) on desktop.
- **Border radius:** None on cards + day banners + date-strip chips (sharp corners = editorial). 0.5rem optional on image media.
- **Card composition (indie):** time | poster | body (title/subtitle/meta/synopsis) | venue-right
- **Card composition (chain):** time | body (title, compact meta) | venue-right. No poster. Typography de-emphasized (`text-neutral-500` + `border-neutral-300`). Full AA contrast preserved.

### Date Strip

Sticky horizontal day-chip nav above the cartelera. Single primitive, 15 cells (14 dated + 1 trailing "Próximamente →"). Lives below the masthead, pins to top via `position: sticky` after the masthead scrolls out — so first-fold real estate isn't taxed by the sticky behavior, only by the strip's intrinsic height (~60px).

**Token table** (the strip's own design tokens — not in `globals.css` `@theme` since they're component-scoped):

| Element | Value |
|---|---|
| Chip min-width | `64px` (DESIGN.md 44px touch-target rule × 1.5) |
| Chip vertical padding | `8px` |
| Chip horizontal gap | `4px` |
| Strip vertical padding | `8px 0` |
| Strip horizontal padding | `0 16px` (chips align with container content edges) |
| Strip background | `var(--color-cream)` — solid, no blur |
| Strip border-bottom | `1px solid var(--color-ink)` |
| Strip negative-margin trick | `margin: 0 -16px` — extends edges to viewport on mobile so chips can horizontal-scroll |
| Active chip bg | `var(--color-carmine)` — the chip whose section is in view |
| Active chip text | `var(--color-cream)` — applies to dow label, day number / "HOY" / "→", and "PRÓX." label |
| Today chip (when not active) | No special fill. "HOY" caps still replace the day number — visual + verbal symmetry with the day-banner HOY pill. Initial paint seeds active=today, so HOY is filled on first load until the user scrolls. |
| Day-of-week label | Geist Mono, `10px`, `letter-spacing: 0.2em` (tracking-card), uppercase, `var(--color-ink-gray)` (carmine on weekend chips) |
| Day number | Instrument Serif, `22px`, `line-height: 1`, `tabular-nums` |
| Próximamente chip | Same shape as date chips. Geist Mono `10px` "PRÓX." caps + serif `→` (Unicode U+2192, NOT a Lucide chevron icon — DESIGN.md is icon-library-free) |
| Edge fade gradient | **Conditional**, 24px cream-to-transparent on each strip edge. Shows ONLY when scroll in that direction is possible: left fade hides at scroll-start, right fade hides at scroll-end. Avoids phantom "more this way" affordances pointing at nothing. Driven by `data-scroll-left` / `data-scroll-right` data-attributes on the wrapper, toggled by a scroll listener + ResizeObserver in DateStrip.tsx. |
| Active-state transition | `transition: background-color 50ms ease-out, color 50ms ease-out` — no transform, no scale, no shadow |
| Touch target min | 44px (chip is 64×~50, well above) |
| Empty-day chip | `opacity: 0.5`, still tappable, anchor-jumps to a banner with editorial empty copy |
| `IntersectionObserver` config | `threshold: 0`, `rootMargin: '-30% 0px -50% 0px'` — "active band" is the 30%-50% upper-middle viewport region |
| Auto-scroll-today on mount | NOT implemented (today is always position 0 in 14-day rolling) |

## Motion
- **Approach:** Minimal-functional.
- **Allowed:** card hover opacity shift, visited fade (`opacity: 0.75`), focus rings, 1px active-press on cards.
- **Forbidden:** scroll-driven animation, page transitions, entrance choreography.
- **Easing:** ease-out (enter), ease-in (exit).
- **Duration:** micro 50ms, short 150ms max.
- **Accessibility:** `@media (prefers-reduced-motion: reduce)` kills all transitions — wired in `globals.css`.

## Signature Flourishes
- **Carmine offset shadow** on indie cinema posters: `4px 4px 0 var(--color-carmine)`, tightening to `2px 2px 0` on hover. Non-negotiable — the site's visual fingerprint. Survived the redesign.
- ~~**Carmine left-bar on indie cards** (`border-l-4 border-carmine`)~~ **RETIRED 2026-06-06/07** (homepage, then `/cartelera`). Replaced by a hover-only carmine left-tick (`before:` 3px bar, `scale-y-0 → 1` on hover) on de-tinted hairline rows. Carmine now lives on the time + the hover tick. See Decisions Log.
- ~~**Carmine left-rule on synopsis**~~ Retired with the card left-bar; synopsis (on `/pelicula` + `/cartelera` cards) no longer carries the carmine rule.
- **Tap feedback** `active:translate-y-[1px]` on cards. 1px downward press emulates a newsprint card flip.
- **`text-balance`** on masthead, day labels, and film titles. Eliminates awkward single-word line endings.
- **`line-clamp-3`** on synopsis. Consistent truncation across variable-length descriptions.
- **Double-border** (`border-double`) on day banners, top + bottom 3px ink.
- **Edition dateline masthead**: `AFICHE` (Instrument Serif display-xl) + mono subline `Edición Nº X · Semana del DD al DD de MMMM de YYYY · N funciones · N salas` + italic serif tagline `Cartelera curada de Buenos Aires`. Edition number is the ISO-8601 week of the year (`date-fns/getISOWeek`), year-resettable.
- **Tracked micro-caps** (Geist Mono, 0.25em tracking, uppercase) for all labels, cinema names, tags, metadata fields, eyebrow text.
- **Italic serif time** — each card's time in Instrument Serif italic, carmine, tabular-nums, card's largest element. Followed by small Mono day abbreviation.

## Voice + Tone
- **Language:** Spanish-native (es-AR). UI copy never falls back to English.
- **Editorial details:** proper Spanish quotation marks «...», em-dashes for mid-sentence breaks, Spanish-native UI copy (*"Edición Nº 04"*, *"Semana del…"*, *"Cartelera curada"*, *"hecho por cinéfilos, para cinéfilos"*).
- **Posture:** Confident cinephile. Opinionated without pretension. *"Curamos"* (we curate), not *"agregamos"* (we aggregate).
- **Forbidden:** marketing-speak, "Get Started"-style CTAs, generic SaaS copy, feature grid framing, "Built for X" patterns.

## Accessibility Baseline
- Skip link (visible on focus, fixed position) — wired
- `aria-current="date"` on today's day banner
- `aria-label` on screening-card anchors (`{title} — {cinema} — {time}`)
- `<p class="sr-only">` with full edition dateline for screen readers (visible version abbreviates); both derived from the same compute (single source of truth)
- `prefers-reduced-motion: reduce` guard — wired
- `<time dateTime={...}>` semantic element for times
- `font-variant-numeric: tabular-nums` on time
- Focus rings: 2px solid carmine (indie) or black (chain), offset 2px, `focus-visible` only
- Color contrast (AAA-target where possible):
  - ink `#1a1a1a` on cream `#f6efe2` = 13.4:1 (AAA)
  - ink-gray `#7a6e5a` on cream `#f6efe2` = 4.8:1 (AA normal text)
  - carmine `#c1272d` on cream = 5.8:1 (AA normal, AAA large)

## Information Hierarchy

Scan order within a card (eye tracking):
1. **Time** (italic carmine serif, largest) — the "when" is the primary decision.
2. **Poster** (indie only, carmine-shadow) — visual anchor for "what kind of film?"
3. **Film title** (Instrument Serif display) — the "what."
4. **Original title** (italic subtitle) — disambiguates for cinephiles.
5. **Metadata** (director · year · country · runtime) — context in one grey line.
6. **Synopsis** (Geist, carmine left-rule) — why this film, not the others today.
7. **Cinema name** (right-aligned tracked Mono, carmine on indie) — the "where."

Page-level flow — **2 tiers + sticky date-strip nav** (consolidated 2026-05-02; see Decisions Log):

1. **Masthead** — edition dateline (`Edición Nº N · Semana del X al Y`). Orients: "this is Afiche, this is week N." Dateline bounds derive from ISO-week bounds of today (`getIsoWeekStartBA(now)` / `getIsoWeekEndBA(now)`) — NOT from data, NOT from the cartelera content shown below. The masthead is *flavor* (publication-cadence, editorial voice); the cartelera below is the *information surface*. The two are decoupled by design — the masthead can carry the editorial weekly conceit while the cartelera shows whatever is most useful to navigate.
2. **Date strip** (wayfinding layer, sticky below masthead): horizontal row of 14 day chips (today + 13) plus 1 trailing "Próximamente →" chip when there's content beyond day 14. Today is always position 0; first paint seeds the active chip to today so HOY is carmine-filled on load. Anchor-jumps (`#dia-${dateKey}`) take the user to the day's `<h2>` banner with `scroll-margin-top: 60px` to clear the sticky strip. As the user scrolls, IntersectionObserver moves the carmine fill (cream text on carmine bg) to the chip whose section is in the upper-middle viewport band — "you are here." The fill is the only scroll-spy affordance. Implementation: `src/app/_components/DateStrip.tsx`.
3. **Tier 1 — 14-day rolling window** (decision/planning combined): full cards grouped by day, today's banner anchored with `aria-current="date"` and `id="dia-${dateKey}"` for chip-jump targets. Query: today 00:00 BA → today+14 00:00 BA (always 14 days, regardless of weekday). Lower bound is TODAY'S midnight, not now, so a user on Sunday at 23:00 still sees Sunday's earlier screenings — the cartelera anchors in *today*, not *right now*. Empty single days (zero screenings) render the banner anyway with editorial copy *"Las salas descansan."*
4. **Tier 2 — Próximamente** (awareness layer): text index, **week-grouped**. One banner per ISO week (`Semana del 19 al 25 de mayo`) + chronological rows. Open-ended upper bound starting at today+14. Reachable via the strip's trailing chip. Reads like the back-of-zine weekly-edition preview.
5. **Footer** — editorial signature, close.

Density gradient between tiers:
- Tier 1 = full card with synopsis + poster at `w-20 h-28` + `border-l-4`
- Tier 2 = text row, no poster, no card background, hairline separator + per-week banner

The step-down is intentional: the 14-day Tier 1 is decision territory (where users tap chips and pick films); Próximamente is awareness territory (where users glance at "what's coming weeks out"). The retired Tier-2 compact-card density that used to sit between them was a metaphor argument ("planning layer") that no longer earned its UX cost once the strip turned scroll-skim into one-tap jump.

**First-fold expectations** (intentional):
- Mobile (375×667): masthead + sticky date strip + first day banner + first Tier 1 card. The strip lives in normal flow on first paint (under the masthead) and only pins to the top once the user scrolls past the masthead; this preserves real estate for content above the fold.
- Desktop (1440×900): masthead + strip + first day banner + 1–2 Tier 1 cards above fold. Full hierarchy visible immediately. Próximamente progressively revealed by scroll.

**Sunday-late edge** (explicit product call):
- On Sunday at 23:00 BA, today's chip + Tier 1 still show all of Sunday's screenings — including the 18:00 one that's already over. The chip count includes past-today screenings too. The job is "what's playing today," not "what's still startable."

**Empty states** (in priority order):
- Everything empty (rare — fresh DB): existing `EmptyStateAll` message + dev-only hint. Strip hides.
- 14-day window empty but Próximamente has content: editorial copy *"Esta quincena las salas descansan."* + pointer `Lo que viene ↓`. Strip renders all 14 chips muted (50% opacity) but the trailing Próximamente chip stays active.
- Single day in the window empty: banner renders with `0 funciones` + italic *"Las salas descansan."* The chip on the strip is muted to 50% opacity but still tappable.

## Interaction States

| State | When | Spec |
|---|---|---|
| **Default** | Data loads, screenings present | Full card hierarchy per Information Hierarchy above |
| **Empty (expected)** | No screenings in the next 7 days | Editorial copy: *"La cartelera se actualiza todas las madrugadas. Volvé en unas horas."* Neutral grey, italic. No call-to-action. Trust the user. |
| **Zero-all-week** | Legitimately empty week (festival hiatus, holiday period) | Different copy: *"Esta semana las salas descansan. Volvé la próxima."* — softer, still editorial |
| **Error** | Scraper failed, DB unavailable | Copy: *"La cartelera está rehaciéndose. Intentá de nuevo en unos minutos."* — action hint. Only in prod; dev shows stack trace. |
| **Partial card — no synopsis** | Film with title + metadata but no blurb | Card renders without synopsis block. Do not show placeholder text. Density naturally compresses. |
| **Partial card — no director / year / runtime** | Very incomplete metadata | Skip the metadata line entirely rather than render dangling punctuation (`· · ·`). If ONLY title + cinema + time available, that's still a valid card. |
| **Partial card — no poster (indie)** | Indie cinema, film not matched on TMDB, no custom poster | Typographic fallback (implemented in `page.tsx`): `<span class="italic text-center">{title}</span>` inside the poster tile, black bg + cream text. Carmine offset shadow still applies. |
| **Font loading flash** | Instrument Serif hasn't loaded yet | `font-display: swap` with Georgia as serif fallback. Brief FOUT acceptable; FOIT (invisible text) is worse. No layout shift — `next/font` auto-generates size-adjust. |
| **Visited card** | User has tapped through | `opacity: 0.75` via `a[data-screening-card]:visited` (wired). Persistent across sessions. |
| **Hover (row)** | Pointer over a film / screening row | `bg-black/[0.025]` + carmine left-tick (`before:` 3px bar, `scale-y-0 → 1`, 150ms) + poster shadow 4→2px. Replaced the `bg-carmine/10` fill (2026-06-06/07). |
| **Active tap** | Card pressed | `translate-y-[1px]` (wired). Newsprint-press feedback. |
| **Focus (keyboard)** | Tab navigation | `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-carmine` (indie) or `outline-black` (chain). Wired. |

## Responsive Strategy

| Viewport | Layout |
|---|---|
| **Mobile 375–639px** | Single column. Cards render as horizontal flex: poster-left + body-right (density-preserving; the earlier "poster-above-body" spec was superseded by the actual layout on 2026-04-22). Cinema address line `hidden sm:inline`. Masthead: 64px (`text-6xl` baseline). Container padding: `px-4 py-8`. Tier 3 rows wrap to 2 lines on mobile (date+time+title row, cinema row). |
| **Tablet 640–767px** | Single-column list, cards go to horizontal flex: time-poster-body-venue left-to-right. Cinema address visible. Masthead: 72px (`text-7xl`). Container padding: `sm:px-6`. |
| **Desktop 768–1023px** | Same horizontal card layout, wider body column. Content max-width engages. Masthead: 96px (`text-8xl`). Container padding: `md:py-16`. |
| **Large 1024px+** | `max-w-5xl mx-auto` clamp — content doesn't widen further. Generous side margins for editorial breathing room. |

**Touch targets** — minimum 44px for all tappable elements (satisfied by card padding `p-4 sm:p-5` + full-card anchor).

## Chain vs Indie Distinction
The curation stance is made visible through typography and density, not through a hidden/visible toggle. Both appear on the site; indie wins visual weight.

**Indie cinemas** (Lugones, MALBA, Lumiton, Cine York, Centro Cultural Munro):
- De-tinted hairline row (no card fill, no left-bar; `border-b border-black/10`, `last:border-b-0`), poster thumb + carmine offset shadow (hover tightens 4→2px), Instrument Serif title, italic original title, Geist synopsis (no left-rule), full metadata
- Hover: `bg-black/[0.025]` + carmine left-tick (`before:` scale-y 0→1)
- Vertical rhythm: rows stack flush, separated by hairlines (no inter-card gap)

**Chain cinemas** (Cinépolis, Hoyts, Showcase, etc.):
- Compact card: no poster, no left-bar, body sans-serif, metadata only, full AA contrast kept
- Card styling: `border-neutral-300 bg-black/[0.02] text-neutral-500`, hover: `bg-black/[0.04]`
- Vertical rhythm: same `space-y-5` (rhythm is consistent, distinction is typographic)

**Special events at chain venues** (e.g. BAFICI at Cinépolis): still chain-styled by default. The `ciclo` / `festival` tag in the card's top strip provides the curation signal. Do NOT promote to indie-styled card based on tag alone — the chain's operational character doesn't change.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-22 | Initial DESIGN.md created by /design-consultation | Formalized existing zine aesthetic before scope expansion (film detail + cinema pages) |
| 2026-04-22 | Instrument Serif added as display family | No peer site uses this family; gives Afiche distinct editorial typographic voice. Metrograph + Screen Slate use serif display — serif is category-appropriate, Instrument Serif is the differentiator. |
| 2026-04-22 | Cream refined from `#f4ebd8` → `#f6efe2` | Less yellow, more paper-feeling. Aligns with zine-riso reference. |
| 2026-04-22 | Edition Nº computed from ISO-8601 week of year (`date-fns/getISOWeek`) | Auto, year-resettable, no manual maintenance. Adds to the "weekly print edition" illusion without operational burden. |
| 2026-04-22 | Dark mode explicitly deferred | Cream-only is a signature statement. Cinema-editorial peers ship one palette on purpose; dark mode is a SaaS convention. Revisit only if users ask. |
| 2026-04-22 | Instrument Serif loads with `display: swap` + Georgia fallback | FOIT is worse than FOUT for a scan-first product. Georgia's x-height matches closely enough to minimize layout shift. |
| 2026-04-22 | Chain vs indie uses neutral-500 + light border, not opacity 0.82 | Existing page.tsx treatment already correct — preserves AA contrast. |
| 2026-04-22 | Spanish-first editorial voice locked | Differentiates from MUBI/Screen Slate/Metrograph (all English-native). Proper Spanish punctuation («», em-dashes) is free signature. |
| 2026-04-22 | Special events at chain venues stay chain-styled | Operational character doesn't change with a festival tag. The `ciclo` / `festival` tag in the card strip provides the curation signal. |
| 2026-04-22 | ScreeningCard component extraction deferred to next cycle | Second consumer (film detail + cinema pages) needed to justify the abstraction. Right-sized diff preserved for this cycle. |
| 2026-04-22 | Three-tier view: esta semana / este mes / próximamente | The earlier single-stream list labelled a 34-day Lugones cycle as "Semana del 23 de abril al 27 de mayo" — edition number (ISO week) and content didn't match. Split into tiers so the "Edición Nº N" metaphor holds (tier 1 IS the edition) and the longer horizon gets progressively de-emphasized. The three-tier weight ladder (full → compact → text index) is the structural carrier of the zine hierarchy. |
| 2026-04-22 | "This week" query lower bound is today 00:00 BA, not now | Sunday at 23:00 BA still shows Sunday's programming. The job is "what's playing today," not "what's still startable." |
| 2026-04-22 | Edition dateline anchors on ISO-week bounds regardless of data | Previously derived from min/max of returned screenings; broke coherence when data spanned multiple weeks. Now `Semana del 20 al 26 de abril` holds even on Wednesday when the first scheduled screening is Thursday — we're inside edition 17 independent of what's in the DB. |
| 2026-04-22 | Tier 3 (Próximamente) drops day grouping | At that horizon each row carries its own date chip — day banners would just add visual chatter. The index format echoes a zine's back-page program guide. |
| 2026-04-22 | Esta mes section hides when week crosses month boundary | Late-April users (Tue Apr 28 → week ends May 4) have an empty "rest of April" — surfacing an empty section would add noise without value. |
| 2026-04-22 | ★ star prefix on indie cinema names dropped (commit `aca2dde`, F-005 fix) | Universal-noise signal in an all-indie cartelera; the curation contrast that justified ★ disappeared when chain content was deferred behind Cloudflare. Carmine left-bar + carmine cinema-name color carry the curation signal alone. |
| 2026-04-25 | ProgramPill on cards via `screenings.program_name` text column | New curatorial signal surfaces the program/cycle name (e.g., "Retrospectiva David Lynch") on cards from venues that organize screenings into curated programs. Cosmos and similar single-film venues stay program-less. Pill placed in the existing tag strip, font-mono carmine bg. |
| 2026-04-25 | Mobile synopsis hidden via `hidden md:block` | The `line-clamp-3` synopsis with bottom fade renders as ~2.5 trailing-off lines on 375px mobile — text doing the work of decoration. Hiding on mobile reclaims ~80px of card real estate per indie card without losing the signal on desktop. |
| 2026-05-02 | Homepage navigation: 14-day rolling date strip + 2-tier consolidation | Replaces the 3-tier model (Esta semana / Próxima semana / Más adelante) with 2 tiers (1-14 days as full cards reachable via a sticky horizontal date strip + Próximamente as week-grouped text index). Strip has 14 day chips + 1 "Próximamente →" chip; today permanently carmine; active chip on scroll via IntersectionObserver. Justification: the dominant cartelera intent is exploratory ("what's on next-Wednesday?") not targeted; the strip turns a 50-card scroll into one-tap navigation. Compact-card variant for week 2 retired (no longer earned its keep once strip-jump replaced scroll-skim). |
| 2026-05-02 | Editorial conceit demoted from veto to flavor | Earlier draft justified `strip horizon = this ISO week only` with "preserves the Edición metaphor" — a metaphor argument vetoing a UX choice. User flagged the category mistake explicitly. New posture: the editorial / zine / Edición concept is FLAVOR (drives type, palette, voice, masthead) and does NOT veto user-friendly behavioral decisions. Concrete outcomes: strip is 14-day rolling not ISO-week-bounded; masthead retains "Edición Nº · Semana del X al Y" anchored to ISO week (decorative, decoupled from cartelera content); week-2 compact-card density retired; dark mode planned for near future (no longer "deferred forever"). |
| 2026-05-25 | Venue page (/sala/[id]) = date-rail AGENDA, not the homepage card stack | A single-screen venue has no screening overlap, so the week renders as a chronological agenda: per-day left rail (dow caps + large serif day number) + screening rows (italic carmine serif time + 44×62 carmine-shadow poster + serif title + meta). Dark days are skipped entirely (no "las salas descansan" filler), exploiting the low volume. Drops the bordered-card chrome + the sticky date strip (sparse weeks make 11+ muted chips look desolate). Chosen over a calendar grid: the 7-col grid breaks at 375px and can't show posters; the agenda is one responsive layout. New `VenueAgenda` component; `ScreeningCard`/`DaySection` not reused here. Ciclos-en-curso block (tappable, anchor-jumps to the program's first agenda entry) is the page's wayfinding. /plan-design-review 5→9. |
| 2026-05-25 | Film-page row → Hybrid stretched-link | `/pelicula/[slug]` rows: the whole row stays the big ticketing tap-target, with the cinema name as a higher-z `/sala` link on top (same stretched-link pattern the homepage card uses for film links, no nested `<a>`). Keeps the ticketing target while making venues navigable. Replaces an earlier split that shrank the ticket target to a small "Entradas →" link. |
| 2026-05-17 | Date strip: carmine fill moves with scroll, not pinned to today | Old model encoded TWO facts on the strip (today = permanent carmine fill, scroll-position = thin carmine underline). The fill always won the eyeball at quick-glance distance, so users reported thinking they were always viewing HOY regardless of scroll. Collapsed to one signal: the carmine fill IS the scroll-spy affordance. Bootstrap: first-paint seeds active=today so HOY is filled on initial load until the user scrolls. Today is no longer special-cased visually — "HOY" caps still replace the day number (verbal symmetry with the day-banner HOY pill), but the chip renders carmine only when it's the active section. Underline removed entirely. Triggered by a user reporting the exact confusion that was anticipated when the dual-signal model was first specced. |
| 2026-06-06 | Homepage redesign: window-scoped GROUP-BY-FILM; day-view relocated to /cartelera | The homepage (`/`) becomes one row per FILM (not per showtime) for a selected window (`?ventana=hoy|finde|semana|prox`, default `hoy`), via a sticky `WindowNav` (pills + "Ver todo →"). Prod data: 64% single-showtime, 95% single-venue, so the common row is one clean `time · venue`; the heavy tail (11-25 showtimes) collapses behind a tap-expand `ShowtimesDisclosure`. The old 14-day day-grouped view (DateStrip + DaySection) is MOVED verbatim to `/cartelera` ("Ver todo"); `DateStrip` and the "2 tiers + sticky date strip" model above now describe `/cartelera`, not `/`. Deliberate exceptions to the rules above: homepage desktop widens to `max-w-6xl` (vs the `max-w-5xl` Responsive-table clamp) for the full-width curated hero band + 2-col film grid (`/cartelera` stays `max-w-5xl`); per-row carmine left-bar and `bg-carmine/5` card tint retired (carmine now lives on the time + a hover left-tick); no synopsis in the list (stays on `/pelicula`). GitHub issue #17; locked variant E. |
| 2026-06-07 | Curated band: header "Esta semana" → "Destacados"; posters un-cropped to 2:3 | Two fixes to `CuratedBand`. (1) Header renamed from "Esta semana" to "Destacados" (section + `aria-label`). The band is a stable weekly curated selection — `getFeaturedFilms()` is hardcoded to the `semana` window regardless of the active `WindowNav` pill — so echoing the selector would misrepresent always-this-week content, and "Esta semana" literally duplicated the `semana` pill's label (two same-named things meaning different things on one page). "Destacados" names the band's purpose (editorial highlights), aligning with the "Curamos, not agregamos" voice. (2) Poster tiles re-ratioed `aspect-[3/4]` → `aspect-[2/3]` (and `<Image>`/fallback dims 232×310 → 232×348) to match native TMDB poster geometry (2:3); the old 3:4 box + `object-cover` cropped ~10% off the top and bottom of every poster. |
| 2026-06-07 | `/cartelera` aligned to the homepage design (secondary-view) | `/cartelera` now reads as a secondary view of `/`, not its own look. Shared `Masthead` component (split: wordmark hard-left + edition right-aligned, hairline rule under) used by both — on `/cartelera` the wordmark links home. The day-grouped `ScreeningCard` was de-tinted to match the homepage `FilmRow`: dropped `bg-carmine/5` fill + `border-l-4 border-carmine` left-bar + the synopsis carmine left-rule; now de-tinted hairline rows (`border-b border-black/10`, `last:border-b-0`, flush, no inter-card gap) with the hover carmine left-tick + poster shadow 4→2px. The carmine offset-shadow poster (the fingerprint) stays. So the carmine left-bar + `bg-carmine/5` tint are now retired EVERYWHERE (homepage + `/cartelera`). `/cartelera` keeps its purpose (exhaustive day-by-day + DateStrip + Próximamente) and its `max-w-5xl` single-column width; only the visual language aligns. |
| 2026-06-07 | `/sala/[id]` visual language aligned (the `bg-carmine/5` straggler) | The venue page kept the retired `bg-carmine/5` hover tint in two spots the `/cartelera` pass didn't reach: `VenueAgenda` screening rows and the Próximamente index rows. Both moved onto the canonical row hover — `hover:bg-black/[0.025]` + the carmine 3px left-tick (`before:` `scale-y-0 → 1`, 150ms) + (agenda only, which has a poster) poster offset-shadow tightening 4→2px with the 1px press. The agenda left-tick sits in the date-rail gutter (`before:-left-1.5`) since the row has no left padding to host it. So `bg-carmine/5` is now retired on `/sala` too — the "retired EVERYWHERE" claim above is finally literally true. STRUCTURE deliberately unchanged: the date-rail agenda (DESIGN.md 2026-05-25) and the absence of a sticky DateStrip stay; the venue name remains the `display-page-title` hero (no shared Masthead — the edition stats are whole-cartelera and off-topic on one venue). Deeper venue redesign opportunities (desktop-uses-the-width, group-by-film duplication check, window-scoped front door) deferred to TODOS.md #34. |
| 2026-06-07 | Masthead wordmark → lowercase logotype `afiche` | The wordmark (the `display-xl` masthead token: `clamp(3.5rem,12vw,8rem)`, Instrument Serif, `-0.02em`) renders lowercase `afiche` instead of `Afiche`. Rationale: it reads quieter and more editorial — matches the "Curamos, no agregamos" / confident-without-pretension voice — and leans into `afiche` being a common noun (poster), which suits the non-commercial donation ethos and sharpens the indie contrast against caps-shouting commercial cinema. KEY DISTINCTION: lowercase is the **logotype** only; the **name** stays "Afiche" everywhere it's prose, not logo — the `Masthead` `aria-label="Afiche — inicio"`, the metadata `title` / og:title, and the JSON-LD. Tracking kept at `-0.02em` (read fine lowercase). Wordmark-bearing brand assets NOT yet aligned: the OG share image (`src/app/opengraph-image.png`, still a capital-A card) and the favicon (`src/app/icon.svg`, a capital-"A" monogram) — both open follow-ups if/when the lowercase logotype sticks. Admin-panel labels ("Admin · Afiche") stay capitalized (name in prose, internal surface). |
| 2026-06-13 | `/sala/[id]` desktop "uses the width": sticky identity rail + scrolling schedule | TODO #34a. The venue page was a single `max-w-5xl` column on every viewport — the 2026-06-03 audit flagged it "tolerates the width rather than using it." Now a two-column layout at `max-w-6xl`: a **sticky left identity rail** (`<aside lg:sticky lg:top-6 lg:self-start>` — back-link, venue name, address, Sitio oficial, `VenueAbout`, `Ciclos en curso`, and the weekly-run view toggle) beside the scrolling agenda/runs (`lg:grid lg:grid-cols-[20rem_1fr]`). Collapses to the existing single column below `lg` (rail stacks above the schedule) — ONE responsive layout, no calendar grid (DESIGN.md 2026-05-25 honesty preserved; days never reorder). Rail is **inlined in `page.tsx`**, not a `<VenueRail>` component (its data is all in scope; a child would only prop-drill for one consumer). Approved via `/design-shotgun` Variant A «Programa de mano» over a wide-single-column and a poster-marquee variant. **Toggle moved into the rail** — supersedes the 2026-06-09 "toggle inside `#cartelera`" placement (it's a venue-level control). **F3 fixed:** agenda poster steps to 80×112 at `lg` (Tier-1 spec) with the `next/image` `sizes` hint tracking it; mobile/`sm` density untouched. **`bg-carmine/5` fully retired (claim now literally true).** The 2026-06-07 "retired EVERYWHERE" claim was inaccurate — `CiclosEnCurso`, plus the `/cartelera` Próximamente rows and the `/pelicula` screening rows, still carried the pink hover wash. All three moved to the canonical de-tint (`hover:bg-black/[0.025]` + carmine `before:` left-tick); a `layout-invariants.test.ts` invariant now fails if any `src/app/**.tsx` reintroduces `bg-carmine/5`. Pure layout: no schema/query/data. Eng review CLEARED (4 findings folded), codex gate 8/10. |
| 2026-06-09 | `/sala/[id]` gains a second shape: `weekly-run` (film-first) for fixed-weekly venues | Two venue-page shapes now, keyed on an explicit `WEEKLY_RUN_CINEMAS` set (`src/lib/venue-agenda-style.ts` — `{lorca, cine-cosmos}` today, NOT a data-ratio threshold, so a venue's layout never flips on an unusual week). **Repertory/program venues** (MALBA, Lugones, …) keep the chronological **date-rail `VenueAgenda`** (DESIGN.md 2026-05-25) as default. **Fixed-weekly commercial venues** (Lorca, Cosmos — same films, same showtimes every day) default to the new **`VenueRuns`** (`Variant B`): film-first, one block per film = poster · serif title · `director·year·runtime` · a `días` label (uppercase mono eyebrow, e.g. `MARTES Y MIÉRCOLES`) + date range · carmine serif-italic showtimes. A non-uniform film (rare; defensive) stays ONE block with a line per time-signature — never a separate section. Grounded in prod data (Lorca redundancy ratio 6.0 vs ~1.0 repertory; `scripts/ia-stats.ts`). **Deliberate hierarchy inversion:** the homepage ranks Time #1, but the run block is a *navigational summary* into `/pelicula`, so the title leads and the carmine times are the secondary anchor. **Toggle:** weekly-run venues open on `Por película`; `?vista=dia` reveals the chronological agenda; segmented `<nav aria-label="Vista de cartelera">`, active pill **carmine-fill** (reuses the DateStrip "you are here" signal), ≥44px hit area, `aria-current`. **Within-day collapse:** the chronological `VenueAgenda` now collapses same-film-same-day showtimes into one row (time-chips, no per-row `.ics`); single-showtime films are untouched, so repertory venues render exactly as before. The run block drops `.ics` (acknowledged cost; per-screening `.ics` lives on `/pelicula`). New `VenueRuns` + `screening-runs.ts` grouping; `VenueAgenda`/`AgendaRow` single-showtime path unchanged. /plan-design-review 7→9 (codex + Claude subagent killed an earlier two-grammar `Otras funciones` fallback). See TODOS.md #34(b). |
