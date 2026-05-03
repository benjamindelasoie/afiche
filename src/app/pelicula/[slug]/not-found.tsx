import Link from 'next/link';

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
    <main className="mx-auto w-full max-w-5xl min-w-0 px-4 py-16 sm:px-6 md:py-24">
      <section className="space-y-6 py-12 text-center">
        <h1 className="text-ink font-serif text-2xl leading-tight text-balance italic md:text-3xl">
          Esta película no está programada en este momento.
        </h1>
        <p className="text-ink-gray font-serif text-lg italic">
          Volvé a la cartelera para ver qué hay esta semana.
        </p>
        <Link
          href="/"
          className="tracking-eyebrow text-carmine border-carmine mt-2 inline-block border-b font-mono text-[11px] uppercase"
        >
          ← Cartelera actual
        </Link>
      </section>
    </main>
  );
}
