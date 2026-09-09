# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## `matcher-pattern` — an automated consumer of `ready-for-agent`

The self-heal loop files its own issues under a topic label, `matcher-pattern`
(a class of TMDB miss that no single override fixes), and pairs it with one of
the triage labels above:

- `matcher-pattern` + `ready-for-agent` — mechanical (a new container/skip word).
  **Actor 2 picks the first of these up on the next scrape** and opens a fix PR
  against it; it never merges, so a human still reviews.
- `matcher-pattern` + `ready-for-human` — a localized-title miss, which needs
  judgment. Never auto-fixed.

So on a `matcher-pattern` issue, `ready-for-agent` is not just a hint to a
future agent: it is the trigger an automation reads. Move an issue to
`ready-for-human` (or `wontfix`) to keep Actor 2 off it. See
[`self-heal-loop.md`](self-heal-loop.md).
