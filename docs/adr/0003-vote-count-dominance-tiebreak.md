# 0003 — Rejected: vote-count dominance tiebreak for no-year title ambiguity

**Status: rejected** (measured 2026-07-12, before implementation).

We considered adding a vote-count "dominance" tiebreak to `pickBestMatch`'s
no-year ambiguity guard (`src/tmdb/match.ts`): when two TMDB candidates tie on
title score, auto-pick the one that dominates on `vote_count` instead of
deferring to the operator. Motivated by an operator report that an all-caps
`RATATOUILLE` "only failed on the caps."

**Rejected after measuring against the real data:**

- The `RATATOUILLE` row (`scraped_title = RATATOUILLE`, `scraped_year = 2007`)
  already auto-matches cleanly — the matcher `normalize()`s (case-folds) before
  scoring, so caps are irrelevant. The example does not reproduce.
- Replaying the matcher over all 94 `manual` fixes: it already resolves **58 to
  the same film the operator chose, 0 to a wrong film**. Among the ambiguity-
  guard cases where dominance *would* apply, it matched **3 correctly and 3
  incorrectly** — a coin flip that would auto-introduce wrong matches, reopening
  exactly the class the guard exists to prevent (the Nosferatu 1979-vs-2024
  mispick, TODO #18).

The genuinely recurring toil is **not** auto-matchable: ~25 same-title no-year
films needing human judgment, cross-language titles TMDB can't find, and
non-films. Those are addressed by persisting the operator's decision once
(ADR-0002), not by a riskier auto-matcher.

**Adopted instead** (safe, measured auto-match wins): strip venue noise from the
*search query only* — never from `scraped_title` (recovers e.g. `LA QUIMERA DEL
ORO CON MÚSICA EN VIVO` → *The Gold Rush*) — and auto-skip mystery screenings
(`PELÍCULA SORPRESA`).
