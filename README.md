# Afiche

**Cartelera curada de Buenos Aires — cine más allá de la pochoclera.**

Afiche aggregates the weekly programming of Buenos Aires' independent and repertory cinemas into one clean, editorial-feel week view. Built for people who already know the difference between a Saturday at Lugones and a Saturday at Hoyts.

![Afiche week view](docs/screenshots/hero-desktop.png)

> [!NOTE]
> Afiche is a personal project, currently in a **pre-deploy local-only** state. The scraper and UI work end-to-end against a local SQLite database; the production hosted version is coming. If you clone this repo today, you can run the whole thing locally against real scraped data.

## What it does

- **Scrapes 5 indie cinemas** every run: Sala Lugones, MALBA (two schedule formats), Cine York, Centro Cultural Munro, and the Lumiton flagship venue.
- **Enriches each film via TMDB**: poster, director, runtime, country, original title. Smart merge logic handles the case where the same film surfaces without a year at one cinema and with a year at another.
- **Renders a week view** — a server-rendered Next.js 16 page showing every upcoming screening grouped by day, with indie cinemas prominently featured (poster + synopsis + time) and chain cinemas rendered in a de-emphasized form.

## What it does NOT do (yet)

- No filters, search, or cinema-specific pages — the week view is the whole product right now.
- No film detail pages — clicking a screening card opens the source ticketing URL.
- **Cinépolis Recoleta is not yet supported** — their entire infrastructure is behind Cloudflare bot protection. Adding them requires Playwright + stealth, tracked in [TODOS.md](TODOS.md#1).
- No dark mode — the editorial cream + carmine palette is the brand.

## Stack

- **Next.js 16** (App Router, Server Components)
- **React 19** + **Tailwind CSS 4** (design tokens via `@theme`)
- **Geist** + **Geist Mono** typography
- **Drizzle ORM** + **libSQL** (SQLite locally, targeting Turso for prod)
- **cheerio** for HTML scraping
- **Vitest** for testing (58 tests across scraper providers, ingest, and TMDB enrichment)
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
│  getThisWeeksScreenings() → groups by day → renders week view   │
└─────────────────────────────────────────────────────────────────┘
```

Each provider returns a flat `ScrapedScreening[]`. The ingest layer handles idempotency (unique index on `(scraped_title, year)`), retry semantics (`match_source='none-attempted'` after a failed TMDB match so we don't re-query forever), and year-resolution merges (if Lumiton scrapes Lawrence de Arabia with year=null and Lugones scraped it with year=1962, they reconcile into one row on TMDB enrichment).

## Tests

```bash
npm test                 # watch mode
npm run test:coverage    # one-shot with v8 coverage
```

58 tests across:

- `src/providers/lumiton-agenda.test.ts` — shared agenda parser, venue filtering
- `src/providers/cine-york.test.ts` — filter + extraction + edge cases
- `src/providers/malba.test.ts` — S1 (dense-cycle) + S2 (single-event / grouped-times) strategies
- `src/scrapers/ingest.test.ts` — upsert, TMDB retry semantics, merge-on-collision
- `src/scrapers/run-log.test.ts` — scrape_runs observability lifecycle

Fixtures under [`test/fixtures/`](test/fixtures) are real HTML captures from each source, stored verbatim so tests don't hit the network.

## Credits

This product uses the TMDB API but is not endorsed or certified by TMDB.

[TMDB](https://www.themoviedb.org) provides the film metadata and poster images rendered alongside each screening. Afiche caches the posters to its own CDN rather than hot-linking, per TMDB's best-practice guidance, and never resells or commercially redistributes TMDB data.

## Roadmap

See [TODOS.md](TODOS.md) for the current backlog. Two remaining items as of April 2026:

1. **Cinépolis Recoleta scraper** — currently blocked on Cloudflare bot protection; needs Playwright + stealth tooling.
2. **TMDB match-rate revisit** — deferred until Cinépolis data lands. The match rate is heavily weighted by Lugones' classic-rep programming (Argentine-distributor Spanish titles that TMDB doesn't index).

## License

No license file yet — for the moment treat this as "all rights reserved" by default. Will add MIT (or similar) shortly.

## Contact

Built by [Benjamin Delasoie](https://github.com/benjamindelasoie). Issues welcome on GitHub if you're a BA cinephile who notices a screening Afiche missed or got wrong.
