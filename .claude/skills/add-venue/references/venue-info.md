# Phase 5 — "Sobre la sala" content

The editorial "about" block on `/sala/[id]` is fed by a static typed registry,
`src/data/venue-info.ts` — NOT the DB. It's deliberately code: editorial,
operator-owned, only a handful of venues, so a version-controlled registry beats
a migration + admin UI. Rendered by `src/app/_components/VenueAbout.tsx`; the
page mounts it only when `hasVenueInfo()` is true, and every field is optional,
so partial entries render cleanly.

## The shape

```ts
export interface VenueInfo {
  blurb?: string;      // 1–2 sentence identity: what kind of cinema, why go, notable history
  price?: string;      // free-form ("Gratis", or tiers) — but see the stance below
  ticketing?: string;  // how you get in: online vs boletería vs walk-up; reservation vs first-come
}
```

Add an entry keyed by the cinema slug:

```ts
'my-venue': {
  blurb: 'El cine de … . Ciclos de autor, restauraciones y estrenos … .',
  price: 'Gratis',                                   // for free venues
  ticketing: 'Por orden de llegada, sin reserva. Capacidad limitada.',
},
```

## Two standing decisions (don't re-litigate)

1. **Price stance: omit the number for paid venues; link out.** Argentine prices
   drift fast, and a wrong price is the exact goodwill drain this feature exists
   to prevent. For paid venues (e.g. Lugones, MALBA) leave `price` undefined —
   the page header already shows a "Sitio oficial" button. Free venues carry
   `price: 'Gratis'` (never stale). Record the real numbers in your research, but
   **never render an invented or possibly-stale price.**
2. **No `transit` / "cómo llegar" field.** The page header renders the venue
   `address` as a Google Maps link (with a map-pin), which beats listing bus/subte
   combinations. Get the address right in Phase 2; that's the wayfinding.

## Voice

- Spanish-native (es-AR), editorial, confident-cinephile — see `DESIGN.md` Voice
  (proper «» quotes, em-dashes, no marketing-speak).
- **The final voice is the operator's.** Any blurb you write is a draft for
  Benjamin to rewrite. Pull facts (programming identity, founding year, 35mm,
  free/municipal status) from the venue's own about/history pages; weave them in,
  don't paste marketing copy.

## Where it renders

- `src/app/_components/VenueAbout.tsx` — the block (serif blurb + a `<dl>` with
  `Precio` / `Entradas` rows; mono-caps labels per `DESIGN.md` data-micro-caps).
- `src/app/sala/[id]/page.tsx` — the header above it (name, neighborhood,
  address→Maps link, "Sitio oficial"), then `<VenueAbout>`, then the agenda.

Look at the existing `lugones`, `malba`, and the three Lumiton entries as models
before writing yours. Then return to SKILL.md Phase 6 to QA and ship.
