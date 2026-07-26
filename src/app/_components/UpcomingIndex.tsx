import Link from 'next/link';
import { formatDayShortBA, formatTimeBA, type WeekGroup } from '@/db/queries';
import { cn } from '@/lib/cn';
import { Pill, StretchedLink, hoverRail } from './ui';
import { DayTimeChip } from './DayTimeChip';

// UpcomingIndex — the "Próximamente" week-grouped text index, shared by
// /cartelera and /sala. One banner per ISO week + chronological rows beneath;
// each row is a stretched /pelicula link with the signature hover left-tick.
//
// Two shapes via props (merged from the former cartelera UpcomingIndex + sala
// SalaUpcomingIndex, which were ~90% identical):
//   • showCinema           — cross-venue view (/cartelera): adds the cinema-name
//     column (→ /sala) on the md 3-col grid. Off on /sala (already one venue).
//   • lastScreeningPerFilm  — when supplied, a row whose screening is a film's
//     LAST across all of BA gets the "Última" pill (/cartelera only; the signal
//     is off-topic on a single-venue schedule).
export function UpcomingIndex({
  weeks,
  showCinema = false,
  lastScreeningPerFilm,
}: {
  weeks: WeekGroup[];
  showCinema?: boolean;
  lastScreeningPerFilm?: Map<number, number>;
}) {
  return (
    <div className="mt-8 space-y-10">
      {weeks.map((week) => (
        <div key={week.weekKey}>
          <h3 className="tracking-eyebrow text-ink mb-3 border-t border-black/40 py-2 font-mono text-[11px] uppercase">
            {week.label}
          </h3>
          <ul className="divide-y divide-black/15">
            {week.screenings.map((s) => {
              const isIndie = s.cinema.type === 'indie';
              const isLastFunction =
                lastScreeningPerFilm?.get(s.film.id) === s.startsAtUtc.getTime();
              const ariaLabel = showCinema
                ? `${s.film.title} — ${s.cinema.name} — ${formatTimeBA(s.startsAtUtc)}`
                : `${s.film.title} — ${formatDayShortBA(s.startsAtUtc)} ${formatTimeBA(s.startsAtUtc)}`;
              return (
                <li key={s.id}>
                  <div className={hoverRail({ inset: 'sm' })}>
                    {s.film.slug && (
                      <StretchedLink
                        href={`/pelicula/${s.film.slug}`}
                        aria-label={ariaLabel}
                      />
                    )}
                    <div
                      className={cn(
                        'grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1 px-1 py-3',
                        showCinema && 'md:grid-cols-[auto_1fr_auto]',
                      )}
                    >
                      <DayTimeChip date={s.startsAtUtc} isIndie={isIndie} />
                      <div className="min-w-0">
                        <span
                          className={
                            isIndie
                              ? 'font-serif text-lg leading-tight'
                              : 'font-sans text-base font-medium'
                          }
                        >
                          {s.film.title}
                        </span>
                        {isLastFunction && (
                          <Pill className="ml-2 align-middle">Última</Pill>
                        )}
                      </div>
                      {showCinema && (
                        <Link
                          href={`/sala/${s.cinema.id}`}
                          className={cn(
                            'tracking-card relative z-10 col-span-2 font-mono text-[11px] whitespace-nowrap uppercase md:col-span-1',
                            isIndie ? 'text-carmine font-bold' : 'text-ink-gray',
                          )}
                        >
                          {s.cinema.name}
                        </Link>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
