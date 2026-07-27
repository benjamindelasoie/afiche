import Link from 'next/link';
import { formatDayShortBA, type Ciclo } from '@/db/queries';
import { cn } from '@/lib/cn';
import { Caps, focusRing, hoverRail } from './ui';

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
      <Caps as="h2" className="text-ink-gray mb-2">
        Ciclos en curso
      </Caps>
      <div className="-mx-2">
        {ciclos.map((c) => (
          <Link
            key={c.slug}
            href={`#programa-${c.slug}`}
            className={cn('block px-2 py-2', focusRing, hoverRail({ inset: 'xs' }))}
          >
            <span className="font-serif text-xl leading-snug md:text-2xl">
              {c.name}
              <span className="text-carmine ml-1 align-middle font-mono text-xs">→</span>
            </span>
            <Caps variant="card" className="text-ink-gray block text-[10px]">
              {c.filmCount} {c.filmCount === 1 ? 'película' : 'películas'} ·{' '}
              {cicloRange(c)}
            </Caps>
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
