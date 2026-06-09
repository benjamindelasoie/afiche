// Per-venue display SHAPE for /sala/[id]. Two shapes:
//   - `chronological` (default) — the date-rail VenueAgenda (each screening an event)
//   - `weekly-run` — film-first VenueRuns (a fixed daily showtime grid)
//
// The shape is an EXPLICIT per-venue choice, NOT derived from a data ratio:
// venue scheduling grammar is stable (a commercial house won't become a
// repertory one), and at ~10 venues an explicit set is more predictable than
// a threshold that could flip a venue's whole layout on an unusual week.
// Seeded from scripts/ia-stats.ts per-venue cut (2026-06-09): Lorca 6.0 /
// Cosmos 4.0 redundancy ratios vs ~1.0 for the repertory houses.
//
// Adding a venue = one line. See TODOS.md #34(b).
export const WEEKLY_RUN_CINEMAS: ReadonlySet<string> = new Set(['lorca', 'cine-cosmos']);

export function isWeeklyRunVenue(cinemaId: string): boolean {
  return WEEKLY_RUN_CINEMAS.has(cinemaId);
}
