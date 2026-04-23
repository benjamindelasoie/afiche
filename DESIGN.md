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
| display-xl (masthead) | clamp(4rem, 12vw, 8rem) | 0.9 | -0.02em | 400 |
| display-lg | 4.5rem | 0.95 | -0.02em | 400 |
| display-md (card title, section) | 2.25rem | 1.1 | -0.01em | 400 |
| display-sm (subtitle, original title) | 1.5rem italic | 1.25 | 0 | 400i |
| time (card time) | 2.5rem italic | 1 | 0 | 400i |
| body-base | 1rem | 1.5 | 0 | 400 |
| body-sm (synopsis) | 0.9rem | 1.55 | 0 | 400 |
| body-xs (metadata) | 0.85rem | 1.55 | 0 | 400 |
| eyebrow | 0.7rem upper | 1.6 | 0.25em | 400 mono |
| card-caps | 0.7rem upper | 1.6 | 0.2em | 500 mono |

Time uses `font-variant-numeric: tabular-nums` everywhere.

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable — between newspaper-dense and web-app-spacious.
- **Scale:** 2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64)

## Layout
- **Approach:** Grid-disciplined list for cards, asymmetric editorial chrome for masthead + dateline + footer.
- **Grid:** Single column on mobile, content max-width 64rem (1024px) on desktop.
- **Border radius:** None on cards + day banners (sharp corners = editorial). 0.5rem optional on image media.
- **Card composition (indie):** time | poster | body (title/subtitle/meta/synopsis) | venue-right
- **Card composition (chain):** time | body (title, compact meta) | venue-right. No poster. Typography de-emphasized (`text-neutral-500` + `border-neutral-300`). Full AA contrast preserved.

## Motion
- **Approach:** Minimal-functional.
- **Allowed:** card hover opacity shift, visited fade (`opacity: 0.75`), focus rings, 1px active-press on cards.
- **Forbidden:** scroll-driven animation, page transitions, entrance choreography.
- **Easing:** ease-out (enter), ease-in (exit).
- **Duration:** micro 50ms, short 150ms max.
- **Accessibility:** `@media (prefers-reduced-motion: reduce)` kills all transitions — wired in `globals.css`.

## Signature Flourishes
- **Carmine offset shadow** on indie cinema posters: `4px 4px 0 var(--color-carmine)`. Non-negotiable — the site's visual fingerprint.
- **Carmine left-bar on indie cards** (`border-l-4 border-carmine`). Curation signal visible at a glance.
- **Carmine left-rule on synopsis** (`border-l-2 border-carmine pl-3`). Subtle echo of the card's left-bar.
- **★ star prefix on indie cinema name**. "This is a curated venue" signal without adding chrome.
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

Page-level flow — **three tiers**:
1. **Masthead** — edition dateline (`Edición Nº N · Semana del X al Y · N funciones · M salas`). Orients: "this is Afiche, this is week N, and these counts are THIS WEEK." Dateline bounds derive from ISO-week bounds of today (`getIsoWeekStartBA(now)` / `getIsoWeekEndBA(now)`) — NOT from data. On Wed when the first screening is Thu, the dateline still says "Semana del 20 al 26 de abril" because we are inside edition 17.
2. **Tier 1 — Esta semana** (decision layer): full cards grouped by day, today's banner anchored with `aria-current="date"`. Query: today 00:00 BA → next ISO Monday 00:00 BA. Lower bound is TODAY'S midnight, not now, so a user on Sunday at 23:00 still sees Sunday's earlier screenings — the cartelera anchors in *today*, not *right now*.
3. **Tier 2 — Este mes** (planning layer): compact cards grouped by day, between next ISO Monday and start of next month. Hidden when the week already crosses the month boundary (late-April case). Section header is `<h2 class="font-serif italic text-4xl md:text-5xl">` inside a double-border frame, with a mono subtitle carrying range + counts.
4. **Tier 3 — Próximamente** (awareness layer): flat chronological text index, one screening per row, no day grouping (each row carries its own date chip). After max(weekEnd, monthEnd), open-ended. Reads like the back-of-zine program guide.
5. **Footer** — editorial signature, close.

Each later tier steps down in density:
- Tier 1 = full card with synopsis + poster at `w-20 h-28` + `border-l-4`
- Tier 2 = compact card, no synopsis, poster at `w-14 h-20`, `border-l-[3px]`, lighter offset shadow (3px)
- Tier 3 = text row, no poster, no card background, hairline separator

The step-down is intentional: the eye should slow down as the horizon gets further. Decisions live in Tier 1.

**First-fold expectations** (intentional):
- Mobile (375×667): masthead + first day banner + first Tier 1 card. Editorial grandeur is worth the scroll; scan order remains legible.
- Desktop (1440×900): masthead + first day banner + 1–2 Tier 1 cards above fold. Full hierarchy visible immediately. Tier 2 + Tier 3 progressively revealed by scroll.

**Sunday-late edge** (explicit product call):
- On Sunday at 23:00 BA, Tier 1 still shows all of Sunday's screenings — including the 18:00 one that's already over. The job is "what's playing today," not "what's still startable."

**Empty states** (in priority order):
- Everything empty (rare — fresh DB): existing `EmptyStateAll` message + dev-only hint.
- Esta semana empty but later tiers have content: editorial copy *"Esta semana las salas descansan."* + pointer `Lo que viene ↓`, with Tier 2/3 rendering below as usual.
- Later tiers empty: just hide those sections. No messaging needed.

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
| **Hover (indie)** | Pointer over card | `bg-carmine/10` (wired). No motion. |
| **Hover (chain)** | Pointer over card | `bg-black/[0.04]` (wired). |
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
- Full card: `border-l-4 border-carmine`, poster thumb + carmine offset shadow, ★-prefixed cinema name, Instrument Serif title, italic original title, Geist synopsis w/ carmine left-rule, full metadata
- Card background: `bg-carmine/5`, hover: `bg-carmine/10`
- Vertical rhythm: `space-y-5` between cards

**Chain cinemas** (Cinépolis, Hoyts, Showcase, etc.):
- Compact card: no poster, no left-bar, no star prefix, body sans-serif, metadata only, full AA contrast kept
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
