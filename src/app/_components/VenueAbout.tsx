import type { VenueInfo } from '@/data/venue-info';

// ---------------------------------------------------------------------------
// VenueAbout — the "sobre la sala" block on /sala/[id]: a one-line editorial
// identity plus the practical datos a repertory-goer checks before going
// (precio, cómo se entra). Fed by the static venue-info registry; the page only
// mounts it when hasVenueInfo() is true, and each field is independently
// optional, so partial entries render cleanly. There's no "cómo llegar" row —
// the page header already shows the address as a Google Maps link.
//
// Labels/values use a <dl> — the correct semantics for label/value pairs, and
// it lets screen readers announce "Precio: …" / "Entradas: …". Mono caps
// label + Geist value follows DESIGN.md's data-micro-caps role.
// ---------------------------------------------------------------------------
export function VenueAbout({ info }: { info: VenueInfo }) {
  const hasData = !!info.price || !!info.ticketing;
  return (
    <section aria-label="Sobre la sala" className="mb-10">
      {info.blurb && (
        <p className="text-ink max-w-2xl font-serif text-lg leading-relaxed text-pretty sm:text-xl">
          {info.blurb}
        </p>
      )}
      {hasData && (
        <dl className="mt-5 grid max-w-2xl grid-cols-[auto_1fr] gap-x-5 gap-y-2.5">
          {info.price && (
            <>
              <dt className="tracking-card text-ink-gray pt-0.5 font-mono text-[10px] uppercase">
                Precio
              </dt>
              <dd className="text-ink text-sm">{info.price}</dd>
            </>
          )}
          {info.ticketing && (
            <>
              <dt className="tracking-card text-ink-gray pt-0.5 font-mono text-[10px] uppercase">
                Entradas
              </dt>
              <dd className="text-ink text-sm">{info.ticketing}</dd>
            </>
          )}
        </dl>
      )}
    </section>
  );
}
