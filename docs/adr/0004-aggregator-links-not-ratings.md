# 0004 — Aggregator links on /pelicula, and why no rating figure

**Status: accepted** (measured 2026-09-08, shipped 2026-09-12).

`/pelicula/<slug>` now carries two outbound marks linking to the film on
Letterboxd and IMDb, drawn monotone in `currentColor`. It carries **no rating
figure from any source**, and deliberately so. This records the measurement, so
the next person reaching for ratings does not redo it.

## What was measured

Live catalog = 113 films with an upcoming screening and `hidden_at IS NULL`,
measured against prod.

| source | films rated | % of live | median sample\* | p25 sample\* |
| --- | --- | --- | --- | --- |
| Letterboxd | 67 | 59% | 5,877 | 1,722 |
| IMDb | 71 | 63% | 2,996 | 322 |
| TMDB (already stored) | 65 | 58% | 55 | 12 |

\* over each source's **rated** films only. Over all 113, TMDB's median vote
count is **6**.

On the 19 live films IMDb rates under 500 votes, Letterboxd also rates 13, and
on those 13 the medians run **Letterboxd 1,142 · IMDb 120 · TMDB 4**. Letterboxd
is the deepest source on exactly the Argentine premieres and obscure repertory
Afiche exists to surface — the opposite of its reputation as the niche one.

## Why no figure shipped

- **`films.vote_average` must never render as a quality signal.** A median
  sample of six votes. "La Negociación" reports 8.0 from a single vote; "A
  metros de distancia" reports 7.0 from four while IMDb reports 4.6 from a
  hundred and twenty. It is the worst of the three and it is the one already in
  the database, which is precisely the trap. It keeps no ranking role either —
  the Destacados band ranks on `popularity` and `vote_count`
  (`src/db/queries.ts`), never on `vote_average`.
- **IMDb's only free source is disproportionate.**
  `datasets.imdbws.com/title.ratings.tsv.gz` is 8.6 MB gzipped, 30 MB and
  1,711,900 rows uncompressed, to maintain roughly seventy numbers. Operator:
  *"It's an horrendous use case."*
- **Letterboxd's figure would require automated access their terms prohibit.**
  Verbatim: *"you must not employ any robot, spider, scraper, deep-link, or
  other automated data gathering or extraction tool, program, or algorithm to
  access, acquire, copy, or monitor any portion of the Service."* Their API is
  the authorized route but refuses *"private or personal projects"* by published
  policy (`letterboxd.com/api-beta/`), so no compliant automated path exists for
  a project like this one.

A full rating-cache design was written and reviewed before being cut: a
preserved `external_ratings` table, a fetch job chained into `scrape-cron.sh`,
a staleness window, a sample floor and a block detector. An outside-model review
argued it bought one fewer click on 59% of films in exchange for a table, a
migration, parsing, retention, alerting and a new failure path on the machine
that keeps the site current. The operator cut it to links.

**Rotten Tomatoes was rejected earlier and separately:** no identifier bridge
from `tmdb_id` or `imdb_id` to an RT slug, so it would need title-and-year fuzzy
matching — the problem this repo's matcher spent months on. Any future source
must key off an identifier already resolved, or it is out of scope by
construction.

## What shipped instead

Links only, derived from ids already on the row. No table, no migration, no
scheduled job, no third-party request, nothing that can go stale or be blocked.

- `letterboxd.com/tmdb/<tmdb_id>/` 302-redirects to the canonical film page.
  Letterboxd sources its film data from TMDB, so our `tmdb_id` is their key too
  — verified against all 86 TMDB-matched live films with zero misses.
- `imdb.com/title/<tconst>/`, where `tconst` is what `films.imdb_id` stores.

A link performs no automated access, so the terms question does not arise. The
links are exactly as correct as the poster and title already on the page, since
all three come from the same match — including when that match is `auto`, i.e.
fuzzy rather than human-verified.

**The identifiers reach the page via the `fetchRowsCached` mapper**
(`src/db/queries.ts`), not by widening the slug select in
`getUpcomingScreeningsByFilm` — that row is used only for `filmRow.id` and
discarded. Adding scalar columns to an existing select fans out nothing; the
hazard in that file is joining a table with many rows per film onto `fetchRows`,
which would duplicate showtimes across all of its call sites.

## Consequence for DESIGN.md

None. The 2026-04-25 rule — *"NO star ratings (we don't track them; never
imitate Letterboxd's posture)"* — remains literally true, and so does
`TODOS.md`'s "Letterboxd shows ratings (we don't)". An earlier revision of this
work planned to amend both. Links required no amendment.

## Revisit triggers

- Letterboxd grants API access (unlikely while the personal-project exclusion
  stands), which would make a figure compliant and cheap.
- Operator decides the long-tail depth is worth the machinery after all, in
  which case Letterboxd is the source and the measurement above is the argument.

Do **not** revisit by reaching for `films.vote_average`. It is already there,
already free, and already wrong.
