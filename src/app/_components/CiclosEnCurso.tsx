import Link from 'next/link';
import { formatDayShortBA, type Ciclo } from '@/db/queries';

// ---------------------------------------------------------------------------
// CiclosEnCurso — the "Ciclos en curso" block on /sala/<id>. Lists the
// curatorial programs running at the venue (Retrospectiva David Lynch · 7
// películas · hasta 30 May). Each ciclo anchor-jumps to the program's first
// agenda entry (#programa-<slug>) — this is the page's primary wayfinding now
// that the homepage date strip is gone.
//
// v1 is fed ONLY the visible agenda's ciclos (groupCiclos over the same rows
// VenueAgenda renders), so every ciclo's anchor exists in the agenda — no
// future-only / Próximamente-fallback case. Renders nothing for venues that
// don't run cycles (Cosmos, Lorca → groupCiclos returns []).
//
// The top/bottom double rule echoes the homepage day-banner `border-double`.
// ---------------------------------------------------------------------------
export function CiclosEnCurso({ ciclos }: { ciclos: Ciclo[] }) {
  if (ciclos.length === 0) return null;
  return (
    <section className="border-ink border-y-[3px] border-double py-4">
      <h2 className="tracking-eyebrow text-ink-gray mb-2 font-mono text-[11px] uppercase">
        Ciclos en curso
      </h2>
      <div className="-mx-2">
        {ciclos.map((c) => (
          <Link
            key={c.slug}
            href={`#programa-${c.slug}`}
            className="focus-visible:outline-carmine hover:border-carmine hover:bg-carmine/5 block border-l-2 border-transparent px-2 py-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <span className="font-serif text-xl leading-snug md:text-2xl">
              {c.name}
              <span className="text-carmine ml-1 align-middle font-mono text-xs">→</span>
            </span>
            <span className="tracking-card text-ink-gray block font-mono text-[10px] uppercase">
              {c.filmCount} {c.filmCount === 1 ? 'película' : 'películas'} ·{' '}
              {cicloRange(c)}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

// "hasta 30 May" for an ongoing cycle, or just the single date when all its
// visible screenings fall on one day.
function cicloRange(c: Ciclo): string {
  const last = formatDayShortBA(c.lastStartsAt);
  const first = formatDayShortBA(c.firstStartsAt);
  return first === last ? first : `hasta ${last}`;
}
