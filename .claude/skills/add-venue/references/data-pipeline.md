# Phases 2 & 4 — Seed, wire, run, ingest, TMDB

Covers the cinema identity row (Phase 2) and how a scrape becomes rows the site
renders, plus TMDB matching (Phase 4). Read the § Ingest gotchas before changing
ingest code.

## § Seed — the cinema row (Phase 2)

A venue's identity lives in the `cinemas` DB table, seeded from
`src/db/seed-cinemas.ts`. Add an entry to the `CINEMAS` array:

```ts
{
  id: 'my-venue',                 // slug; MUST match your Provider.id + screening.cinemaId
  name: 'My Venue',               // exactly as the venue brands itself
  neighborhood: 'Palermo',        // barrio
  type: 'indie',                  // 'indie' (the product) — 'chain' only for legacy rows
  address: 'Calle Falsa 123',     // VERBATIM from the source (drives the Maps link)
  ticketingBaseUrl: 'https://…',  // official programming/tickets page
}
```

Then seed:

```bash
npm run db:seed-cinemas          # local
npm run db:seed-cinemas:prod     # prod (Turso), after merge
```

**The seed is `onConflictDoNothing` — it will NOT update an existing row.** To
correct an already-seeded cinema's metadata (name/address/neighborhood), run a
direct `UPDATE` (one-off `tsx` script or Drizzle Studio: `npm run db:studio`),
because re-seeding is a no-op on existing ids. The seed values are the source of
truth for fresh environments; keep them in sync with any correction.

## § Wire it in (Phase 4) — `src/scrapers/run.ts`

Two edits:

```ts
import { myVenueProvider } from '@/providers/my-venue';   // 1. import
// …
const providers: Provider[] = [
  // …existing…
  myVenueProvider,                                          // 2. add to the array
];
```

The runner iterates all providers sequentially: `provider.fetch()` →
`ingest(result)` → per-cinema summary; it records each run in `scrapeRuns` and
exits non-zero if any provider fails.

## § Run

```bash
npm run db:scrape            # fetch + ingest + enrich, all providers
npm run db:rescrape          # reset future screenings, then scrape (clean slate)
npm run db:reset-programming # delete future screenings (keeps films), reset enrich state
npm run db:enrich            # re-run TMDB enrichment on pending films only
npm run db:inspect-unmatched # list films stuck unmatched
npm run scrape:prod          # prod scrape from a residential IP + revalidate ISR
```

## § Ingest — what happens to a scrape (read before editing ingest)

`src/scrapers/ingest.ts` runs a 5-step sequence per provider result: record the
run → upsert films → replace future screenings → enrich pending films (TMDB) →
mark success. The two idempotency keys and one SQL gate below are load-bearing —
they're the fix for a real duplicate-films / data-clobber bug class.

**Films upsert key — `(scrapedTitle, scrapedYear)`, both immutable**
(`uniqueIndex('films_scraped_title_scraped_year_idx')`).
- `scrapedYear` is set once at first insert and never changes. The mutable `year`
  is filled by enrichment. **Never key the upsert on `year`** — a re-scrape that
  emits `year` differently (or null) would create a duplicate row.

**Scraper writes are CASE-gated so they can't clobber enriched/operator data**
(`src/scrapers/ingest/films.ts`, `buildUpdateSet`):

```ts
set.director = sql`CASE WHEN ${films.matchSource} IN ('manual','auto','override')
                     THEN ${films.director}        -- keep TMDB/operator value
                     ELSE ${s.director} END`;       -- else take the scrape
```

Same gate for `titleOriginal` and `runtimeMin`. `synopsisEs` is exempt — the
venue's es-AR synopsis always wins over TMDB's peninsular Spanish. If you add a
field that BOTH the scraper and enrichment write, gate it the same way.

**Screenings dedup key — `(filmId, cinemaId, startsAtUtc)`**
(`uniqueIndex('screenings_unique_idx')`). Re-scrape uses `onConflictDoUpdate` to
refresh `programName`, `sourceUrl`, `tags`, `scrapedAt` (so a multi-week cycle
gets its program name on the second pass); identity columns never change.

## § TMDB matching & enrichment (`src/tmdb/`, `src/scrapers/ingest/enrichment.ts`)

- Enrichment searches TMDB by `(title, year)` in `es-AR`, scores candidates with
  Jaro-Winkler on title + original_title, requires year within ±1, and accepts a
  match only above `MATCH_CONFIDENCE_THRESHOLD` (`src/tmdb/match.ts`). Ambiguous
  ties are rejected.
- The `director` / `filmTitleOriginal` your scraper provides are passed as
  **hints**: a borderline match is rescued by matching the director against TMDB
  credits. **The more accurate metadata your provider emits, the smaller
  `/admin/unmatched` is.** This is why fixing the scraper beats LLM workarounds.
- A successful match writes poster/backdrop/cast/genres/synopsis and sets
  `matchSource` to `auto`. Merge-on-collision: if two films resolve to the same
  `tmdbId`, the lower id wins (preserves slug stability) and screenings re-point.
- Enrichment runs inside ingest, and standalone via `npm run db:enrich`.

## § When the scraper can't match (Phase 6 follow-up)

Films with no confident TMDB match (`tmdbId IS NULL`, not `skipTmdb`) and a
future screening show up at **`/admin/unmatched`**. The operator searches TMDB
and assigns an id; that runs `enrichByTmdbId` and sets `matchSource='manual'`.
A handful of art films / one-offs is expected. A flood signals a parsing bug —
go fix the provider, don't grind through the admin UI.

## § Schema quick reference (`src/db/schema.ts`)

- `cinemas` — `id` (PK, slug), `name`, `neighborhood`, `type` ('indie'|'chain'),
  `address`, `ticketingBaseUrl`.
- `films` — `id` (PK), `title`/`slug`, `scrapedTitle`+`scrapedYear` (immutable
  upsert key), mutable `year`/`director`/`country`/`runtimeMin`/`synopsisEs`,
  `tmdbId`, `matchSource`, `skipTmdb`, poster/backdrop/cast/genres.
- `screenings` — `id`, `filmId`→films, `cinemaId`→cinemas, `startsAtUtc` (UTC),
  `tags`, `programName`, `sourceUrl`. Unique on `(filmId, cinemaId, startsAtUtc)`.
- `providers` — one row per provider (= cinema id): `lastRunAt`, `lastSuccessAt`,
  `lastError`, `screeningCount`, plus `lastImageSha256`/`lastImageParsed` (Lorca
  vision cache).
- `scrapeRuns` — one row per cinema per run (status, counts, warnings) for the
  admin dashboard.

Then: fill the venue's "about" content — [venue-info.md](venue-info.md).
