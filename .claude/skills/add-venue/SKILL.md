---
name: add-venue
description: >-
  Add a new indie cinema/venue to Afiche end-to-end: research its real info,
  seed the cinema row, write its scraper provider, wire it into the
  scrape→ingest→TMDB pipeline, fill its "sobre la sala" page, and QA.
when_to_use: >-
  Use when onboarding a new sala/cinema/venue to the cartelera, writing a new
  scraper provider, or wiring a venue into the ingest pipeline. Triggers:
  "add a cinema/venue/sala", "onboard <venue>", "scrape <venue>",
  "write a provider for <venue>".
argument-hint: "[venue name or URL]"
---

# Add a venue to Afiche

Onboarding a venue touches six layers, in order. Each phase below links to a
reference file with the detail and the real example files to copy. Work top to
bottom. Don't skip the scope check.

## Already wired (auto-filled at load)

```!
echo "Seeded cinemas:"; grep -oE "id: '[^']+'" src/db/seed-cinemas.ts | sed "s/id: '//; s/'//"
echo; echo "Provider files:"; ls src/providers/*.ts | grep -vE "\.test\.|types\.ts" | xargs -n1 basename | sed 's/\.ts$//'
```

If the venue you're adding is already in both lists, you're updating, not
onboarding — jump to the phase you need.

## Scope check (do this first)

- **Indie circuit only.** Afiche is "the indie-circuit cartelera," not "all BA
  cinema." Do NOT onboard multiplexes (Cinépolis, Showcase, Hoyts). If the venue
  is a chain, stop and confirm with the operator before any work.
- **One provider ≠ one venue.** A venue can need its own provider, or several
  venues can share one (the Lumiton family shares ONE agenda page, filtered by a
  location slug). Decide the venue↔provider mapping in Phase 1, before code.

## Phases

1. **Research** — who is this venue, what do we show, what's the scraper shape?
   Read [references/research.md](references/research.md).
2. **Seed the cinema row** — the identity record (`id`, `name`, `address`…).
   See [references/data-pipeline.md](references/data-pipeline.md) § Seed.
3. **Write the scraper** — a `Provider` that emits `ScrapedScreening[]` in UTC.
   Read [references/scraper.md](references/scraper.md).
4. **Wire + run** — register in `run.ts`, scrape, understand ingest + TMDB match.
   Read [references/data-pipeline.md](references/data-pipeline.md).
5. **Sobre la sala** — editorial "about" content for `/sala/[id]`.
   Read [references/venue-info.md](references/venue-info.md).
6. **QA + ship** — verify in the browser, test, deploy (below).

## Phase 6 — QA + ship

```bash
npm run db:scrape                  # run your provider for real
npm run typecheck && npx eslint .  # gate
npm run test                       # provider + ingest tests must pass
npm run dev                        # then browse /sala/<id>
```

Browser-verify with the `/browse` skill (never `mcp__claude-in-chrome__*`
directly):

- `/sala/<id>` renders: header (name, neighborhood, address→Maps link, Sitio
  oficial), the "sobre la sala" block, and the agenda with real screenings.
- A handful of screenings have correct BA-local date/time, title, poster, director.
- Film links (`/pelicula/<slug>`) resolve and show TMDB-enriched metadata.
- `/admin/unmatched` — films your scraper couldn't auto-match land here for
  manual assignment. A few is normal; a flood means a parsing bug.

Ship per the Afiche workflow: **a new scraper goes via branch + PR** (scrapers +
DB changes are the explicit exception to direct-to-main). The seed, venue-info,
and content edits ride along in the same PR. After merge, reseed and scrape prod:

```bash
npm run db:seed-cinemas:prod
npm run scrape:prod
```

## Top gotchas (each cost real debugging time)

1. **Copy names/addresses verbatim from the venue's own pages.** Guessed/secondhand
   addresses shipped wrong and sent people to the wrong place; the address drives
   the header's Google Maps link. Verify against the source, not memory.
2. **Times are UTC at the provider boundary.** Argentina is UTC−3, no DST.
   Convert BA-local → UTC (`+3h`) before emitting `startsAtUtc`. See
   `src/lib/date-ranges.ts` (`BA_TZ`, the `Date.UTC(y, m-1, d, h+3)` idiom).
3. **UA-spoof your fetches.** `complejoteatral.gob.ar` and `lumiton.ar` block
   bare/CI user-agents — send a realistic Chrome UA or you get 403s.
4. **The films upsert key is `(scrapedTitle, scrapedYear)`, both immutable.**
   Never key on the mutable `year` (enrichment fills it). Scraper writes are
   gated by a SQL CASE so a re-scrape can't clobber TMDB/operator data. Read
   [references/data-pipeline.md](references/data-pipeline.md) § Ingest before
   touching ingest.
5. **Never invent a ticket price; the final Spanish voice is the operator's.**
   Pull prices from the source; for paid venues we omit the number and link out
   (prices drift). Blurbs you draft are placeholders to be rewritten.
6. **Fix data quality at the scrape/parse layer first.** Reach for an LLM/vision
   step only when the source is image-only (e.g. Cine Lorca's poster OCR).
   Scraping is zero-cost; LLM workarounds paper over recurring parser bugs.

## Done when

- [ ] `cinemas` row seeded (local + prod), address verified against the source.
- [ ] Provider implements `Provider`, returns `ScrapedScreening[]` with UTC times.
- [ ] Provider registered in `src/scrapers/run.ts`.
- [ ] Fixture-based test in `src/providers/<id>.test.ts` (saved HTML in `test/fixtures/<id>/`).
- [ ] `npm run db:scrape` ingests real screenings; `/admin/unmatched` is sane.
- [ ] `src/data/venue-info.ts` entry (blurb + ticketing; price per the stance).
- [ ] `/sala/<id>` browser-verified; typecheck + eslint + tests green.
- [ ] Shipped via branch + PR; prod seeded + scraped.
