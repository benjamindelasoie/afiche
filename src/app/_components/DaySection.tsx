import { type DayGroup } from '@/db/queries';
import { isScreeningExpired } from '@/lib/date-ranges';
import { ScreeningCard } from './ScreeningCard';

export function DaySection({
  day,
  isFirstDay = false,
  lastScreeningPerFilm,
  now,
}: {
  day: DayGroup;
  isFirstDay?: boolean;
  lastScreeningPerFilm: Map<number, number>;
  now: Date;
}) {
  const upcoming = day.isToday
    ? day.screenings.filter((s) => !isScreeningExpired(s.startsAtUtc, now))
    : day.screenings;
  const total = day.screenings.length;
  const expiredCount = total - upcoming.length;
  const isEmpty = total === 0;
  const isAllExpired = day.isToday && total > 0 && upcoming.length === 0;
  return (
    <div>
      <h2
        id={`dia-${day.dateKey}`}
        aria-current={day.isToday ? 'date' : undefined}
        className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-t border-black py-3 font-normal"
      >
        <span
          className={`tracking-eyebrow font-mono text-[11px] text-balance uppercase ${
            day.isToday ? 'text-carmine font-bold' : 'text-ink'
          }`}
        >
          {day.label}
          {day.isToday && (
            <span className="bg-carmine text-cream ml-2 px-1.5 py-0.5 no-underline">
              HOY
            </span>
          )}
        </span>
        <span className="tracking-eyebrow text-ink-gray font-mono text-[11px] uppercase">
          {total} {total === 1 ? 'función' : 'funciones'}
          {expiredCount > 0 &&
            (isAllExpired ? ' · todas ya pasaron' : ` · ${expiredCount} ya pasaron`)}
        </span>
      </h2>
      {isEmpty ? (
        <p className="text-ink-gray font-serif text-base italic">Las salas descansan.</p>
      ) : isAllExpired ? (
        <p className="text-ink-gray font-serif text-base italic">
          No más funciones por hoy.
        </p>
      ) : (
        <div className="space-y-5">
          {upcoming.map((s, idx) => (
            <ScreeningCard
              key={s.id}
              s={s}
              isAboveFold={(day.isToday || isFirstDay) && idx < 3}
              isLastFunction={
                lastScreeningPerFilm.get(s.film.id) === s.startsAtUtc.getTime()
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
