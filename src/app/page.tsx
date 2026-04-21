import Image from 'next/image';
import { getThisWeeksScreenings, formatTimeBA } from '@/db/queries';
import { TAG_LABELS_ES } from '@/db';

// This page is a Server Component — it runs on the server, awaits the DB
// directly, and ships rendered HTML. Zero client-side JS is shipped for the
// content below (only whatever Next.js needs for Link prefetching).
export default async function HomePage() {
  const days = await getThisWeeksScreenings();

  // Week-context summary: total functions + distinct cinemas across the span.
  const totalScreenings = days.reduce((n, d) => n + d.screenings.length, 0);
  const distinctCinemas = new Set(
    days.flatMap((d) => d.screenings.map((s) => s.cinema.id)),
  ).size;
  const weekRange = formatWeekRange(days);

  return (
    <>
      {/* Skip link — keyboard users tab onto this first; hits the main
          content, bypassing the masthead. Visually hidden by default,
          shown on focus. */}
      <a
        href="#cartelera"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-2 focus:bg-black focus:text-cream focus:font-mono focus:text-sm focus:tracking-card focus:uppercase"
      >
        Saltar al contenido
      </a>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 md:py-16">
        {/* Masthead */}
        <header className="border-y-8 border-double border-black py-6 text-center md:py-8">
          <h1 className="text-6xl font-black italic tracking-tight text-balance sm:text-7xl md:text-8xl">
            Afiche
          </h1>
          <p className="mt-2 italic">cartelera curada de Buenos Aires</p>
        </header>

        {/* Week context — orients the visitor at a glance.
            Left-aligned to match the rhythm of the day banners below; the
            masthead up top is center-aligned because it's the brand block. */}
        {days.length > 0 && (
          <p className="mt-8 font-mono text-[11px] uppercase tracking-eyebrow text-neutral-600">
            {weekRange}
            {' · '}
            {totalScreenings} {totalScreenings === 1 ? 'función' : 'funciones'}
            {' · '}
            {distinctCinemas} {distinctCinemas === 1 ? 'cine' : 'cines'}
          </p>
        )}

        {/* Week view */}
        <section id="cartelera" className="mt-8 space-y-12 md:mt-12">
          {days.length === 0 ? (
            <EmptyState />
          ) : (
            days.map((day) => (
              <div key={day.dateKey}>
                {/* Day banner. aria-current="date" announces today to
                    assistive tech; the HOY pill makes the same point
                    visually for sighted users. */}
                <div
                  aria-current={day.isToday ? 'date' : undefined}
                  className={`py-3 px-3 mb-6 sm:px-4 ${
                    day.isToday ? 'bg-black text-cream' : 'border-b-2 border-dashed border-black'
                  }`}
                >
                  <div className="flex items-baseline gap-3 flex-wrap">
                    {day.isToday && (
                      <span className="text-[11px] font-mono tracking-card uppercase px-2 py-0.5 bg-carmine text-cream">
                        HOY
                      </span>
                    )}
                    <h2 className="text-xl font-black italic tracking-wide uppercase text-balance sm:text-2xl sm:tracking-widest md:text-3xl">
                      {day.label}
                    </h2>
                  </div>
                  <p className="text-[11px] font-mono uppercase tracking-eyebrow mt-1 opacity-70">
                    {day.screenings.length}{' '}
                    {day.screenings.length === 1 ? 'función' : 'funciones'}
                  </p>
                </div>

              {/* Screening rows */}
              <div className="space-y-5">
                {day.screenings.map((s) => {
                  const cardBody = (
                    <>
                      {/* Tags */}
                      {s.tags.length > 0 && (
                        <div className="flex gap-2 mb-2 flex-wrap">
                          {s.tags.map((t) => (
                            <span
                              key={t}
                              className="text-[11px] font-mono tracking-card uppercase px-2 py-0.5 bg-carmine text-cream"
                            >
                              {TAG_LABELS_ES[t]}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
                        {/* Top section: poster + film info.
                            On mobile this is row 1. On desktop it's the left
                            side of the card with the meta block on the right. */}
                        <div className="flex gap-4 min-w-0 md:flex-1">
                          {/* Poster thumbnail or typographic fallback (indie only).
                              The carmine offset shadow is the project's signature
                              zine flourish — the only decorative shadow on the page. */}
                          {s.cinema.type === 'indie' && (
                            <div className="shrink-0 w-20 h-28 bg-black text-cream flex items-center justify-center overflow-hidden border border-black shadow-[4px_4px_0_var(--color-carmine)]">
                              {s.film.posterUrl ? (
                                <Image
                                  src={s.film.posterUrl}
                                  alt={s.film.title}
                                  width={80}
                                  height={112}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span className="text-[11px] italic text-center px-1 leading-tight">
                                  {s.film.title}
                                </span>
                              )}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <h3 className="text-xl font-black italic leading-tight text-balance sm:text-2xl">
                              {s.film.title}
                            </h3>
                            {s.film.director && (
                              <p className="text-sm text-neutral-600 mt-1">
                                {s.film.director}
                                {s.film.year && ` · ${s.film.year}`}
                                {/* Country tucked away on mobile to prevent
                                    the meta line from wrapping to two rows. */}
                                {s.film.country && (
                                  <span className="hidden sm:inline"> · {s.film.country}</span>
                                )}
                                {s.film.runtimeMin && ` · ${s.film.runtimeMin} min`}
                              </p>
                            )}
                            {s.film.synopsisEs && s.cinema.type === 'indie' && (
                              <p className="mt-3 text-sm border-l-2 border-carmine pl-3 max-w-prose line-clamp-3">
                                {s.film.synopsisEs}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Meta block: cinema + time.
                            Mobile: new row beneath, with cinema left / time right.
                            Desktop: rightmost column of the card, stacked vertically. */}
                        <div className="flex items-end justify-between gap-4 md:flex-col md:items-end md:text-right md:shrink-0 md:gap-0">
                          <div>
                            <p
                              className={`text-xs font-mono tracking-card uppercase ${
                                s.cinema.type === 'indie' ? 'text-carmine font-bold' : 'text-neutral-500'
                              }`}
                            >
                              {s.cinema.type === 'indie' && '★ '}
                              {s.cinema.name}
                            </p>
                            {s.cinema.neighborhood && (
                              <p className="text-[11px] font-mono uppercase tracking-wider text-neutral-500 mt-1">
                                {s.cinema.neighborhood}
                              </p>
                            )}
                          </div>
                          <time
                            dateTime={s.startsAtUtc.toISOString()}
                            className="text-2xl font-black italic text-carmine tabular-nums md:mt-2"
                          >
                            {formatTimeBA(s.startsAtUtc)}
                          </time>
                        </div>
                      </div>
                    </>
                  );

                  const cardClasses = `block p-4 border sm:p-5 transition-[background-color,box-shadow] active:translate-y-[1px] ${
                    s.cinema.type === 'indie'
                      ? 'border-carmine bg-carmine/5 border-l-4 hover:bg-carmine/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-carmine'
                      : 'border-neutral-300 bg-black/[0.02] hover:bg-black/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black'
                  }`;

                  // If we have a source URL, the whole card is a tap target.
                  // Opens in a new tab because destinations are external
                  // ticketing / programming pages, not Afiche-internal routes.
                  return s.sourceUrl ? (
                    <a
                      key={s.id}
                      href={s.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-screening-card
                      className={cardClasses}
                      aria-label={`${s.film.title} — ${s.cinema.name} — ${formatTimeBA(s.startsAtUtc)}`}
                    >
                      {cardBody}
                    </a>
                  ) : (
                    <article key={s.id} className={cardClasses}>
                      {cardBody}
                    </article>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </section>

        {/* Footer */}
        <footer className="mt-20 pt-8 border-t-8 border-double border-black text-center">
          <p className="italic">Afiche — hecho por cinéfilos, para cinéfilos</p>
          <p className="text-[11px] font-mono uppercase tracking-eyebrow text-neutral-500 mt-2">
            última actualización · datos de ejemplo
          </p>
        </footer>
      </main>
    </>
  );
}

// ---------------------------------------------------------------------------
// Empty state — shown when the DB has no upcoming screenings.
//
// User-facing copy first. The dev hint is gated on NODE_ENV so it
// doesn't leak to visitors if the scraper hasn't run yet in prod.
// ---------------------------------------------------------------------------
function EmptyState() {
  return (
    <div className="text-center space-y-3 py-12">
      <p className="italic text-neutral-500">
        La cartelera se actualiza todas las madrugadas. Volvé en unas horas.
      </p>
      {process.env.NODE_ENV !== 'production' && (
        <p className="font-mono text-[11px] uppercase tracking-eyebrow text-neutral-400">
          dev hint: ejecutá <code>npm run db:seed</code> para cargar datos de ejemplo
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Week range helper — pulled out of the JSX for readability.
// ---------------------------------------------------------------------------
function formatWeekRange(days: Array<{ screenings: Array<{ startsAtUtc: Date }> }>): string {
  // Find the earliest and latest screening timestamp to bracket the range.
  const allStarts = days.flatMap((d) => d.screenings.map((s) => s.startsAtUtc));
  if (allStarts.length === 0) return '';
  const first = allStarts.reduce((a, b) => (a < b ? a : b));
  const last = allStarts.reduce((a, b) => (a > b ? a : b));

  const fmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: 'numeric',
    month: 'long',
  });

  // Same day → "23 de abril". Same month → "23 al 30 de abril".
  // Different months → "23 de abril al 5 de mayo".
  const firstParts = fmt.formatToParts(first);
  const lastParts = fmt.formatToParts(last);
  const firstMonth = firstParts.find((p) => p.type === 'month')?.value;
  const lastMonth = lastParts.find((p) => p.type === 'month')?.value;
  const firstDay = firstParts.find((p) => p.type === 'day')?.value;
  const lastDay = lastParts.find((p) => p.type === 'day')?.value;

  if (firstDay === lastDay && firstMonth === lastMonth) {
    return `${firstDay} de ${firstMonth}`;
  }
  if (firstMonth === lastMonth) {
    return `${firstDay} al ${lastDay} de ${firstMonth}`;
  }
  return `${firstDay} de ${firstMonth} al ${lastDay} de ${lastMonth}`;
}
