# Afiche

**Cartelera curada de Buenos Aires — cine más allá de la pochoclera.**

Afiche aggregates the weekly programming of Buenos Aires' independent and repertory cinemas into one clean, editorial-feel cartelera — a three-tier view (Esta semana → Este mes → Próximamente) that steps down in density as the horizon grows. Built for people who already know the difference between a Saturday at Lugones and a Saturday at Hoyts.

![Afiche week view](docs/screenshots/hero-desktop.png)

> [!NOTE]
> Afiche is a personal project, now **live at [afiche.vercel.app](https://afiche.vercel.app)** (Next.js on Vercel + libSQL on Turso). The cron that refreshes prod runs from the dev machine (`npm run scrape:prod`), not GitHub Actions — runner IPs get 403'd by Cloudflare at lumiton.ar and complejoteatral.gob.ar. See [DEPLOY.md](DEPLOY.md) for the full ops setup. You can also clone the repo and run everything locally against a SQLite file — same code path, no Turso token needed.

## What it does

- **Scrapes 5 indie cinemas** every run: Sala Lugones, MALBA (two schedule formats), Cine York, Centro Cultural Munro, and the Lumiton flagship venue.
- **Enriches each film via TMDB**: poster, director, runtime, country, original title. Smart merge logic handles the case where the same film surfaces without a year at one cinema and with a year at another.
- **Renders a three-tier cartelera** — a server-rendered Next.js 16 page. *Esta semana* shows full cards grouped by day (the decision layer). *Este mes* compresses to compact cards for the rest of the current month. *Próximamente* is a flat text index for everything beyond, zine-back-page style. Chain cinemas (when we add them) get a de-emphasized typographic treatment, not a hidden toggle — curation is visible.

## What it does NOT do (yet)

- No filters, search, or cinema-specific pages — the three-tier cartelera is the whole product right now.
- No film detail pages — clicking a screening card opens the source ticketing URL.
- **Cinépolis Recoleta is not yet supported** — their entire infrastructure is behind Cloudflare bot protection. Adding them requires Playwright + stealth, tracked in [TODOS.md](TODOS.md#1).
- No dark mode — the editorial cream + carmine palette is the brand.

## Stack

- **Next.js 16** (App Router, Server Components)
- **React 19** + **Tailwind CSS 4** (design tokens via `@theme`)
- **Geist** + **Geist Mono** typography
- **Drizzle ORM** + **libSQL** (SQLite locally, targeting Turso for prod)
- **cheerio** for HTML scraping
- **Vitest** for testing (134 tests across date helpers, scraper providers, ingest, run logging, and TMDB enrichment)
- **TMDB API** for film enrichment

## Cinemas covered

| Cinema | Neighborhood | Type | Source |
|---|---|---|---|
| Sala Lugones | San Nicolás | indie / repertory | complejoteatral.gob.ar |
| MALBA | Palermo | indie / museum | malba.org.ar |
| Cine York | Olivos | indie / repertory | lumiton.ar |
| Centro Cultural Munro | Munro | indie / community | lumiton.ar |
| Lumiton | Vicente López | indie / museum | lumiton.ar |

Each cinema has a dedicated provider module in [`src/providers/`](src/providers) that knows that venue's HTML structure. Three of the five share `lumiton-agenda.ts` because Lumiton operates Cine York, Munro, and its flagship space from one combined agenda page.

## Running locally

**Prerequisites:** Node 22 (there's an `.nvmrc` — `nvm use` will pick it up).

```bash
# 1. Install deps
npm install

# 2. Set up env
cp .env.example .env.local
# then edit .env.local:
#   DATABASE_URL=file:./local.db
#   TMDB_API_TOKEN=<get one at themoviedb.org/settings/api>

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
│  │                │ │  │  + screenings) │    │  runtime, year)│ │
│  └────────────────┘ │  └────────────────┘    └────────────────┘ │
│        ×5           │                                           │
│                     ▼                                           │
│              ┌──────────────┐                                   │
│              │ scrape_runs  │   ← observability: one row per    │
│              │ (audit log)  │     (cinema, run), status, counts │
│              └──────────────┘                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Next.js server component (src/app/page.tsx)                    │
│                                                                 │
│  getThisWeekScreenings(now)    → Tier 1 · Esta semana           │
│  getThisMonthScreenings(now)   → Tier 2 · Este mes              │
│  getUpcomingScreenings(now)    → Tier 3 · Próximamente          │
│                                                                 │
│  Three tiered queries, ISO-week-anchored, step-down density.    │
└─────────────────────────────────────────────────────────────────┘
```

Each provider returns a flat `ScrapedScreening[]`. The ingest layer handles idempotency (unique index on `(scraped_title, year)`), retry semantics (`match_source='none-attempted'` after a failed TMDB match so we don't re-query forever), and year-resolution merges (if Lumiton scrapes Lawrence de Arabia with year=null and Lugones scraped it with year=1962, they reconcile into one row on TMDB enrichment).

The view splits the cartelera into three tiers — *Esta semana* (full cards, the decision layer), *Este mes* (compact cards, planning), *Próximamente* (text index, awareness) — so the zine metaphor holds: Edición Nº N IS tier 1. See [DESIGN.md](DESIGN.md) for the full hierarchy.

## Tests

```bash
npm test                 # watch mode
npm run test:coverage    # one-shot with v8 coverage
```

134 tests across:

- `src/lib/iso-week.test.ts` — ISO-week anchoring in BA timezone (edition Nº arithmetic)
- `src/lib/date-ranges.test.ts` — Tier 1/2/3 query-bound helpers (this-week / this-month / upcoming)
- `src/providers/lugones.test.ts` — complejoteatral.gob.ar parser + cross-month date-range regression
- `src/providers/lumiton-agenda.test.ts` — shared agenda parser, venue filtering, detail-page enrichment
- `src/providers/cine-york.test.ts` — filter + extraction + edge cases
- `src/providers/malba.test.ts` — S1 (dense-cycle) + S2 (single-event / grouped-times) strategies
- `src/scrapers/ingest.test.ts` — upsert, TMDB retry semantics, merge-on-collision
- `src/scrapers/run-log.test.ts` — scrape_runs observability lifecycle
- `src/tmdb/match.test.ts` — title+year matcher against TMDB
- `src/tmdb/enrich.test.ts` — enrichment pipeline (poster, director, runtime, country)

Fixtures under [`test/fixtures/`](test/fixtures) are real HTML captures from each source, stored verbatim so tests don't hit the network.

## Credits

This product uses the TMDB API but is not endorsed or certified by TMDB.

[TMDB](https://www.themoviedb.org) provides the film metadata and poster images rendered alongside each screening. Afiche caches the posters to its own CDN rather than hot-linking, per TMDB's best-practice guidance, and never resells or commercially redistributes TMDB data.

## Roadmap

See [TODOS.md](TODOS.md) for the full backlog. The two big structural items:

1. **Cinépolis Recoleta scraper** — currently blocked on Cloudflare bot protection; needs Playwright + stealth tooling.
2. **TMDB match-rate revisit** — deferred until Cinépolis data lands. The match rate is heavily weighted by Lugones' classic-rep programming (Argentine-distributor Spanish titles that TMDB doesn't index).

Plus a handful of smaller items queued behind those: MALBA S3 (recurring-weekly cycles), MALBA 24:00 midnight parsing, Lumiton detail-page synopsis enrichment, a `/admin/runs` log viewer, film-level discovery ("última función" + same-film repeats), and a card-composition rethink now that the cartelera is all-indie.

## License

No license file yet — for the moment treat this as "all rights reserved" by default. Will add MIT (or similar) shortly.

## Contact

Built by [Benjamin Delasoie](https://github.com/benjamindelasoie). Issues welcome on GitHub if you're a BA cinephile who notices a screening Afiche missed or got wrong.
