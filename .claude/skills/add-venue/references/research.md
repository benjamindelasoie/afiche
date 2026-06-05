# Phase 1 — Research the venue

Goal: gather the venue's **real** identity and practical info from its own site,
and decide the scraper shape. Honor the source; never invent.

## Browse the source with `/browse`

Use the gstack `/browse` skill for all fetching (per global config — never
`mcp__claude-in-chrome__*` directly). It's a persistent headless Chromium:
`goto` a URL, then `text` / `links` / `html` to read it. It survived the address
hunt in this codebase faster than WebFetch because you can follow links and read
data attributes.

Useful moves:
- `B="$HOME/.claude/skills/gstack/browse/dist/browse"` then `$B goto <url>`.
- `$B text` — cleaned page text. Grep it for `$`, `precio`, `entrada`, `gratis`,
  `dirección`, subte/colectivo, days of week.
- `$B links | grep -i ...` — find ticket-buy links, detail pages, about/history.
- `$B html | grep -oiE 'data-[a-z-]+="[^"]*"'` — read machine-readable data
  attributes (this is how the Lumiton venues expose their location slug).
- Ticketing platforms (entradasba, liit, etc.) often **403 headless** — read the
  price off the venue's own event/visitar page instead, where it's usually listed.

## What to collect (per venue)

| Field | Where it lands | Notes |
|---|---|---|
| Display name | `cinemas.name` | Exactly as the venue brands itself. |
| Address | `cinemas.address` | **Verbatim from the source.** Drives the header Maps link. |
| Neighborhood | `cinemas.neighborhood` | Barrio (Palermo, Munro, Olivos…). |
| Official URL | `cinemas.ticketingBaseUrl` | The page with programming/tickets. |
| Programming identity | `venue-info.blurb` | What kind of cinema (auteur, restorations, free municipal…), year/history if notable. |
| Ticket price | `venue-info.price` | Record what the site says, but see the price stance in `venue-info.md`. |
| How tickets sell | `venue-info.ticketing` | Online vs box-office vs walk-up; reservation vs first-come. |
| Programming URL(s) | the scraper | The listing page + how detail pages are reached. |
| Scraper shape | the scraper | See "Decide the scraper shape" below. |

History/founding year and the programming identity are best pulled from the
venue's "about/historia/proyecto" pages (e.g. Lumiton's `/historia/` gave the
1932 studios story). Weave facts into the blurb; don't paste marketing copy.

## Ownership rules (do not violate)

- **Never invent a ticket price.** A wrong price is the exact goodwill drain the
  feature exists to prevent. Pull the real number; if unsure, omit it.
- **The final Spanish voice is Benjamin's.** Any blurb you draft is a
  placeholder for him to rewrite (es-AR, editorial, see `DESIGN.md` Voice).
- **Show the venue's own title for a film, not TMDB's**, when they differ — the
  cartelera must match what the box office says. (This is a render-time rule in
  the app; just be aware scraped titles are preserved verbatim.)

## Decide the scraper shape

Look at the programming page and classify it — this picks which existing provider
you'll copy in Phase 3 (`references/scraper.md` has the full table):

- **HTML listing → per-film detail pages?** (Lugones) Cheerio + a parser that
  walks each detail page.
- **Listing → cycle/detail pages with a few different layouts?** (MALBA) Same,
  with multiple parse strategies + a fetch delay.
- **One shared agenda page for several venues, tagged by a location slug/data
  attribute?** (Lumiton family) One parser, filtered per venue. Multiple
  providers, one parse.
- **Day-of-week weekly grid?** (Cosmos) Anchor on the cycle's start weekday in
  BA time, map abbreviations to offsets.
- **Image-only cartelera (a poster JPG, no HTML data)?** (Cine Lorca) Last
  resort: Claude vision + image-hash caching. Only when there's genuinely no
  structured HTML to parse.

Write down the venue↔provider mapping and the shape before coding.
