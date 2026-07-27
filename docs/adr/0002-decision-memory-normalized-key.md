# 0002 — Operator match/skip decisions live in a normalized-key decision store, not on the film row

Scraped titles drift across runs and venues (casing, punctuation, added
subtitles — `PADRE, MADRE, HERMANA, HERMANO` vs `PADRE MADRE HERMANA HERMANO`,
`BACKROOMS` vs `Backrooms: Sin salida`), so the same film is re-inserted under
a fresh `films` row each scrape. TMDB-matchable films self-heal via the
`tmdb_id`-collision merge; films that *miss* TMDB — exactly the ones an operator
hand-matches — have no id to merge on, so the new unenriched row steals the
screenings and the manual fix is orphaned on the old row. Recording the
operator's choice only on the volatile film row therefore loses it on the next
scrape. (This is the "third mechanism" the closed `mutable_key_upsert_bug`
memory told us to look for, beyond the key-shift and value-overwrite bugs.)

**Decision:** persist operator decisions (a TMDB assignment, or a "not a film"
Skip) in a dedicated store keyed by **Match key** — the normalized title
(`normalize()` in `src/tmdb/similarity.ts`), a derived comparison key.
Enrichment consults it first, at the existing override seam (`enrich.ts`
`findOverride`), so any future drifted row re-applies the decision *by
construction* and then merges into the canonical film. This supersedes the
file-based `tmdb-overrides.json` — "Approach B" in the 2026-05-20 design doc —
extended with the normalized key it lacked. Applying a decision yields
`match_source = override`.

## Invariants this locks in (each cost real debugging)

- **Never rewrite or re-key `scraped_title`.** Match keys are lookup-only,
  derived from it, never written back. Re-casing a scraped title changes the
  upsert target and drops enrichment (the shelved "Lorca casing" trap).
- **Do not normalize the `(scraped_title, scraped_year)` upsert key.** Distinct
  films can share a normalized title; collapsing them at the identity key would
  merge unrelated works. The normalized key belongs in the decision store, not
  the identity key.
- **Merges stay lower-id-wins** (slug stability — `/pelicula/<slug>` URLs are
  the contract). The decision store, not merge behavior, is what preserves human
  choices, so a manual row deleted in a merge simply has its decision re-applied.

## Considered and rejected

- **Normalizing the upsert key** — violates the invariants above.
- **Carrying enrichment across merges** — fragile; the decision store makes it
  unnecessary.

## Consequence

TMDB-matchable films still re-insert-and-merge every run (~15/run, visible in
`scrape_runs.warnings`). That churn is harmless and we deliberately leave it —
we fix *correctness* (the orphaned manual fix), not the churn.
