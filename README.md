# afiche

**Cartelera curada de Buenos Aires**

Afiche aggregates the weekly programming of Buenos Aires' independent and repertory cinemas into one clean, editorial-feel cartelera. The homepage is a window-scoped, one-row-per-film view (**Hoy** / **Este finde** / **Esta semana** / **Próximamente**, selectable via `?ventana=`) over a "Destacados" curated band; the exhaustive day-by-day view (14-day rolling window + sticky date strip + "Próximamente" index) lives at `/cartelera`, one tap away via "Ver todo →". Built for people who already know the difference between a Saturday at Lugones and a Saturday at Hoyts.

![Afiche cartelera, desktop](docs/screenshots/hero-desktop.png)

> [!NOTE]
> Afiche is a personal project, **live at [afiche.ar](https://afiche.ar)** (Next.js on Vercel + libSQL on Turso). The cron that refreshes prod runs from the dev machine (`npm run scrape:prod`), not GitHub Actions — runner IPs get 403'd by Cloudflare at lumiton.ar and complejoteatral.gob.ar. See [DEPLOY.md](DEPLOY.md) for the full ops setup. You can also clone the repo and run everything locally against a SQLite file — same code path, no Turso token needed.

## What it does

- **Scrapes 10 indie cinemas** every run: Sala Lugones, MALBA (two schedule formats: dense-cycle + single-event prose), Cine York, Centro Cultural Munro, Lumiton, Cine Cosmos, Cine Gaumont (Espacio INCAA Km 0), CineArte Cacodelphia, Centro Cultural Borges, and Cine Lorca (whose programming lives on a single weekly poster image — extracted via a Claude vision call with an image-hash cache).
- **Enriches each film via TMDB**: poster, backdrop, director, runtime, country, original title, Spanish synopsis (es-AR → es fallback), genres, top-billed cast. Smart merge logic handles the case where the same film surfaces with title drift across cinemas (different localizations, year-null collisions), keyed on `tmdb_id` after enrichment so duplicates collapse deterministically. Title-ambiguity guard + director-verification prevent silent wrong-matches on common-title films (e.g., the *Nosferatu* class: Eggers 2024 vs Herzog 1979 vs Murnau 1922 all share a Spanish title).
- **Renders a window-scoped group-by-film homepage** — a server-rendered Next.js 16 page (`src/app/page.tsx`). It shows one row per *film* (not per showtime) for a relative time window — **Hoy** (default) / **Este finde** / **Esta semana** / **Próximamente**, selected via `?ventana=hoy|finde|semana|prox` (shareable; an unknown value falls back to `hoy`). A single-showtime film renders an inline `time · venue`; a multi-showtime film collapses to a `{n} funciones · {venue}` summary that tap-expands to its times. A full-bleed "Destacados" curated band of 0-4 poster cards sits above the film grid. Prod data drives this: 64% of films have a single showtime all week and 95% play a single venue, so the common row is one clean line. The window registry (`src/lib/windows.ts`) is the single source for the nav, the `?ventana=` validation, and the bounded query.
- **The exhaustive day-by-day view lives at `/cartelera`** (`src/app/cartelera/page.tsx`) — the previous homepage, moved verbatim: a 14-day rolling window with full cards grouped by day, navigated by a sticky date strip (today is position 0, strip extends 13 days forward), plus a *Próximamente* flat text index for the longer tail, zine-back-page style. Reachable from the homepage's "Ver todo →". Chain cinemas (when we add them) get a de-emphasized typographic treatment, not a hidden toggle — curation is visible.
- **Per-film pages at `/pelicula/<slug>`** — title block, optional 16:9 editorial still (TMDB backdrop, desktop-only), poster + synopsis, top-billed cast, and a cross-venue list of every upcoming screening of that film across BA. The "killer feature" of the page is cross-venue discovery — answers the "when *else* can I catch this?" question that no single venue's site can answer.

## What it does NOT do (yet)

- No filters or search — the cartelera *is* the index right now. Search (by title or director) is queued behind /pelicula/ usage data.
- No cinema-specific pages — `/pelicula/<slug>` exists, but per-cinema pages don't.
- No `/programa/<slug>` pages for curated cycles (Lugones Olivera-Aries, MALBA Cineclub Nocturna, etc.). Programs are denormalized text on screenings right now. Promotion to a first-class entity is queued behind a killer-feature trigger.
- **Chains are out of scope** — Afiche covers the indie / repertory circuit only; Cinépolis and other multiplexes are intentionally excluded. This is the indie-circuit cartelera, not all of BA cinema.
- No dark mode — the editorial cream + carmine palette is the brand.

## Stack

- **Next.js 16** (App Router, Server Components, force-dynamic on the cartelera + film pages)
- **React 19** + **Tailwind CSS 4** (design tokens via `@theme`, see [DESIGN.md](DESIGN.md))
- **Geist** (sans, body) + **Geist Mono** (caps, eyebrows) + **Instrument Serif** (display: masthead, day banners, film titles, italic time accents)
- **Drizzle ORM** + **libSQL** (SQLite locally, Turso in production)
- **cheerio** for HTML scraping; **Claude vision** (`claude-sonnet-4-6`) for Cine Lorca's image-only weekly poster, with image-hash cache
- **Vitest** for testing (~645 tests across 35 test files: date/window helpers, group-by-film grouping, scraper providers, ingest, run logging, TMDB enrichment, layout invariants)
- **TMDB API** for film enrichment

## Cinemas covered

| Cinema | Neighborhood | Type | Source |
|---|---|---|---|
| Sala Leopoldo Lugones | San Nicolás | indie / repertory | complejoteatral.gob.ar |
| MALBA | Palermo | indie / museum | malba.org.ar |
| Cine Lorca | San Nicolás | indie / repertory | cinelorca.wixsite.com (VLM-extracted poster) |
| Cine Cosmos | Balvanera | indie / repertory | cinecosmos.uba.ar |
| Cine York | Olivos | indie / repertory | lumiton.ar |
| Centro Cultural Munro | Munro | indie / community | lumiton.ar |
| Lumiton | Munro | indie / museum | lumiton.ar |
| Cine Gaumont | San Nicolás | indie / repertory (INCAA) | cinegaumont.ar |
| CineArte Cacodelphia | San Nicolás | indie / repertory | cineartecacodelphia.com.ar (adro.studio JSON API) |
| Centro Cultural Borges | San Nicolás | indie / cultural center | centroculturalborges.gob.ar |

Each cinema has a dedicated provider module in [`src/providers/`](src/providers) that knows that venue's data shape. Three of the ten (Cine York, Munro, Lumiton) share `lumiton-agenda.ts` because Lumiton operates the three venues from one combined agenda page. Cine Lorca is the odd one out: its weekly programming lives on a single poster image (no HTML schedule, no API), so its provider downloads the image, hashes it for cache lookup, and on cache miss runs a Claude vision call (`temperature: 0`, structured JSON output) to extract the showtimes.

## Running locally

**Prerequisites:** Node 22 (there's an `.nvmrc` — `nvm use` will pick it up).

```bash
# 1. Install deps
npm install

# 1b. Wire up the pre-push hook (typecheck + lint + format + tests).
# One-time per clone; catches tsc errors and unformatted code before
# they reach Vercel. Skip a run with `git push --no-verify`.
git config core.hooksPath .githooks

# 2. Set up env
cp .env.example .env.local
# then edit .env.local:
#   DATABASE_URL=file:./local.db
#   TMDB_API_TOKEN=<get one at themoviedb.org/settings/api>
#   ANTHROPIC_API_KEY=<get one at console.anthropic.com> (only for Cine Lorca)

# 3. Migrate the schema + seed baseline data
npm run db:generate    # generate any pending Drizzle migrations
npm run db:migrate     # apply them to local.db
npm run db:seed-cinemas  # seeds cinemas table (safe to run repeatedly)

# 4. Run the scraper to populate real programming
npm run db:scrape

# 5. Start the dev server
npm run dev
# → http://localhost:3000
```

## Architecture, briefly

```
┌─────────────────────────────────────────────────────────────────┐
│  npm run db:scrape                                              │
│                                                                 │
│  ┌────────────────┐    ┌────────────────┐    ┌────────────────┐ │
│  │ Provider       │─┬─▶│ Ingest         │───▶│ TMDB enrich    │ │
│  │ (per cinema)   │ │  │ (upsert films  │    │ (poster, dir,  │ │
│  │                │ │  │  + screenings) │    │  runtime, cast,│ │
│  └────────────────┘ │  └────────────────┘    │  synopsis,     │ │
│        ×7           │                        │  ambiguity     │ │
│                     │                        │  guard + dir.  │ │
│                     │                        │  verification) │ │
│                     │                        └────────────────┘ │
│                     ▼                                           │
│              ┌──────────────┐                                   │
│              │ scrape_runs  │   ← observability: one row per    │
│              │ (audit log)  │     (cinema, run), status, counts │
│              └──────────────┘                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Next.js server component (src/app/page.tsx) — homepage         │
│                                                                 │
│  getWindowScreeningsByFilm(window, now) → one row per FILM,     │
│                                  bounded by ?ventana= window    │
│  getFeaturedFilms(now)         → "Destacados" curated band      │
│  getJsonLdScreenings(now)      → structured-data feed           │
│                                                                 │
│  Group-by-film: single-showtime → inline time·venue; multi →   │
│  tap-expand disclosure. Window registry: src/lib/windows.ts.   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Next.js server component (src/app/cartelera/page.tsx)          │
│                                                                 │
│  getTwoWeeksScreenings(now)    → Tier 1 · 14-day rolling window │
│  getUpcomingScreenings(now)    → Tier 2 · Próximamente          │
│  getLastScreeningPerFilm(now)  → ÚLTIMA FUNCIÓN pill anchor     │
│                                                                 │
│  The exhaustive day-by-day view: sticky-date-strip navigation, │
│  full cards grouped by day in tier 1, text index in tier 2.    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Next.js server component (src/app/pelicula/[slug]/page.tsx)    │
│                                                                 │
│  getUpcomingScreeningsByFilm(slug, now)                         │
│                                                                 │
│  Cross-venue all-screenings list — the "when else?" answer.     │
│  Same code paths reach a `/pelicula/<slug>` URL from any        │
│  cartelera card; one tap takes you there.                       │
└─────────────────────────────────────────────────────────────────┘
```

Each provider returns a flat `ScrapedScreening[]`. The ingest layer handles idempotency (unique index on `(scraped_title, scraped_year)`), retry semantics (`match_source='none-attempted'` after a failed TMDB match so we don't re-query forever), and year-resolution merges (if Lumiton scrapes *Lawrence de Arabia* with year=null and Lugones scraped it with year=1962, they reconcile into one row on TMDB enrichment via `tmdb_id` collision).

The homepage is a window-scoped, one-row-per-film view anchored to BA "today" (default window **Hoy**); `/cartelera` is the exhaustive 2-tier view — *Tier 1* (full cards in a 14-day rolling window, the decision layer) and *Próximamente* (text index for everything beyond). Both read the same DB and revalidate together after a scrape. See [DESIGN.md](DESIGN.md) for the full visual hierarchy and [CHANGELOG.md](CHANGELOG.md) for the per-release version history.

## Tests

```bash
npm test                 # watch mode
npm run test:coverage    # one-shot with v8 coverage
```

~645 tests across 35 test files. The homepage-redesign suites:

- `src/db/group-by-film.test.ts` — film grouping, next-catchable sort, past-film sink ordering
- `src/lib/windows.test.ts` — window registry + `?ventana=` resolution (unknown → `hoy`) + render modes
- `src/app/_components/film-row-model.test.ts` — single vs multi-showtime row model, disclosure summary
- `src/lib/film-meta.test.ts` — film metadata line (drops 0/null runtime cleanly, ISSUE-001 guard)

The rest:

- `src/app/layout-invariants.test.ts` — flex-item width contracts (mobile-overflow guard) + line-clamp/display-utility co-location guard
- `src/db/queries.test.ts` — query-layer behavior (visibility windows, deduplication)
- `src/lib/iso-week.test.ts` — ISO-week anchoring in BA timezone (edition Nº arithmetic)
- `src/lib/date-ranges.test.ts` — tier query-bound helpers (14-day window / upcoming)
- `src/lib/slug.test.ts` — slug generation contract
- `src/providers/lugones.test.ts` — complejoteatral.gob.ar parser + cross-month date-range regression
- `src/providers/lumiton-agenda.test.ts` — shared agenda parser, venue filtering, detail-page enrichment
- `src/providers/cine-york.test.ts` — Lumiton agenda filtering + extraction edge cases
- `src/providers/cine-cosmos.test.ts` — cinecosmos-uba.com.ar parser
- `src/providers/cine-lorca.test.ts` — VLM showtime extraction (poster JSON contract)
- `src/providers/cine-lorca-cache.test.ts` — image-hash cache invalidation (avoids re-billing the same poster)
- `src/providers/malba.test.ts` — S1 (dense-cycle) + S2 (single-event / grouped-times) strategies
- `src/scrapers/ingest.test.ts` — upsert, TMDB retry semantics, merge-on-collision via tmdb_id
- `src/scrapers/run-log.test.ts` — `scrape_runs` observability lifecycle
- `src/tmdb/match.test.ts` — title+year matcher, title-ambiguity guard, popularity tiebreak
- `src/tmdb/enrich.test.ts` — enrichment pipeline + director-verification rescue

Fixtures under [`test/fixtures/`](test/fixtures) are real HTML captures from each source (and a real poster image for Cine Lorca), stored verbatim so tests don't hit the network or burn vision-call credits.

## Credits

This product uses the TMDB API but is not endorsed or certified by TMDB.

[TMDB](https://www.themoviedb.org) provides the film metadata, poster images, and editorial stills rendered alongside each screening. Afiche hotlinks TMDB's CDN (image.tmdb.org/t/p/w342{poster_path}) rather than re-hosting, per TMDB's best-practice guidance, and never resells or commercially redistributes TMDB data.

Cine Lorca's image-only weekly programming is extracted via [Anthropic's Claude](https://www.anthropic.com/) vision API. The image is hashed and the result is cached locally, so a given poster is parsed at most once across the project's lifetime.

## Roadmap

See [TODOS.md](TODOS.md) for the full backlog. The big structural items:

1. **Indexability strategy for `/pelicula/<slug>`** — the per-film pages are currently `noindex` to protect against flap-404 SEO penalties when films leave BA. Question is whether to pivot to indexable + persistent pages (canonical BA cinema index) or stay on the curated-channels-only path. Captured as TODO #19 with the full decision factors; revisit via `/office-hours`. (Multiplex chains like Cinépolis remain intentionally out of scope — see "What it does NOT do".)
2. **MALBA recurring-weekly cycles** (S3) — the parser handles dense-cycle (S1) and single-event prose (S2) but not "Sábados a las 18:00" recurrence grammars. Trigger-gated on real warning data from `scrape_runs`.

Plus smaller polish items: a `/admin/runs` log viewer, .ics calendar export per screening, expanded TMDB enrichment (prizes/tagline), card-composition rethink, X presence + newsletter (#16, #17).

## License

No license file yet — for the moment treat this as "all rights reserved" by default. Will add MIT (or similar) shortly.

## Contact

Built by [Benjamin Delasoie](https://github.com/benjamindelasoie). Issues welcome on GitHub if you're a BA cinephile who notices a screening Afiche missed or got wrong.
