# Changelog

All notable changes to Afiche are documented here.

## [0.3.5.0] - 2026-06-09

### Added

- **Weekly-run venue display for fixed-weekly cinemas (`/sala/[id]`).** Cines that play the same films at the same showtimes every day (Cine Lorca, Cine Cosmos) no longer render a film as a wall of near-identical per-showtime rows. They now default to a **film-first** layout: one block per film with the poster, title, a `días` label derived from the actual weekdays (`Martes y miércoles` / `Todos los días` / `De lunes a viernes`), a date range, and the daily showtimes as carmine times. A `Por película / Por día` toggle (`?vista=dia`) reveals the classic chronological date-rail. Program/repertory venues (MALBA, Lugones, …) are unchanged — the shape is chosen by an explicit per-venue set (`src/lib/venue-agenda-style.ts`), not a heuristic. New pure grouping module `src/lib/screening-runs.ts` (uniform/non-uniform time-signatures, trasnoche-aware ordering) + `VenueRuns` component; the chronological view gained a within-day collapse (same-film-same-day showtimes merge to time-chips) scoped to weekly-run venues so repertory pages render byte-identical. Grounded in per-venue prod data (`scripts/ia-stats.ts`); design-reviewed (7→9) and code-reviewed (codex + Claude). TODO #34(b).

## [0.3.4.9] - 2026-06-08

### Added

- **Home-screen app icon (Add to Home Screen).** Afiche can now be added to an iPhone/Android home screen and shows a real icon: the cream lowercase `a` (the Instrument Serif wordmark letterform) on a full-bleed carmine field, launching fullscreen like an app. New `src/app/apple-icon.png` (180×180 → `apple-touch-icon`), a web manifest (`src/app/manifest.ts`, `display: standalone`, cream theme, 192/512 + maskable icons in `public/`), and `appleWebApp` metadata (short `"Afiche"` label so it doesn't truncate under the icon). The glyph uses real Instrument Serif — not the SVG favicon's Times fallback (SVG favicons can't load web fonts; a rasterized PNG can), so it matches the masthead wordmark exactly. Reproducible via `scripts/build-app-icons.sh` (sibling of `build-og-image.sh`). Brand strings (`SITE_NAME`/`SITE_TITLE`/`SITE_DESCRIPTION`) centralized in `src/lib/site.ts` so the page metadata and manifest can't drift. A real logo/brand mark (beyond the wordmark monogram) is captured as TODO #36.

## [0.3.4.8] - 2026-06-08

### Fixed

- **Lugones cycles that include a double-bill day are no longer dropped.** The v0.3.4.7 festival guard was too blunt — it skipped a whole Lugones page if it contained *any* multi-short "program" marker, which wrongly dropped legit cycles like "Tres tardes con Gardel" (two normal single-film days + one double-bill). The skip is now **per-block**: the parser keeps the normal single-film days and skips only the multi-short program blocks (those marked "Duración total del programa" — e.g. every block of Syncro Film Fest). A standalone `+` is also never mistaken for a film title.

## [0.3.4.7] - 2026-06-08

### Fixed

- **Sala Lugones film festivals no longer pollute the cartelera with garbage entries.** A festival-of-shorts page (e.g. "Syncro Film Fest") groups many short films into single timed "program" blocks — a structure the Lugones parser couldn't represent, so it emitted ~10 poster-less fake "films" named after the blocks ("Programa de apertura", "Competencia Internacional – Programa 1") with mismatched directors. The parser now detects this format (the standalone `+` short-separators) and skips the page with a logged warning instead of emitting bad data. Lugones programming is recurrently ad-hoc, so this is a *tolerance* guard — when a page is a structure it can't faithfully represent, it skips gracefully rather than chasing every one-off festival layout.

## [0.3.4.6] - 2026-06-07

### Added

- **Automated, scheduled prod scrape (macOS).** `scripts/scrape-cron.sh` + `scripts/install-scrape-launchd.sh` install a LaunchAgent that runs the scrape twice a day from the dev machine — it has to run from a residential IP, since datacenter IPs get blocked by the venues' Cloudflare. It catches up when the Mac wakes from sleep, skips if the data is already fresh (<12h), logs to `.scrape-cron.log`, and on failure fires a macOS notification plus an optional Telegram message (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` in `.env.prod`). No user-facing change — it keeps the cartelera current without anyone remembering to run the scrape by hand.

## [0.3.4.5] - 2026-06-07

### Fixed

- **The production data refresh now actually revalidates the live site.** The `scrape:prod` step POSTed its cache-revalidation request to the old `afiche.vercel.app` host, which 307-redirects to `afiche.ar` — and because the request didn't follow the redirect, the revalidation silently did nothing (while still printing "✓ Cache revalidated"). Pointed it at the apex `afiche.ar` so the call hits the handler directly. Harmless for the homepage and listings (always server-rendered fresh from the DB), but it matters for any cached route and removes a lie from the scrape output.

## [0.3.4.4] - 2026-06-07

### Fixed

- **Canonical links now resolve to `afiche.ar`, not the old `afiche.vercel.app`.** The social share image, the structured-data (JSON-LD) image, and the calendar (`.ics`) event links all still pointed at the pre-cutover Vercel host — which only 307-redirected to `afiche.ar`, so a strict link unfurler could miss the share preview. They now build from a single canonical `SITE_URL` (`src/lib/site.ts`); the host is defined in one place and can't drift across files again (which is how it broke).

### Changed

- **The "SIN AFICHE" fallback poster now shows a lowercase `a`**, matching the lowercase wordmark and favicon.

## [0.3.4.3] - 2026-06-07

### Changed

- **The social share card and the favicon now match the lowercase wordmark.** When an afiche.ar link is shared, the preview image reads `afiche`; the browser-tab icon is a lowercase `a` — both consistent with the masthead. The README was also refreshed to the current branding (lowercase title, the live `afiche.ar` link, the "Destacados" band name).

## [0.3.4.2] - 2026-06-07

### Changed

- **The masthead wordmark is now lowercase — `afiche`.** A quieter, more editorial logotype that leans into "afiche" being the everyday word for a poster. The name is still "Afiche" everywhere it's written as a name (the browser tab title, social share text, accessibility label) — only the logo itself is lowercase.

## [0.3.4.1] - 2026-06-07

### Changed

- **Switching time windows on the homepage is snappier.** The homepage is server-rendered per window, so every `Hoy / Este finde / Esta semana / Próximamente` switch was a full server round-trip — even re-selecting a window you'd just viewed. The four windows now prefetch in the background on load, and their payloads are reused from the browser's router cache for a few minutes, so the first switch is instant and re-clicks don't refetch. Full page loads stay server-rendered fresh, so the listings are unaffected. (Prefetching only kicks in on the deployed site, not local `next dev`.)

## [0.3.4.0] - 2026-06-07

### Changed

- **The homepage "Esta semana" band is now "Destacados".** The band is a stable weekly curated selection — it doesn't change when you switch the Hoy / Este finde / Esta semana / Próximamente filter. So its old "Esta semana" title misrepresented that (the content is always the week's picks) and collided with the selector pill of the same name — two different things wearing one label. "Destacados" names what the band actually is: the editorial highlights.
- **Curated band posters now show the full artwork.** The poster tiles were a 3:4 box holding 2:3 posters, so the image was scaled up to fill and roughly the top and bottom 10% of every poster got cropped off. The tiles are now 2:3, matching the artwork — full posters, nothing clipped.
- **The venue page (`/sala`) now matches the homepage's visual language.** Its screening rows and the "Próximamente" index dropped their last carmine row-tint for the same hover the homepage uses: a carmine left-tick that wipes in, a faint row shade, and the poster's offset-shadow tightening on hover. Nothing structural changed — the date-rail agenda stays.
- **The venue header is cleaner.** Dropped the "Cine independiente" tag and the neighborhood line (the address already answers "where", and you already know which venue you're on). The venue name leads, the address sits just under it, and "Sitio oficial" moves to the top-right on desktop (stacked below on mobile).

## [0.3.3.0] - 2026-06-07

### Changed

- **`/cartelera` now reads as a secondary view of the homepage** instead of carrying its own look. The two pages share one `Masthead` component (split layout: wordmark hard-left, edition right-aligned, hairline rule under) — on `/cartelera` the wordmark links home. The day-grouped cards are de-tinted to match the homepage rows: dropped the `bg-carmine/5` fill, the `border-l-4 border-carmine` left-bar, and the synopsis carmine left-rule; they're now de-tinted hairline rows (flush, hairline separators) with the same hover carmine left-tick and the carmine offset-shadow poster (tightening 4→2px on hover). The carmine left-bar + card tint are now retired everywhere. `/cartelera` keeps its job (exhaustive day-by-day with the date strip + Próximamente) and its single-column width — only the visual language aligns.

### Fixed

- **The homepage no longer shows films whose every showtime has already passed.** The group-by-film view sank fully-expired films to the bottom (struck) instead of dropping them — so late at night "Hoy" became a wall of struck cards (37 films, 0 catchable at 23:59 BA). `getWindowScreeningsByFilm` now drops any film with no catchable showtime left in the window (`nextCatchableUtc === null`), matching the "what can I still see?" intent and the old day-view's behavior. Partially-catchable films are kept, with their past times struck in place. When a window has nothing left, the empty state reads "No quedan funciones por hoy. Mirá lo que viene este finde o esta semana." The exhaustive `/cartelera` day view still shows the full day.

## [0.3.2.0] - 2026-06-06

### Changed

- **The "Esta semana" band is now a four-slot, diversity-by-construction showcase** (TODO #32). Instead of a single priority chain (which could return four films of the same kind), the band fills four distinct editorial axes: **🇦🇷 Cine argentino** (the local slot, ranked by popularity), **✨ Estreno** (a this-year release or premiere-tagged film), **🏛 Clásico** (a pre-2000 title with enough TMDB votes to be genuinely notable — Godard's thousands beat an obscure contemporary's dozens, ranked by `vote_count` not popularity since popularity buries old films), and a **🎲 wildcard** that tries, in order, *Última función* (last screening this week — catch it before it's gone), *Nuevo en cartelera* (first seen in our catalog recently), and *Cine del mundo* (a non-AR/US country, surfacing the global tail). Each film fills at most one slot; any slot that can't fill that week falls back to the same wildcard chain, so the band stays full whenever four films qualify and is omitted entirely when none do. Every pick still requires a real poster (no SIN AFICHE) and a future screening (still catchable). Ranking uses the TMDB signals captured in v0.3.1.0; thresholds (`year ≤ 2000`, `vote_count ≥ 1000`, "nuevo" within 14 days) are tunable as real numbers come in.

### Removed

- **The "Saltar al contenido" skip link.** It was wired with `focus:` (not `focus-visible:`), so any incidental or programmatic focus — e.g. after a window-switch navigation — revealed it on screen unexpectedly. Removed from `/` and `/cartelera`.

## [0.3.1.0] - 2026-06-06

### Added

- **Capture TMDB `popularity`, `vote_average`, `vote_count`, and `tagline` at enrichment.** Four new nullable `films` columns, populated from the same TMDB detail response we already fetch (near-zero marginal cost). No user-facing change yet — this banks the data for the upcoming featured-band redesign (TODO #32): `popularity` ranks the band's premiere / Argentinian slots ("most interesting now"), `vote_count` ranks the classic slot (notability — Godard's thousands of votes beat an obscure contemporary's dozens), `vote_average` is a quality signal, and `tagline` (TODO #33) is banked for future use. Captured in `enrichFilm` and persisted by both write paths (`writeEnrichmentToFilm` + `refresh-enrichment`); existing rows backfill on the next `refresh-enrichment` pass. Additive migration `0009` (nullable columns only — safe).

## [0.3.0.1] - 2026-06-06

### Fixed

- **The "Esta semana" featured band can no longer show a poster-less film.** An unenriched / unmatched film (no TMDB poster) was eligible for the curated band and rendered the "SIN AFICHE" placeholder in the hero row — which reads as broken, since the band is the page's editorial showcase. `deriveFeatured` now excludes any film without a `posterUrl` outright, no matter how strong its reason (premiere / última / ciclo). Such films still appear in the exhaustive `/cartelera` list, where a placeholder poster is acceptable.

## [0.3.0.0] - 2026-06-06

### Changed

- **The homepage is now a window-scoped, one-row-per-FILM cartelera instead of one card per showtime.** On a busy weekend the old day-grouped view was a 50-70 card scroll wall with heavy duplication — the same film repeated once per showtime, per venue, per day. Prod data says that wall is a heavy tail: 64% of films have a single showtime all week and 95% play a single venue, so the common film is one clean line. The new homepage groups by film and scopes to a relative time window — **Hoy** (default) / **Este finde** / **Esta semana** / **Próximamente** — selected via `?ventana=hoy|finde|semana|prox` (server-rendered and shareable; an unknown value falls back to `hoy`). A single-showtime film renders an inline `time · venue`; a multi-showtime film collapses to a `{n} funciones · {venue}` summary and tap-expands to its times (grouped by venue in `hoy`, by day in the multi-day windows, capped with a "ver todas →" link). Films sort by their next still-catchable showtime; a film whose showtimes have all passed sinks to the bottom (most-recently-ended first) with past times struck in place. The window registry (`src/lib/windows.ts`) is the single source for the nav, the `?ventana=` validation, and the bounded query, so re-labelling or re-defaulting a window is a one-line change.
- **Desktop now uses the full width** — a full-bleed "Esta semana" curated hero band over a 2-column film grid, with the masthead split (wordmark hard-left, edition dateline right-aligned). Mobile stays a single column. The always-on per-row carmine left-bar and the `bg-carmine/5` card tint were retired (carmine now lives on the showtime and a hover left-tick); synopsis no longer appears in the list (it stays on `/pelicula`).

### Added

- **Curated "Esta semana" band.** A static (never auto-rotating) row of 0-4 poster cards with a WHY tag — `Estreno` (premiere tag), `Última función` (the film's last future screening falls within the week, computed against the unbounded per-film maximum so a film also screening weeks out is never falsely flagged), or `Ciclo {name}` (program). The band features only films you can still catch, dedupes by film, caps at 4, and is omitted entirely when nothing qualifies. Operator-pinned picks and a diversity-weighted default sort remain deferred (TODO #32).
- **`/cartelera` — the exhaustive day-by-day view.** The previous homepage (14-day rolling window, sticky date strip, "Próximamente" week index) moved here verbatim, reachable from the homepage's **"Ver todo →"**. It reassures against the illusion-of-completeness risk of the windowed front door: everything is one tap away. The scrape webhook and the admin enrich/refresh/match actions now revalidate `/cartelera` alongside `/`.

### Fixed

- **Ticketing time-links inside an expanded multi-showtime film now open ticketing, not the film page.** The row's stretched card-link overlay sat above the expanded showtime links, silently stealing their taps; the links are now raised above it (and the disclosure toggle meets the 44px touch-target minimum).
- **The "0" runtime trap** stays guarded — the film metadata line drops a `0`/null runtime cleanly rather than rendering a stray "0 min" (regression ISSUE-001 class).
- **The curated band's first poster is eager-loaded** as the page LCP (it sits above the film grid); the film-grid poster only leads when the band is omitted.

## [0.2.3.9] - 2026-05-20

### Fixed

- **Expired screenings no longer occupy the top of today's cartelera section.** The dominant evening-cartelera intent is "what's still seeable tonight," and prior behavior rendered every today screening as a full poster+synopsis+metadata card regardless of whether it had already started — forcing a 20:00 BA visitor to scroll past 17:00 / 18:30 / 19:00 cards to reach what was actually still attainable. Expired screenings (defined as `startsAtUtc + 15min < now`) are now filtered out of today's day section entirely. The count is preserved in the day-banner subhead as a density signal so the day's overall activity stays legible without resurrecting card chrome: "12 funciones · 4 ya pasaron" (the "· N ya pasaron" suffix is omitted when nothing is expired). The all-expired edge case shows "12 funciones · todas ya pasaron" plus editorial body copy "No más funciones por hoy" in place of the cards. The 15-minute grace window matches BA-indie-cinema reality — a user looking at the cartelera at 19:12 for a 19:00 Lorca screening can typically still walk in, so flagging it expired the moment it nominally starts felt harsh.

  Predicate `isScreeningExpired(startsAtUtc, now)` lives in `src/lib/date-ranges.ts` alongside the existing BA-tz helpers, with `SCREENING_GRACE_MS = 15 * 60 * 1000`. Instant comparison only — no BA-timezone math needed because both inputs are UTC Date instants; the BA-local discipline only matters for date-bucketing (which day "today" means), not for "has this instant passed?". Partition happens in `DaySection` (`src/app/page.tsx`) and is gated on `day.isToday` — non-today days pass through unchanged because they're entirely future by construction. 7 new boundary tests in `src/lib/date-ranges.test.ts` lock down the predicate at 14:59 ago (not expired), exactly 15:00 ago (boundary, not expired — predicate is strict `<`), 15:01 ago (expired), and multi-hour-past (expired). Test count: 424 → 431. Browser-verified at `localhost:3000` with a synthetic seed across all three banner states (mixed expired/upcoming, all-expired-today, non-today unchanged).

  `/pelicula/<slug>` deliberately not touched in this change. Different intent — the film-detail page is "this film's full BA-circuit history," and past screenings on it carry editorial value ("played at MALBA last Thursday" is interesting context to a user landing there post-screening). The `FilmScreeningRow.isPast` grayscale demotion on that page is independent and retained.

  Closes TODO #20.

### Removed

- **`ScreeningCard.isPast` prop** in `src/app/page.tsx` (and the grayscale-poster + ink-gray time-color paths it controlled). With expired screenings hidden upstream, the flag became dead code — the partition is the only path that ever sets it, and the partition no longer renders the past branch. Removing it kept the card component honest. `/pelicula/`'s `FilmScreeningRow` has its own independent `isPast` for that page's past-screenings-stay-visible rendering — unrelated, unchanged.

## [0.2.3.8] - 2026-05-17

### Added

- **Branded favicon — cream serif "A" on carmine.** Replaces the default Next.js Vercel "N" that had been sitting in `src/app/favicon.ico` since project init in April. Two files cover the modern + legacy paths simultaneously: a new `src/app/icon.svg` (~250 bytes, vector-crisp at every device pixel ratio) which Next.js 16's file convention auto-injects as `<link rel="icon" type="image/svg+xml" sizes="any" />`, and a regenerated `src/app/favicon.ico` (~15KB, down from 25KB) which serves the legacy `/favicon.ico` path that browsers, bots, RSS readers, and Slack/X/Telegram unfurl generators all fetch directly without parsing HTML. Both `<link>` tags coexist; modern browsers prefer the SVG, direct `/favicon.ico` fetches hit the .ico. No code in `layout.tsx` changes — file conventions drive the metadata generation per Next.js 16's `app-icons.md`.

  Design choice rationale: single-letter marks dominate at the 16×16 browser-tab pixel reality where favicons actually live — peer cinema sites confirm the pattern (Mubi M, Metrograph M, Screen Slate S, Letterboxd 3 dots). A full "AFICHE" wordmark is illegible below ~32px. The serif "A" matches the masthead's Instrument Serif character without depending on Instrument Serif being available in ImageMagick's font set (Times serif renders the glyph; at favicon sizes the difference between Times and Instrument Serif is imperceptible). Cream-on-carmine inversion was picked over carmine-on-cream because the foregrounded brand color stands out in a browser tab row otherwise full of white/grey favicons — the carmine fill is the same non-negotiable visual fingerprint DESIGN.md ascribes to the poster offset shadow.

  Multi-resolution `.ico` contains 16/32/48 subimages (the ICO format is a container; one file holds multiple PNG-encoded sizes and the OS/browser picks the best match per render context). The 48px subimage covers Windows taskbar / Mac+iOS bookmark thumbnails. Generated via ImageMagick `convert -background none -density 384 icon.svg ...` — the high density gives `convert` a 170×170 internal canvas to rasterize into before downsampling, so anti-aliased serifs at 16×16 survive the pipeline. CDN caching note: post-deploy, first visitors may still see the Vercel N until the cache rotates (favicons cache aggressively); hard-refresh or incognito to confirm.

## [0.2.3.7] - 2026-05-17

### Fixed

- **Date strip's "you are here" signal now actually follows the user's gaze.** Triggered by a user reporting the exact confusion that was anticipated when the original dual-signal model was specced: the strip was encoding two facts simultaneously — today is permanently carmine-filled, AND the currently-viewed day section gets a carmine bottom underline — and the solid fill always beat the 2px underline at quick-glance distance. Users reported thinking they were always viewing HOY regardless of how far they'd scrolled. Collapsed to one signal: the carmine fill (cream text on carmine bg) IS the scroll-spy affordance, and it moves with the user's position in the cartelera. The underline is gone entirely. First paint seeds the active chip to today, so HOY is filled on initial load and only un-fills once the user scrolls down. The "HOY" caps text on today's chip remains regardless of active state — that's the day label (verbal symmetry with the day-banner HOY pill, per DESIGN.md), not a styling concern. Click-driven smooth scroll still optimistically fills the clicked chip during the IO suppression window; the IntersectionObserver model is unchanged (rootMargin `-30% 0px -50% 0px`, threshold 0). `aria-current="date"` stays on today's chip — that's a semantic "this is today" signal, orthogonal to the new visual "where you are scrolled" signal. Implementation: `src/app/_components/DateStrip.tsx` (single derived `isActive` boolean drives bg + text colors; bootstrap to today's `dateKey` via lazy `useState`; transition updated from `background-color,border-color` to `transition-colors` to cover the text-color toggle).

### Documentation

- **`DESIGN.md` updated** to reflect the new one-signal model: the date-strip token table (lines ~82-89) renames "Today chip bg/text" rows to "Active chip bg/text" and adds a "Today chip (when not active)" row clarifying that HOY label-text behavior is independent of the fill; the active-state transition spec swaps `border-color` for `color` to match the implementation; and the date-strip prose on line 149 is rewritten to describe the single carmine-fill scroll-spy. A 2026-05-17 entry in the Decisions Log captures the rationale — including the user-reported confusion that triggered the fix — so future-me doesn't try to re-introduce the dual-signal model.

## [0.2.3.6] - 2026-05-11

### Added

- **Vercel Web Analytics** (`@vercel/analytics@^2.0.1`) wired into `src/app/layout.tsx` via the `<Analytics />` component from `@vercel/analytics/next`. Cookieless by design — no PII collection, no consent banner required under Argentina's Ley 25.326 or EU GDPR. Tracks page views + referrers + countries + device class across both the cartelera homepage and `/pelicula/<slug>` pages, with App Router soft-navigation events properly attributed (the component subscribes to Next.js's `usePathname()` so cross-page navigation in a single visit registers as separate events). Inert in development (no requests fire from localhost). Dashboard surfaces at `vercel.com/<project>/analytics` once a deploy lands. Zero performance cost in practice — Vercel injects the tracker via their edge, no third-party script round-trip.

  Primary use case is validating the user-pain signal Benjamin is hearing in conversation: per-film popularity (which `/pelicula/<slug>` pages get visits), referrer split (direct / X / search), and time-of-day patterns (when do cinephiles actually open the cartelera). Pairs naturally with the X presence (TODO #16) and newsletter capture (TODO #17) work, which both depend on knowing *which* channels actually deliver traffic before investing in either.

### Maintenance

- **New `.npmrc` with `legacy-peer-deps=true`** to document and persist the workaround for `@vercel/analytics`'s optional SvelteKit peer dep. The package is intentionally multi-framework (Next.js, SvelteKit, Nuxt, Astro share one npm name), so it declares an optional peer on `@sveltejs/kit` whose transitive chain reaches `vite@^8` — conflicting with our `vitest@2.1.9`'s `vite@^5`. Nothing in our runtime touches SvelteKit, but npm v7+ enforces optional peers by default and errors at install time. The `.npmrc` reverts npm to v6-era resolution for this project, exactly what the flag is intended for per npm's own docs. Persists across all future installs (CI, fresh clones, post-`rm -rf node_modules`) without anyone needing to remember `--legacy-peer-deps`. To remove: when `@vercel/analytics` ships a Next.js-only variant OR the SvelteKit-via-vite peer chain relaxes to `^5 || ^8`.
- **No new vulnerabilities introduced.** `npm audit --omit=dev` shows 2 moderate (pre-existing in Next.js's internal `postcss`, fixes pending upstream); `@vercel/analytics` itself is clean.

## [0.2.3.5] - 2026-05-11

### Fixed

- **Cine Lorca titles no longer carry their decorative poster quotes through to the films table.** The VLM-extracted titles from recent Cine Lorca scrapes were arriving wrapped in ASCII double quotes (`"EL DRAMA"`, `"SUEÑOS DE OSLO"`) and Spanish guillemets (`«FILM»`) — the prompt's VERBATIM-preserve rule faithfully but incorrectly carried the poster's framing typography into the title string. Each new variant created a fresh `films` row that didn't collide with the canonical un-quoted row on the `(scraped_title, scraped_year)` upsert key, accumulating orphan duplicates each scrape. Films that auto-matched (`EL DRAMA`, `CALLE MÁLAGA`) merged correctly via the v0.2.3.0 tmdb_id-collision dedup, but films TMDB didn't auto-match (Spanish-localized titles like `PADRE, MADRE, HERMANA, HERMANO`) stayed as orphan duplicates forever — including alongside manually-patched rows the operator had carefully fixed.

  The fix has two layers, both load-bearing:

  1. **Post-processing strip in `parseVisionResponse`** (`src/providers/cine-lorca.ts`). New `normalizeVisionTitle()` helper runs a fix-point loop that alternates between stripping enclosing quote pairs and extracting a trailing `(YYYY)` release-year suffix. Handles all orderings — `"FOO (1963)"`, `"FOO" (1963)`, `«FOO» (1963)` — uniformly. Strict pair-matching: only strips when BOTH ends carry the matching open/close character; never removes a one-sided quote (protects legitimate stylized poster typography like `EL DIABLO VISTE A LA MODA?` and apostrophe-leading titles like `'Tis a Pity`). ASCII single quote `'` is deliberately excluded from the strippable pairs because it doubles as an apostrophe within words; the typographic single-quote pair `'…'` is still stripped.

  2. **Prompt rule update** (`VISION_USER_PROMPT`) teaching the model that decorative whole-title quotes and `(YYYY)` year suffixes are framing elements, not part of the title text. Adds explicit exceptions to the existing VERBATIM-preserve rule. Bumps `PROMPT_VERSION` 1 → 2, which invalidates the image-hash cache and forces one fresh Sonnet call per Cine Lorca poster on the next scrape (~$0.015) — acceptable cost for retroactive correctness on the cached parses.

- **Per-film release year in title now reaches the upsert key.** A poster like "EL DESPRECIO (1963)" used to bury the year inside the `scraped_title` and emit `scraped_year=NULL`. The `(YYYY)` extractor now sets `ScrapedScreening.year`, which becomes the films row's `scraped_year` — the unique index `(scraped_title, scraped_year)` actually fires on subsequent scrapes instead of falling through SQLite's NULL-distinct semantics. (For films without a printed year, the mutable-key-upsert bug class still applies; this is a partial mitigation, not the structural fix tracked in memory `project_afiche_mutable_key_upsert_bug.md`.)

### Maintenance

- **14 new tests** in `src/providers/cine-lorca.test.ts`: 11 covering `normalizeVisionTitle` directly (clean-pass, ASCII/curly/guillemet pair stripping, one-sided non-strip protection, ASCII single-quote exclusion, trailing `(YYYY)` extraction, year-inside-quotes and year-outside-quotes via the fix-point loop, sequel-number lookalikes left alone, whitespace handling, mid-title quote preservation), and 3 end-to-end through `parseVisionResponse` + `expandScreenings` asserting that normalized titles + extracted years land on `ScrapedScreening` correctly.
- **Operator-side cleanup (not in this commit)** required for existing orphan rows that accumulated before the fix. Films like `films.id IN (1435, 1523)` (`PADRE, MADRE, HERMANA, HERMANO` duplicates of the patched row 1335) need manual merge in Drizzle Studio: `UPDATE OR IGNORE screenings SET film_id = <winner_id> WHERE film_id IN (<loser_ids>); DELETE FROM films WHERE id IN (<loser_ids>);`. The dedupe-films script (added v0.2.3.0) only merges by tmdb_id clusters and won't help here since the orphans have no tmdb_id. Future scrapes won't create new quote-class orphans once this fix deploys.

## [0.2.3.4] - 2026-05-11

### Fixed

- **Lugones S2 parser now handles the "a las" editorial prose schedule form.** The Justa cycle (Teresa Villaverde 2025, screenings 2026-05-28 → 2026-06-04) used a previously-unseen schedule shape: `"Jueves 28 y viernes 29 de mayo a las 21 horas"` / `"Sábado 30 a las 18 horas"` instead of the comma-form `"Viernes 8 y sábado 9, 20.30 horas"` the parser was written for. `matchSingleFilmShowtime`'s regex required a comma between the day-list and the time, so all 45 paragraphs on the Justa detail page failed to parse — the run logged a `program "Justa": 0 screenings parsed from 45 <p> tags` warning and the cycle's 7 funciones never reached the cartelera.

  The fix extends the regex to accept either connector (`,` or ` a las `), plus an optional `" de MONTH"` suffix on the day list. When the suffix is present, the explicit month is returned and `parseS2SingleFilm` treats it as a signal-wins-over-heuristic override of the running month context (more robust than the day-decrease rollover heuristic against out-of-order listings or month skips). The same regex still accepts the existing comma form, so the Boris Karloff and Ojos extraños cycles continue to parse unchanged.

- **FICHA TÉCNICA parser extended for three additional editorial conventions.** Justa's metadata section combined country and year on a single line (`"Portugal/Francia, 2025"` rather than the existing two-line `"Country list"` / `"YYYY"` shape), used prose runtime (`"108 minutos"` rather than apostrophe-marked `"126'"`), and credited the director with a multi-role prefix (`"Dirección, guion y producción: Teresa Villaverde"` rather than `"Dirección:"` or `"Dirección y guion:"`). `parseFichaLines` now handles all three. The director regex was tightened with a whitelist of allowed role-list words (`guion|guión|producción|montaje`) so neighbouring credit lines like `"Dirección de fotografía"` (cinematographer) and `"Dirección de arte"` (art director) don't false-match as the film's director.

### Maintenance

- **10 new tests** in `src/providers/lugones.test.ts`: six covering the new `matchSingleFilmShowtime` shapes (`"a las"` connector, decimal-minute under the new form, explicit `de MONTH` suffix capture at mayo + junio, single-day inheritance, unrecognized-month defensive null return); and four covering the Justa fixture end-to-end (7 screenings emitted, exact `(month, day, hour, minute)` tuples for each, film metadata extracted across every row, no `"0 screenings parsed"` warning).
- **New fixture `test/fixtures/lugones/justa.html`** — real capture from `https://complejoteatral.gob.ar/ver/Justa` taken 2026-05-11. Stored verbatim so future regressions surface in CI without re-fetching.

## [0.2.3.3] - 2026-05-11

### Fixed

- **TMDB matcher no longer silently picks the wrong confident match when the scraped director disagrees.** The Nosferatu / Eggers vs Herzog bug class (TODOS.md #18). MALBA's Cineclub Nocturna 5 page rendered Werner Herzog's *Nosferatu, fantasma de la noche* (1979) as a bare "Nosferatu" line; the matcher's `pickBestMatch` saw an exact title hit on Eggers 2024 (score 1.0) versus a partial hit on Herzog 1979 (score ~0.87) and confidently picked Eggers. The director hint "Werner Herzog" was passed in but never consulted because the existing director-fallback at `src/tmdb/enrich.ts:151` was a low-confidence rescue path — it only fired when `pickBestMatch` returned null, not when it picked the wrong film. The result on the cartelera: Eggers's 2024 poster + Eggers's synopsis on a Herzog 1979 screening. Two structural fixes ship together:

  1. **Director-verification on the top match** — when a director hint is provided, `enrichFilm` now fetches the top candidate's TMDB credits (it already did, to build the delta) and checks `directorsMatch(hint, topDirectors)`. On mismatch, it falls through to the existing director-fallback rescue across the sorted top-3. The top candidate's already-fetched details are reused (no duplicate API call). This catches the actual Nosferatu shape — a *single confident top match* that happens to be the wrong film. Cost: zero extra TMDB calls on the success path; one extra call on the rescue path when the rescue picks a different candidate than the top.

  2. **Title-ambiguity guard in `pickBestMatch`** — when the top-2 candidates both clear the 0.85 confidence threshold AND tie within a new `TITLE_AMBIGUITY_EPSILON` (0.01, same band already used to tiebreak by popularity), `pickBestMatch` now returns `null` instead of letting popularity decide. This catches the adjacent shape — *multiple TMDB entries with identical localized titles* (e.g. Eggers 2024 + Murnau 1922 both stored as "Nosferatu" in es-AR). When a director hint is available, the director-fallback rescues; otherwise the film surfaces as `low-confidence` (operator-actionable miss in Drizzle Studio), which beats silently picking the most-popular wrong entry on the cartelera.

  Trade-off accepted: a scraped director with a typo or unusual variant (e.g. "W. Herzog" vs TMDB's "Werner Herzog") that previously matched on title alone now drops to `low-confidence`. The matcher remains intentionally strict on director-name equality (per the existing `directorsMatch` note: "prefer a missed fallback over a false positive"). Visible misses are preferable to silent mismatches.

### Maintenance

- **6 new tests** in `src/tmdb/match.test.ts` and `src/tmdb/enrich.test.ts` covering: the title-ambiguity guard returning null on tied-title pairs; the year-hint resolution path (filters Eggers out before scoring); the director-verification rescue path (Eggers picked then rejected → Herzog wins via fallback); the `topDetails` reuse invariant (Eggers fetched once across verification + fallback); the no-director-hint low-confidence outcome on ambiguous titles; and an out-of-epsilon test ensuring the guard isn't over-conservative on legitimate top matches.
- **Existing "popularity tiebreaker" test rewritten** to encode the new contract: `pickBestMatch` returns null on title-tied high-confidence pairs (caller disambiguates), while `scoreCandidates` still sorts more-popular first (so director-fallback's top-3 walk is in the right order).
- **`TITLE_AMBIGUITY_EPSILON = 0.01`** is now exported alongside `MATCH_CONFIDENCE_THRESHOLD` and `YEAR_TOLERANCE` so the threshold is co-located with the other tunable knobs.

## [0.2.3.2] - 2026-05-11

### Fixed

- **Synopsis preview now clamps to 3 lines on desktop cartelera cards.** The `<p>` in `ScreeningCard` (`src/app/page.tsx`) carried `line-clamp-3 hidden md:block` on the same element. `line-clamp-N` requires `display: -webkit-box` to function; `md:block` sets `display: block` inside `@media (min-width: 48rem)`. At equal specificity, the responsive variant won on source order at the `md:` breakpoint and silently defeated the clamp — synopses then rendered at content height (2/4/6+ lines depending on text length), producing ragged card heights across each row. Fix: pushed `hidden md:block` onto a wrapper `<div>`, leaving the inner `<p>` with `line-clamp-3` and its `display: -webkit-box` uncontested. Visual rhythm is restored; card heights in a row now line up to the 3-line cap.

### Maintenance

- **New regression guard in `src/app/layout-invariants.test.ts`** scans every `*.tsx` under `src/app/` and fails when any single className combines `line-clamp-N` with a display utility (`block`, `hidden`, `flex`, `grid`, `inline-block`, `inline-flex`, `inline-grid`, `contents`, `flow-root`, `table`, `inline`) — including responsive variants like `md:block`. Fixture-style, no browser needed. Same discipline as the existing `<main>` w-full check (CLAUDE.md frontend-conventions #1). Closes `TODOS.md` #15.

## [0.2.3.1] - 2026-05-07

### Changed

- **Lorca vision call upgraded from Haiku 4.5 to Sonnet 4.6.** Same prompt, same `temperature: 0`, same image-hash cache. Sonnet's OCR accuracy on dense small-text Spanish posters is markedly better — closes the rare residual drift cases (letter-substitution hallucinations like `GIOIA` → `GUIOTA`, stray punctuation like `HERMANO?`) that survived even temperature-0 deterministic decoding on Haiku. Cost goes from ~$0.005 to ~$0.015 per call; with the image-hash cache hitting 6 of 7 days per week, real annual cost is ~$0.78 (vs. ~$0.26 on Haiku). Cache key composes `VISION_MODEL`, so the model swap auto-invalidates — first scrape after deploy burns one Sonnet call to repopulate, then back to cache hits. Uses the alias `claude-sonnet-4-6` (the SDK enum at `node_modules/@anthropic-ai/sdk/resources/messages/messages.d.mts:707` doesn't list a dated snapshot for 4-6 yet — only the alias).

## [0.2.3.0] - 2026-05-07

### Fixed

- **Duplicate film rows from VLM drift, cross-provider format divergence, and pre-fix year-null legacy now collapse automatically.** The session-long bug class — `GIOIA MIA` ↔ `GUIOTA MÍA`, `LA PATAGONIA REBELDE` ↔ `La patagonia rebelde`, `PADRE…HERMANO` ↔ `…HERMANO?` — is closed structurally. The enrichment loop's merge-on-collision predicate is now keyed on `tmdb_id` equality (`mergeIfTmdbIdCollides`) instead of the prior `(scrapedTitle, year)` equality (`mergeIfYearCollides`) which silently missed every case where scraped titles differed. tmdb_id, when known, is the strongest identity signal in the system; once both rows of a duplicate pair enrich, they share it, and the second row of the pair merges into the first deterministically.

### Changed

- **Renamed `mergeIfYearCollides` → `mergeIfTmdbIdCollides`** with the new tmdb_id-keyed predicate (`src/scrapers/ingest/enrichment.ts`). All four scenarios the original function caught are still caught (any time the old merge fired, the new one fires too — both rows eventually share tmdb_id post-enrichment). The rename + predicate change is strictly broader.
- **Extracted shared `mergeFilmInto(loserId, winnerId, warnings?)` helper** to `src/scrapers/ingest/films.ts`. Used by both the enrichment loop's merge and the new dedupe-films cleanup script. One source of truth for the `UPDATE OR IGNORE screenings` + `DELETE films` + cascade pattern.
- **`fetchPendingFilms` now `ORDER BY id DESC`** so when multiple rows in the pending pool collide on tmdb_id (e.g. operator manually patched several rows to the same id), the newer row (higher id) is processed first and loses, while the older row (lower id, anchored slug) survives. For the common single-pending-row VLM-drift case the order is moot.

### Added

- **`scripts/dedupe-films.ts`** — one-shot cleanup for existing duplicates that don't re-enter the enrichment-pending pool (most accumulated dupes have `match_source='auto'` and stay out of pending). Finds every `(tmdb_id, COUNT > 1)` cluster, picks the lowest id as winner per cluster, and runs `mergeFilmInto` on the rest. Dry-run by default; pass `--apply` to mutate. Run via `npm run db:dedupe-films` (local) or `npm run db:dedupe-films:prod` (Turso). Closes the bug class for accumulated duplicates that the structural fix alone wouldn't catch.
- **Index on `films.tmdb_id`** (Drizzle migration `0007_safe_talon`). Keeps the merge predicate at `O(log n)` instead of `O(n)` as the catalog grows. Cheap insurance — < 100KB on disk at current scale.

### Maintenance

- **8 new regression tests** in `src/scrapers/ingest.test.ts` covering the structural fix end-to-end:
  - T1 (VLM drift case — `GIOIA` / `GUIOTA`)
  - T2 (cross-provider format divergence — `LA PATAGONIA REBELDE` / `La patagonia rebelde`)
  - T4 (no-collision negative case — different `tmdb_ids` must not merge)
  - T5 (TMDB miss → no merge attempted, row stays for retry)
  - T6 (manual-patch convergence — operator patches both rows to same `tmdb_id`, second collapses into first)
  - T7a-d (`mergeFilmInto` unit tests: re-point + delete, time-collision + cascade, pure-orphan cleanup, optional warnings array)
  - T8 (dedupe-films integration — multiple clusters + singleton row untouched)
- **Existing 4 merge tests updated** to seed the existing-row's `tmdb_id` (production-realistic — `match_source='auto'` rows always have it set; the prior tests were missing this detail). Describe-block renamed to "merge on tmdb_id collision".
- **293 tests pass** (1 deliberately-skipped live vision test).

## [0.2.2.0] - 2026-05-07

### Added

- **Image-hash cache for the Cine Lorca vision call.** Lorca posts a new cartelera every Thursday and the same poster image is served for the rest of the week. Each daily scrape was paying ~$0.005 for an Anthropic call AND giving Haiku another roll of the dice on title transcription — the structural source of the title-drift duplicate bug (e.g., `GIOIA MIA` ↔ `GUIOTA MÍA`, `PADRE…HERMANO` ↔ `…HERMANO?`). Now the provider hashes the fetched image and short-circuits when the cache key matches what was cached on the last successful parse. Drift surface drops from 7 calls/week to 1. Persisted in two new `providers` columns: `last_image_sha256` and `last_image_parsed` (Drizzle migration `0006_awesome_doctor_doom`). The cache key is `sha256(imageBytes ‖ ':' ‖ VISION_MODEL ‖ ':' ‖ PROMPT_VERSION)` so a model upgrade or a prompt revision automatically invalidates prior parses — bumping `PROMPT_VERSION` (a constant in `cine-lorca.ts`) on a meaningful prompt change forces a fresh vision call on the next run.

### Changed

- **Tuned the Lorca vision call for transcription accuracy.** Four changes to `readCarteleraWithVision` in `src/providers/cine-lorca.ts`:
  - `temperature: 0` — greedy decoding so the same image deterministically produces the same transcription. Eliminates the run-to-run variance that turned `GIOIA` into `GUIOTA` between scrapes.
  - System prompt promoted to the dedicated `system` field — persona + output-format guardrails separated from per-image instructions, per Anthropic instruction-following best practice.
  - Few-shot example added to the user prompt — one worked sample of the JSON shape with mixed time-format normalization (`14.10 hs.` → `14:10`, `16:00 hs.` → `16:00`). Highest-leverage prompt-engineering tool for structured-output OCR.
  - `stop_sequences` added — defensive clip on any runaway prose.

### Fixed

- **`parseHHMM` now accepts both `:` and `.` as time separators.** The Lorca poster mixes `14.10 hs.` (period) and `16:00 hs.` (colon) on the same week — different films use different formats. The vision prompt asks for normalization to colon, but if a stray period-format time slipped through, the previous regex `^(\d{1,2}):(\d{2})$` would silently drop it. New regex `^(\d{1,2})[:.](\d{2})$` accepts both as a defensive backstop.
- **Cache-read hardening against corrupt JSON.** `readImageCache` now wraps the SELECT in try/catch — Drizzle's `mode: 'json'` parses the column during row hydration, so an operator hand-edit or partial write that left invalid JSON in `last_image_parsed` would have aborted the whole scrape run. Now it degrades to a safe cache miss and a fresh vision call.
- **Cache-write failure surfaces in `scrape_runs.warnings`.** Previously `writeImageCache(...).catch(() => {})` swallowed every write failure, so a permanently-failing cache write would mean re-calling Anthropic forever with no signal. Now the catch pushes a warning into the run-log so operators see it in the dashboard.

### Maintenance

- **Bounded the cache validator against Cartesian-explosion payloads.** `isParsedCartelera` now caps `films[]` (≤30), `times[]` per film (≤20), title length (≤200 chars), year (2020-2050), month (1-12), day (1-31). Before, a corrupt or hand-edited `last_image_parsed` JSON could have passed validation and fed `expandScreenings` (films × days × times) a Cartesian explosion of INSERTs. Cap violations degrade to cache miss.
- New test file `src/providers/cine-lorca-cache.test.ts` (16 tests) exercises the cache write/read/round-trip, hash-mismatch miss, overwrite-on-new-image, shape-validation defense, JSON-hydration safety, every cap boundary, and `composeCacheKey` determinism + invalidation.
- Existing `src/providers/cine-lorca.test.ts` gains a regression test for the `parseHHMM` period-format fix and a minimal `@/db` stub so its pure-function tests don't pull the libSQL client.
- Schema docstring updated to reflect that `providers` now holds per-provider state cache fields in addition to health/observability columns.

## [0.2.1.1] - 2026-05-05

### Fixed

- **`/pelicula/<slug>` URLs now render a film-specific preview when shared on WhatsApp/Slack/Twitter/Telegram**, instead of falling through to the Vercel favicon. Root cause: the file-convention `opengraph-image.png` at `src/app/` only attaches to its own route segment (`/`), not nested routes — and the page's `generateMetadata` was returning a child `openGraph` object without `images`, which shallowly replaces the parent's metadata, so `/pelicula/<slug>` emitted no `og:image` at all. Fix: explicitly populate `openGraph.images` and `twitter.images` in the page's `generateMetadata` using the film's TMDB backdrop (16:9 at w1280, ideal for `summary_large_image` cards on Twitter/Slack/Telegram) with the vertical poster (TMDB w500) as fallback for films without a backdrop.

## [0.2.1.0] - 2026-05-05

### Fixed

- **Manually-patched `tmdb_id` values now persist across scrapes.** Previously, films whose `tmdb_id` was patched in Drizzle Studio after auto-match failed would lose the patch on the very next `scrape:prod` run — the cartelera would silently render an unenriched duplicate while the patched row was orphaned. Confirmed in prod 2026-05-05 for "PADRE, MADRE, HERMANA, HERMANO" and "EL DESPRECIO (1963)". Root cause: the films unique index was on `(scraped_title, year)`, but enrichment writes `year` (e.g. resolves a year-less row to 2025). The next re-scrape's lookup for `year IS NULL` then missed the patched row and inserted a fresh unenriched duplicate. Fix: split the immutable `scraped_year` (what the scraper first saw, never updated) from the mutable `year` (what we now believe), and key the unique index on `(scraped_title, scraped_year)`. Re-scrapes now find the existing row regardless of how `year` has evolved.

### Changed

- **New `films.scraped_year` column** (Drizzle migration `0005_spooky_zarek`). Backfilled `scraped_year = year` for every existing row, with manually-patched rows (`match_source = 'manual'`) overridden to `NULL` because we know the scraper originally emitted year=null for those (that's why auto-match failed). One-time consequence: auto-matched rows whose original scraper-emitted year was NULL will create one duplicate on the next scrape, which the existing merge-on-collision logic in `enrichment.ts` collapses automatically — bounded one-time noise in the merge warnings, then stable forever.

### Maintenance

- Three new regression tests in `src/scrapers/ingest.test.ts` lock the manual-patch + re-scrape sequence so this can't silently regress: a re-scrape with year=undefined finds the patched row by `scraped_year IS NULL`, distinct `scraped_year` values stay distinct (the merge logic handles their cleanup), and two consecutive year-less re-scrapes converge on a single row.
- Stale comment block in `enrichment.ts` updated. The merge-on-collision logic is no longer a "prevent unique-constraint violation" mechanism (the new key prevents that automatically); it's now purely cross-provider deduplication.

## [0.2.0.3] - 2026-05-05

### Fixed

- **Sala Lugones "bis" / single-day programs are no longer silently dropped.** The Lugones index page exposes one-off encore screenings (e.g. "Claude Chabrol bis") with a date string like `"Jueves 28 de mayo, 15 y 18 horas"` — a single-day shape that doesn't fit the cycle-style `"Del X al Y"` range syntax the parser handled. Pre-fix, the scraper logged `could not parse date range "..."` and dropped the entire program. Now `parseDateRange` recognizes a fourth syntactic form (`<weekday> <day> de <month>`) and the existing S1 detail-page walker handles the rest, since `matchDayHeader` already accepts month-less day headers (`"Jueves 28"`). Captured the live Chabrol bis detail page as a fixture and added unit + integration regression tests.

### Maintenance

- Documented as a known source-quality limitation: the second film on the Chabrol bis page ("Al anochecer") will still be silently skipped because the source page omits its `<strong>title</strong>` element — the title appears only in the prose intro paragraph. That's a Lugones CMS data-entry gap, not a scraper bug. Recovering it would require regex-on-prose, which is the most fragile possible parser strategy.

## [0.2.0.2] - 2026-05-05

### Changed

- **Day heading collapses flush against the sticky date strip on chip jumps.** Tightened `scroll-padding-top` from 88 px to 70 px so the strip's bottom border and the day banner's top border sit on the same pixel edge — the two 1 px rules read as a single editorial double-rule line. The earlier 88 px left a small gap, which read as two competing parallel lines. The new comment in `globals.css` flags this as a deliberate rule-collapsing choice so future edits don't reintroduce breathing room.

## [0.2.0.1] - 2026-05-05

### Fixed

- **Smooth scroll when tapping date chips on iPhone Safari.** Chip taps used to produce a hard, instantaneous snap on real iOS devices because the page-level smooth-scroll behavior wasn't set; iPhone's larger per-day scroll delta made the jump painfully visible. Desktop emulation hid the bug because adjacent sections often shared a viewport. The whole page now glides between days. Reduced-motion preference is respected — users who opt out of motion still get instant jumps.
- **Day heading lands with breathing room below the sticky date strip.** The previous offset (60 px) was ~9 px short of the strip's actual rendered height and gave zero air between the strip's bottom border and the heading's top border. Replaced two per-element `scroll-mt-[60px]` magic numbers with a single `scroll-padding-top: 88px` on `<html>`, which covers every anchor target on the page and leaves ~20 px of breathing room.

## [0.2.0.0] - 2026-05-03

### Added

- **Sticky date-strip navigation across the homepage.** Tap any of the next 14 days to jump straight to that day's screenings. Today's chip stays carmine the whole time. The active chip's underline tracks where you are as you scroll — and the strip auto-centers the active chip when it leaves view, so you always see "you are here" in context. A trailing "Próximamente →" chip jumps to the further-out programming.
- **Próximamente section** now groups screenings by week ("Semana del 19 al 25 de mayo") instead of as one long flat list. Easier to plan around dates a few weeks out.
- **Frontend regression test** at `src/app/layout-invariants.test.ts`: pins the contract that every top-level `<main>` carries `w-full min-w-0` so a flex-item width foot-gun can't silently overflow mobile again.
- **Tailwind class typo detection** via `eslint-plugin-better-tailwindcss` (V4-compatible). Catches `min-width-0`, `bg-creem`, and other typos that would silently produce no CSS. Wired into `npm run lint`.

### Changed

- **Two-tier homepage** (was three): days 1–14 render as full cards (navigated via the strip), days 15+ render as the week-grouped Próximamente text index. Compact-card variant for week 2 retired — the strip's tap-to-jump replaces scroll-skim, so the visual demotion no longer earned its keep.
- **14-day rolling content window** (was ISO-week-bounded). Cartelera shows `today` through `today+13` regardless of weekday — a Wednesday user always sees Wed → Wed+13 with one-tap navigation to any of them. Edición masthead label still reads "Semana del X al Y" as editorial flavor, decoupled from cartelera content.
- **Today's strip chip displays "HOY"** (mono caps) instead of the day number, mirroring the day-banner HOY pill below — visual + verbal symmetry.
- **Empty-day handling**: a day with zero screenings (rare but possible during festival hiatus) renders an editorial "Las salas descansan" banner instead of being dropped from the list. The corresponding strip chip is muted to 50% opacity, still tappable.

### Fixed

- **Mobile horizontal-overflow bug** on every page with a `<main>` element. Flex-item `min-width: auto` interacting with `mx-auto + max-w-5xl` was sizing main to its content's natural width (~1024px) on a 375px viewport, causing horizontal page scroll and stretching cards beyond viewport. Added `w-full min-w-0` to `<main>` in `page.tsx`, `pelicula/[slug]/page.tsx`, and `pelicula/[slug]/not-found.tsx`. The regression test pins the fix.

### Maintenance

- **Frontend conventions documented** in `CLAUDE.md` — flex-item width foot-gun, sticky+transform composition trap, headless-Chrome mobile-debugging unreliability, recommended layout patterns. Future work catches these gotchas immediately.
- DESIGN.md decisions log entry for the nav refactor + the metaphor-as-flavor-not-veto framing that drove the consolidation.
- Editorial conceit demoted from veto to flavor: editorial / zine / Edición concept drives type, palette, voice, masthead — it does NOT veto user-friendly behavioral decisions. Concrete outcomes: 14-day rolling strip (not ISO-week-bounded), week-2 compact-card density retired, dark mode added to near-future roadmap.

## [0.1.2.0] - 2026-05-02

### Fixed

- **Cine Lorca provider activated.** The provider stopped finding the cartelera image when Lorca dropped the SEO-friendly `cartelera.jpeg` filename in favor of Wix's raw `~mv2` user-upload pathname. Switched the image-URL extractor to anchor on the `~mv2` marker first (with the SEO filename as fallback), preferring the largest rendered variant when multiple are present. Lorca contributes 70 screenings/week.
- **DD/MM date format clarified to vision.** The Spanish prompt now explicitly instructs Claude to interpret `30/04 AL 06/05` as April 30 → May 6 (Argentine DD/MM), not June 5. Added a sanity check on the parsed validity range: if the duration falls outside 4-14 days, the provider refuses to ingest rather than poison Turso with phantom multi-week screenings (Lorca's cycle is always Thursday → Wednesday).

### Documentation

- DEPLOY.md env-file tables now include `ANTHROPIC_API_KEY` with a note that Vercel does NOT need it.

## [0.1.1.0] - 2026-05-01

### Changed

- Split `src/scrapers/ingest.ts` into focused modules under `src/scrapers/ingest/`. The orchestrator collapses from 610 lines to 80; each concern (films upsert, screenings replace, TMDB enrichment + merge-on-collision, provider health, slug-error detection, public types) lives in its own file. Public surface unchanged — every external import (`ingest`, `enrichPendingFilms`, `isSlugUniqueViolation`, `IngestSummary`) re-exports from `./ingest`. All 246 tests + 1 skipped pass without modification.

### Maintenance

- Ignore `.context/` retro snapshots in git (local trend-tracking only).
- Prettier sweep on `src/providers/malba.test.ts` (line wrapping).
