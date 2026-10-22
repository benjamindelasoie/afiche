# Afiche

Afiche is a **cartelera** — a what's-on aggregator for independent cinemas in
Buenos Aires. It scrapes each venue's published programming, dedups showings
into canonical film records, enriches those records against TMDB, and renders
the combined listings for the public.

## Language

### Core entities

**Venue**:
Any organizer or place that programs and presents screenings — the broad,
canonical concept in code and data. Includes formal cinemas (MALBA, Sala
Lugones) and, in principle, looser presenters like a cineclub running
screenings in a Palermo bar. The DB table `cinemas` / `cinemaId` actually
holds venues; it is named after a subtype it outgrew (migration debt — see
ADR-0001), so `cinemaId` in code is the venue id, not a counter-signal.
_Display_: **sala** is the es-AR user-facing word (the `/sala/[id]` route,
"sobre la sala" pages). Use "sala" in UI copy, "venue" in code.

**Cinema**:
A _kind of_ venue — a formal, dedicated movie theatre. Not a synonym for
Venue: a cineclub presenting in a bar is a venue but not a cinema. Today every
venue we carry happens to be cinema-like, so the distinction is latent and not
yet modeled. When venue-kind is modeled, give it its own facet — do NOT
overload the existing `type: ['indie', 'chain']` column, which is a different
axis (ownership/scale, drives UX tier), orthogonal to cinema-vs-cineclub.

**Film**:
A canonical movie record — one row per distinct work, deduped across venues
and enriched from TMDB. The thing a `/pelicula/<slug>` page is about.
_Display_: **película**.
_Avoid_: movie, title (a "title" is a string on a film, not the film itself).

**Screening**:
A single dated showing of one film at one venue at one start time — the core
unit of the cartelera. Uniquely identified by (film, venue, start time).
_Display_: **función**.
_Avoid_: showing, showtime, session.

**Program**:
A named curatorial grouping a screening belongs to, as published by the venue
(e.g. "Retrospectiva David Lynch", "Olivera-Aries"). Stored denormalized on
the screening (`program_name`), not its own table yet.
_Display_: **ciclo** — the es-AR user-facing word for a program (see
`CiclosEnCurso`). Program and ciclo are the same concept in two registers.
_Avoid_: collapsing this with the `cycle` screening tag (see below) — they are
different axes.

### Scraping pipeline

**Provider**:
One venue's fetch unit. A pure function `fetch(): network → ScrapedScreening[]`
that knows how to read that venue's site and emit raw screenings. It never
touches the DB. One Provider per venue, in `src/providers/`.
_Avoid_: scraper (for the per-venue unit — see below).

**Scraping / Ingest**:
The orchestration around providers (`src/scrapers/`): run every provider, then
**ingest** the results — dedup screenings, upsert films, enrich, write to the
DB. "Provider" is the per-venue reader; "ingest" is the pipeline that drives
them. Don't call a Provider a "scraper".

**Enrichment**:
The best-effort pass that matches a film against TMDB and fills in metadata
(poster, director, year, synopsis, cast, ratings). Tracked per film by
`match_source` (`auto` / `override` / `manual` / `none` / `none-attempted`).
_Avoid_: matching (matching is one step inside enrichment).

**Scrape run**:
One recorded invocation of the pipeline for one venue — an immutable history
row (`scrape_runs`) with counts, timing, status, and warnings. Distinct from
the `providers` table, which holds only latest-state health per venue.

**Circuit breaker**:
The pre-write refusal in ingest that protects a venue's live schedule. Replacing
future screenings deletes the venue's existing ones first, so a provider that
silently broke against a site redesign would publish an empty venue; when the
fetch is empty and future rows exist, the replace is refused, the last good
schedule stands, and the run reports `circuitBroke`. Empty-only on purpose — a
smaller-but-nonzero fetch is genuinely ambiguous.

### Film identity, matching & operator decisions

**Scraped title**:
The raw title string a Provider emits for a film, exactly as the venue
published it. Volatile — the same film recurs under drifting strings across
runs and venues (casing, punctuation, added subtitles). With `scraped_year` it
forms the film's immutable upsert key: a record of what was seen, never
rewritten.
_Avoid_: treating a scraped title as the film's identity; "fixing" its casing
(that re-keys the row and silently drops its enrichment).

**Match key**:
The normalized form of a title — case-, accent-, and punctuation-folded via
`normalize()` (`src/tmdb/similarity.ts`) — used to test "same film" for lookups
and operator decisions. A derived comparison key only, never written back onto
a scraped title.
_Avoid_: slug (a match key tests equality; a slug is a URL).

**Match source**:
The provenance and lifecycle state of a film's TMDB link: `auto` (fuzzy-
matched), `override` (re-applied from a stored Decision), `manual` (operator
set the id directly on this row), `none` (not yet attempted), `none-attempted`
(attempted and missed — retryable as the matcher improves).
_Avoid_: reading `none-attempted` as "not a film" — that is Skip.

**Decision** (override):
A persisted operator judgment about a scraped title, keyed by Match key so it
survives title drift: either a TMDB assignment (re-applied as `match_source =
override`) or a Skip. The durable memory that makes a hand-match permanent and
self-reapplying across re-scrapes.
_Avoid_: conflating the Decision (stored, match-key-keyed) with a `manual`
match (entered directly on one film row).

**Skip**:
An operator judgment that a scraped row is not a film — a book talk, a "función
sorpresa", a cycle label — and must never be matched against TMDB (`skip_tmdb`).
A kind of Decision, so it too survives re-scrapes.
_Avoid_: `none` / `none-attempted` (those mean "a film we haven't matched", not
"not a film").

### Self-heal loop

**Stuck film**:
A film in the active-stuck pool — no TMDB match, at least one future screening,
not skipped and not hidden. The pool the heal works on, and the tail the loop
exists to shrink. A stuck film is a film we failed to match, never "not a film"
(that is Skip).

**Proposal**:
One judge output about one stuck film — a TMDB id, a confidence, and a
provenance: `candidate-judged` (picked off the shortlist the matcher already
fetched) or `web-researched` (found outside it). Provenance is load-bearing, not
metadata: only a candidate-judged proposal can ever be auto-applied.
_Avoid_: reading a proposal as a match — it is a suggestion until the gate rules
on it.

**Corroboration gate**:
The deterministic classifier (`classifyProposal`) that turns a Proposal into
either an auto-apply or a queued item for a human. The model proposes; the gate
decides. Confidence alone never suffices — a second, independent signal (the
year or the director agreeing, or an exact dominant title) has to hold too.
_Avoid_: "the model decides" — no write in the loop has a model in it.

**Machine override**:
A row in `tmdb_overrides` written by the heal when a Proposal clears the gate.
Durable across `reset-programming`, unioned with the hand-curated
`tmdb-overrides.json` seed, and always the loser on a key conflict — a human
correction outranks a machine one by construction.
_Avoid_: conflating it with a Decision (an operator judgment) — same seam,
different authority.

**Heal run**:
One recorded invocation of the heal (`heal_runs`) with its applied / queued /
error counts — the loop's own history row, read back as a 7-day trend in the
digest. The `scrape_runs` analogue for the healing pass.

**Non-film container**:
A scraped title that names a programme or competition rather than a work —
a shorts block, "PROGRAMA I", a competition selection. It has no TMDB entry to
find, so it leaves the queue instead of being judged forever
(`isNonFilmContainer`).
_Avoid_: Skip (an operator's judgment on one title) — a container is recognized
by rule, on the noise-stripped title.

### Screening tags vs. program

**Screening tag**:
A per-screening label on an orthogonal axis from Program — the *kind* of
showing, not the curatorial grouping. Vocabulary: `unique` (ÚNICA FUNCIÓN),
`restored` (COPIA RESTAURADA), `retrospective`, `premiere` (ESTRENO), `cycle`
(CICLO), `vos` (versión original subtitulada), `dubbed`.
_Note_: the `cycle` and `retrospective` tags mark a screening as *belonging to
some* cycle/retrospective; the **Program** field names *which one*. A screening
can carry the `cycle` tag and a `program_name`; they are not redundant.

### Homepage curation

**Curated band**:
The "Destacados" / "Esta semana" hero row on the homepage — a hand-and-signal-
curated strip of featured films above the main grid (`CuratedBand`).
_Avoid_: using "band" for anything else in domain language. (The codebase also
uses "band" for a viewport region in `DateStrip` — that's an internal UI term,
not a domain concept.)

**Featured pick**:
One film selected into the curated band, with a reason it qualifies (premiere,
Argentinian slot, classic). The unit `CuratedBand` renders.
