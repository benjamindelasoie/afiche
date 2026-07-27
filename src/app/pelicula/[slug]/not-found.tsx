import { NotFoundShell } from '@/app/_components/ui';

/**
 * Custom 404 for /pelicula/<slug>.
 *
 * Triggered when:
 *   - The slug regex rejects the URL.
 *   - The slug doesn't exist in the films table.
 *   - The film has no upcoming screenings within the 4-hour grace window
 *     (most common: someone shared a /pelicula/ link last week, the
 *     screenings have since ended).
 *
 * Per design-review 2026-04-25: editorial recovery copy + clear path back
 * to the cartelera. No error chrome ("404 Not Found" generic patterns).
 * The user's mental model: "I expected a film page, I got a softer
 * 'not playing right now' answer plus a link to what IS playing." That's
 * good UX for the share-then-screenings-end case.
 */
export default function NotFound() {
  return (
    <NotFoundShell title="Esta película no está programada en este momento.">
      Volvé a la cartelera para ver qué hay esta semana.
    </NotFoundShell>
  );
}
