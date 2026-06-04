// ---------------------------------------------------------------------------
// Venue editorial info — the hand-curated "sobre la sala" layer for /sala/[id].
//
// This is deliberately NOT in the `cinemas` DB table. These fields are static,
// editorial, operator-owned, and there are only a handful of indie venues —
// so a typed, version-controlled registry beats a migration + admin UI. Every
// field is optional; VenueInfo.tsx renders only what's present, so a venue
// with an empty (or missing) entry simply shows no info block.
//
// CONTENT OWNERSHIP: prices and the final Spanish voice are Benjamin's. The
// `blurb`/`transit` seeded below are drafts from general BA knowledge — rewrite
// to taste and VERIFY transit. `price` is intentionally left undefined
// everywhere: a wrong ticket price is worse than none.
// ---------------------------------------------------------------------------

export interface VenueInfo {
  /** One or two sentences of identity — what kind of programming, why it's
   *  worth the trip. Native Spanish, editorial voice (see DESIGN.md Voice). */
  blurb?: string;
  /** Ticket pricing, free-form so it can carry tiers or "gratis". e.g.
   *  "Entrada general $X · jubilados y estudiantes $Y" / "Gratis con reserva".
   *  Leave undefined until verified — never guess a price. */
  price?: string;
  /** How to get there: subte line(s) / nearby colectivos, terse. Complements
   *  the header's address+maps link (the "where") with the "how". */
  transit?: string;
}

// Keyed by cinema slug (cinemas.id). Add an entry per venue as content is
// confirmed; venues absent here just render without the block.
export const VENUE_INFO: Record<string, VenueInfo> = {
  lugones: {
    blurb:
      'La sala de la cinemateca del Complejo Teatral de Buenos Aires, en el Teatro San Martín. Restauraciones, retrospectivas y copias en fílmico que casi no se ven en otro lado de la ciudad.',
    // TODO(benja): precio. Entrada general / jubilados / estudiantes.
    transit: 'Subte B (Uruguay) · Av. Corrientes 1530', // TODO(benja): verificar
  },
  malba: {
    blurb:
      'El cine del museo, en Palermo. Autores contemporáneos, restauraciones y ciclos en sala, con una mirada puesta en el cine latinoamericano.',
    // TODO(benja): precio (entrada de cine, tarifa socios/estudiantes).
    transit: 'Sin subte cercano · colectivos 67, 102, 130', // TODO(benja): verificar
  },
  // TODO(benja): cine-york, centro-cultural-munro, lumiton — blurb + transit
  // + precio. Left as stubs so their pages render without the block for now.
};

/** Editorial info for a venue, or null if none is curated yet. */
export function getVenueInfo(id: string): VenueInfo | null {
  return VENUE_INFO[id] ?? null;
}

/** True when an entry has at least one renderable field. */
export function hasVenueInfo(info: VenueInfo | null): info is VenueInfo {
  return !!info && (!!info.blurb || !!info.price || !!info.transit);
}
