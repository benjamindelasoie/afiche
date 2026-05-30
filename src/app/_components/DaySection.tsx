import { type DayGroup } from '@/db/queries';
import { isScreeningExpired } from '@/lib/date-ranges';
import { ScreeningCard } from './ScreeningCard';

// ---------------------------------------------------------------------------
// Day section — homepage Tier 1. Banner (anchored as #dia-${dateKey} for the
// date strip's chip-jumps) + screening cards. Renders for EVERY day in the
// 14-day rolling window, including empty days, which surface an editorial
// "Las salas descansan" line in place of the card list.
//
// (The /sala/<id> venue page does NOT use this — it has its own VenueAgenda
// that drops empty days entirely. This component is homepage-only.)
// ---------------------------------------------------------------------------
export function DaySection({
  day,
  // First day of the rolling window (always today). Drives Next/Image priority
  // on the top cards so the LCP poster loads eagerly even when today has no
  // screenings — without it, day.isToday is never true and no card gets
  // priority, which was the prod console warning on afiche.vercel.app.
  isFirstDay = false,
  // Per-film MAX(startsAtUtc) over all upcoming screenings — ScreeningCard
  // uses it to flag the ÚLTIMA FUNCIÓN pill where this screening is a film's max.
  lastScreeningPerFilm,
  // BA-now anchor for the expired filter below. Only matters for today; later
  // days in the rolling window are entirely future by construction.
  now,
}: {
  day: DayGroup;
  isFirstDay?: boolean;
  lastScreeningPerFilm: Map<number, number>;
  now: Date;
}) {
  // Hide expired screenings from today (already-started + 15-min grace): the
  // dominant evening intent is "what's still seeable tonight", and past-start
  // cards otherwise dominate the page's most valuable real estate. The dropped
  // count still surfaces in the banner subhead ("12 funciones · 4 ya pasaron").
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
