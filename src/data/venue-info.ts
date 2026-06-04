// ---------------------------------------------------------------------------
// Venue editorial info — the hand-curated "sobre la sala" layer for /sala/[id].
//
// This is deliberately NOT in the `cinemas` DB table. These fields are static,
// editorial, operator-owned, and there are only a handful of indie venues —
// so a typed, version-controlled registry beats a migration + admin UI. Every
// field is optional; VenueInfo.tsx renders only what's present, so a venue
// with an empty (or missing) entry simply shows no info block.
//
// CONTENT OWNERSHIP & SOURCING: the final Spanish voice is Benjamin's. Blurbs
// and ticketing below were pulled from each venue's own site on 2026-06-04
// (Lugones: complejoteatral.gob.ar; MALBA: malba.org.ar; the three Lumiton
// venues: lumiton.ar). Two deliberate stances:
//   - `price` is OMITTED for the paid venues (Lugones, MALBA). Argentine prices
//     drift fast; rather than carry a number that silently goes stale we link
//     out via the header's "Sitio oficial" button. The free Lumiton venues
//     carry "Gratis" — that never goes stale.
//   - There is no transit/"cómo llegar" field: the venue header already renders
//     the address as a Google Maps link, which beats asking people to remember
//     bus/subte combinations.
// ---------------------------------------------------------------------------

export interface VenueInfo {
  /** One or two sentences of identity — what kind of programming, why it's
   *  worth the trip. Native Spanish, editorial voice (see DESIGN.md Voice). */
  blurb?: string;
  /** Ticket pricing, free-form so it can carry tiers or "gratis". e.g.
   *  "Entrada general $X · jubilados y estudiantes $Y" / "Gratis". Leave
   *  undefined for venues whose prices drift — link out instead. Never guess. */
  price?: string;
  /** How tickets are sold: online vs box-office, reservation vs walk-up. The
   *  "cómo se entra" that complements `price` (the "cuánto"). e.g.
   *  "Online o en boletería" / "Por orden de llegada, sin reserva". */
  ticketing?: string;
}

// Keyed by cinema slug (cinemas.id). Add an entry per venue as content is
// confirmed; venues absent here just render without the block.
export const VENUE_INFO: Record<string, VenueInfo> = {
  lugones: {
    blurb:
      'La sala de la cinemateca del Complejo Teatral de Buenos Aires, en el Teatro San Martín. Restauraciones, retrospectivas y copias en fílmico que casi no se ven en otro lado de la ciudad.',
    // Precio omitido a propósito: link a "Sitio oficial" en el header.
    ticketing:
      'Online (Entradas BA) o en boletería del Teatro San Martín. El descuento de estudiantes y jubilados es solo presencial, con certificado.',
  },
  malba: {
    blurb:
      'El cine del museo, en Palermo. Ciclos de autor, estrenos latinoamericanos y rescates en una de las pocas salas del país que todavía proyecta en 35mm.',
    // Precio omitido a propósito: link a "Sitio oficial" en el header.
    ticketing: 'Online o en boletería. Conviene comprar online.',
  },
  'cine-york': {
    blurb:
      'La sala de Olivos de la red Lumiton: clásicos restaurados, ciclos temáticos y cine argentino, con entrada libre y gratuita.',
    price: 'Gratis',
    ticketing: 'Por orden de llegada, sin reserva. Capacidad limitada.',
  },
  'centro-cultural-munro': {
    blurb:
      'El centro cultural de Munro donde Lumiton lleva su programación: estrenos, clásicos y ciclos para toda la familia, con entrada libre y gratuita.',
    price: 'Gratis',
    ticketing: 'Por orden de llegada, sin reserva. Capacidad limitada.',
  },
  lumiton: {
    blurb:
      'El museo del cine en la Casa de las Estrellas de Munro, los míticos estudios Lumiton donde en 1932 nació el cine sonoro argentino. Su sala proyecta ciclos y rescates del patrimonio nacional.',
    price: 'Gratis',
    ticketing: 'Por orden de llegada, sin reserva. Capacidad limitada.',
  },
};

/** Editorial info for a venue, or null if none is curated yet. */
export function getVenueInfo(id: string): VenueInfo | null {
  return VENUE_INFO[id] ?? null;
}

/** True when an entry has at least one renderable field. */
export function hasVenueInfo(info: VenueInfo | null): info is VenueInfo {
  return !!info && (!!info.blurb || !!info.price || !!info.ticketing);
}
