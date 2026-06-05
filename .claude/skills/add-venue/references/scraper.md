# Phase 3 — Write the scraper

A provider is **pure**: `(network) -> ScrapedScreening[]`. It fetches the venue's
programming and returns a flat list. It does NOT touch the DB — that's the ingest
layer's job (Phase 4).

## The contract (`src/providers/types.ts`)

Implement `Provider`; emit `ScrapedScreening[]` inside a `ProviderRunResult`.

```ts
export interface Provider {
  readonly id: string;   // MUST equal the cinemas.id you seeded in Phase 2
  readonly name: string; // human-readable, for logs
  fetch(): Promise<ProviderRunResult>; // must NOT throw — put errors in the result
}

export interface ProviderRunResult {
  cinemaId: string;
  screenings: ScrapedScreening[];
  success: boolean;       // false if fetch/parse hit a fatal error
  warnings: string[];     // non-fatal (e.g. one day's times unparseable)
  error?: string;         // fatal error message
}

export interface ScrapedScreening {
  cinemaId: string;            // = your cinemas.id
  filmTitle: string;           // raw title, VERBATIM from the page
  filmTitleOriginal?: string;  // original-language title if shown
  director?: string;
  year?: number;
  country?: string;
  runtimeMin?: number;
  startsAtUtc: Date;           // ALWAYS UTC (convert BA-local +3h)
  tags: ScreeningTag[];        // 'unique'|'restored'|'retrospective'|'premiere'|'cycle'|'vos'|'dubbed'
  synopsisEs?: string;
  sourceUrl: string;           // back-link to the page describing this screening
  filmDetailUrl?: string;      // optional per-film URL when sourceUrl is a cycle page
  programName?: string;        // curatorial cycle name → rendered as a pill
}
```

Read the real file for the authoritative, commented version — it may have grown.

## Pick the closest existing provider and copy it

Don't write from scratch. Match the venue's source shape to a battle-tested
provider and copy its structure:

| Source shape | Copy | Notes |
|---|---|---|
| HTML listing → per-film detail pages | `src/providers/lugones.ts` | Cheerio + a parser that walks each detail page; state machine for layout variants. |
| Listing → cycle/detail pages, a few layouts | `src/providers/malba.ts` | Multiple parse strategies + a `DETAIL_DELAY_MS` fetch delay to avoid 429s. |
| One shared agenda page, many venues, tagged by a location slug | `src/providers/lumiton-agenda.ts` (core) + thin wrappers `cine-york.ts`, `centro-cultural-munro.ts`, `lumiton.ts` | One parser, filtered per venue by a `data-locations` slug. Register one provider per venue; they share the parse. |
| Weekly day-of-week grid | `src/providers/cine-cosmos.ts` | Anchor on the cycle's start weekday in BA time; map "ju/vi/sá…" to offsets. |
| Image-only cartelera (a poster JPG) | `src/providers/cine-lorca.ts` | LAST RESORT. Claude vision + image-hash caching in the `providers` table. Only when there's no structured HTML. |

Each provider exports BOTH the `Provider` object (with async `fetch()`) AND its
pure parse functions (e.g. `parseDetailPage`, `parseAgenda`) so tests can run
them against saved HTML without the network.

## Fetching

- There's no central fetch helper; each provider has an inline `fetchText(url)`
  using native `fetch()`. Copy it.
- **Send a realistic Chrome `User-Agent`.** `complejoteatral.gob.ar` and
  `lumiton.ar` 403 bare/CI agents. This is the #1 "works locally, fails in CI"
  trap.
- Be polite: add a small delay between detail-page fetches (MALBA uses 500ms).

## Parsing

- HTML: use `cheerio` (`cheerio.load(html)`, jQuery-like API). Prefer stable
  hooks (data attributes, semantic classes) over brittle positional selectors.
- Dates/times: parse Spanish month names / day abbreviations, then convert
  **BA-local → UTC by +3h**. Argentina is UTC−3 with no DST, so the offset is
  constant. The idiom used across providers: `new Date(Date.UTC(y, m-1, d, h+3, min))`.
  See `src/lib/date-ranges.ts` for `BA_TZ` and the week-boundary helpers.
- Preserve `filmTitle` verbatim. Set `filmTitleOriginal`, `director`, `year`,
  `runtimeMin` when the page exposes them — they feed TMDB matching hints
  (Phase 4) and the disambiguation that keeps `/admin/unmatched` small.
- Set `programName` when the venue organizes screenings into a named cycle
  (renders as a pill). Leave it undefined for single-film venues.

## Test it (required) — `src/providers/<id>.test.ts`

Providers are tested against **saved HTML fixtures**, not the live network:

1. Save the real page(s) to `test/fixtures/<id>/` (e.g. `agenda-listing.html`).
   Capture them while researching in Phase 1.
2. In the test, read the fixture and call the pure parser. Pin "now" to a fixed
   date so date math is deterministic:
   ```ts
   const FIXED_NOW = new Date(Date.UTC(2026, 3, 1)); // anchor for relative dates
   const out = parseAgenda(fixture('agenda-listing.html'), []);
   expect(out).toHaveLength(8);                       // count
   expect(out[0].startsAtUtc.toISOString()).toBe(...); // UTC instant
   expect(out[0].filmTitle).toBe(...);               // extraction
   ```
3. Assert on: screening count, `startsAtUtc` (compare via `.toISOString()`),
   title/director/year extraction, `tags`, and `sourceUrl`. Add a regression
   test for any parsing quirk you had to special-case.

Model the test on `src/providers/lugones.test.ts` (detail-page + date-range
parsing) or `src/providers/cine-york.test.ts` (shared-agenda filter + UTC
assertions).

Next: wire it in and run it — [data-pipeline.md](data-pipeline.md).
