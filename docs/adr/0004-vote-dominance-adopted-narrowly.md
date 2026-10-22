# 0004 — Adopted, narrowly: vote-count dominance breaks a title tie no director can

**Status: accepted** (measured 2026-09-08, shipped as matcher v8).
Revisits ADR-0003, which rejected this rule in its general form.

`pickBestMatch`'s no-year ambiguity guard refuses to auto-pick when two
candidates tie on title similarity, so the director-pivot rescue can
disambiguate against TMDB credits. That is the right order — a director is
better evidence than any audience signal — but it assumes a director hint
exists. With none, the guard had nothing to hand off to and the film became a
**permanent** miss. Every film carrying a namesake, from a source that publishes
neither year nor director, hit this: Passline (Cinta) publishes neither.

**Decision:** when, and only when, the tie band has no director hint to rescue
with, break the tie on **vote count** (`dominantByVotes`, `src/tmdb/match.ts`).
A director hint still short-circuits the rule and wins outright.

Three constraints keep it inside what ADR-0003 measured as safe:

- **Vote count, not popularity.** Popularity is a recency/buzz score that decays
  with age — it is precisely what picked Eggers 2024 over Herzog 1979, the
  mispick this guard exists to prevent. Vote count is a notability proxy that
  does not decay, so a 1927 classic keeps its weight.
- **A decisive margin** (`TITLE_DOMINANCE_RATIO = 4`) *and* real notability
  (`TITLE_MIN_VOTE_COUNT = 100`). A runaway ratio between two unknowns (12 votes
  to 1) says nothing.
- **Genuine ambiguity still parks the row.** Measured against live TMDB, the
  ratio separates the populations cleanly — *Midnight in Paris* 7870:0, *Lost in
  Translation* 8296:0, *Walter Mitty* 8460:142 and *Metropolis* 3187:579 all
  resolve, while *Nosferatu* at 3944:2523 lands at 1.6x and stays held. The bug
  class of TODOS.md #18 survives the change, which is the test of the rule.

**Why this is not what 0003 rejected.** 0003 measured dominance as a *general*
tiebreak — applied ahead of, or instead of, the operator — and replaying it over
the manual fixes scored 3 right to 3 wrong, a coin flip. This version fires only
in the branch where the alternative is not an operator decision but a permanent
miss, and only past a margin and a notability floor 0003 did not test. The
alternative it competes with is worse in both directions: without it, a
canonical film sits in `/admin/unmatched` forever.

The same rule and the same constants are re-used one layer up by the self-heal
apply gate (`src/scrapers/self-heal.ts`), which arrived at it independently for
the same reason. The constants live in `match.ts` so the two cannot drift apart.
