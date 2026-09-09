# Self-heal loop

The scraper enriches films deterministically (TMDB match). Some films still miss.
This loop enriches the miss with an agent, and improves the deterministic code so
the miss shrinks over time. Three actors, two layers.

## Layer 1 — heal the data (runs after every scrape)

`scripts/self-heal.ts` (`npm run db:self-heal:prod -- --write`) runs on the scrape
host after each scrape, pass or fail.

1. Audit the last runs (`src/scrapers/audit.ts`): alerts + the active-stuck pool
   (no TMDB match, a future screening, not `skipTmdb`, not `hiddenAt`).
2. Judge each stuck film against TMDB candidates (the existing SDK judge).
3. Auto-apply only matches that clear the safety gate (`src/scrapers/self-heal.ts`,
   `classifyProposal`). A match auto-applies when it is candidate-judged AND either:
   - confidence >= 0.90 and the year or director corroborates, or
   - confidence >= 0.95 and the scraped title is an exact, dominant, established
     match (normalizes-equal to the candidate title/original, outweighs any
     same-title rival by >= 4x votes, vote_count >= 100), with no year/director
     that actively disagrees.
   A web-researched id NEVER auto-applies.
4. The apply is a durable row in `tmdb_overrides` (survives `reset-programming`) and
   re-opens the film for the next enrich. Everything else goes to the digest queue.

## Layer 2 — catch the bug (same run)

`src/scrapers/heal-patterns.ts` groups the films that STILL missed by fixable cause.
A cause that explains >= 2 films opens a `matcher-pattern` GitHub issue (the harness
opens it, not the model — issue creation is a write credential). Dedup is by a
signature marker in the issue body, so a cause is filed once.

- `container-or-placeholder` → `ready-for-agent` (mechanical: a new skip word).
- `localized-title-miss` → `ready-for-human` (the Spanish title diverges from TMDB).
- `unfixable` (not in TMDB) never files.

## Actor 2 — fix the bug (chained after self-heal)

`scripts/actor2-fix.ts` (`npm run actor2:fix:prod -- --merge`) runs after
self-heal on the same box and consumes the first `ready-for-agent`
`matcher-pattern` issue:

1. Parse the failing titles, compute the mechanical fix
   (`src/scrapers/container-suggest.ts`).
2. Safety check: mirror production (`isNonFilmContainer` on the noise-stripped
   title) and confirm NO already-matched film flips to skip. Abort if any would.
3. In a throwaway git worktree (never the live checkout): edit
   `src/tmdb/container.ts` + a regression test, run the full suite.
4. Open a PR that closes the issue. With `--merge` (the cron passes it), squash-merge
   the mechanical container lane automatically — the suite is green and the safety
   check proved no matched film flips, so it is sound to merge unattended. Without
   `--merge`, the PR waits for a human. `ready-for-human` issues (localized-title
   misses) are never auto-fixed.

Requires `gh auth login` (repo scope) once on the box — without it, issue/PR calls
no-op and the loop stalls at "file the issue".

## Actor 3 — you

Nothing routine: the mechanical lane is zero-touch (fix → PR → auto-merge → next
scrape pulls it). You still merge `ready-for-human` PRs and triage the digest queue
(fix or skip-forever). Every auto-merge is a normal PR + `git revert` if wrong.
