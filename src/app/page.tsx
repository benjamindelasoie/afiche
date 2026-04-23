import Image from 'next/image';
import { getThisWeeksScreenings, formatTimeBA } from '@/db/queries';
import { TAG_LABELS_ES } from '@/db';
import { getEditionNumber, editionFullSentence } from '@/lib/iso-week';

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

  // Edition metadata — ISO week number + formatted range + counts. All four
  // derived from the same compute so the abbreviated visible dateline and
  // the sr-only full sentence never fall out of sync.
  const edition = days.length > 0 ? computeEdition(days, totalScreenings, distinctCinemas) : null;

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
        {/* Masthead — edition dateline treats the site like a weekly print
            issue. The visible mono line is abbreviated; the sr-only
            paragraph reads the full Spanish sentence for screen readers.
            Both derive from the same computation (see computeEdition
            below) so they can never drift. */}
        <header className="border-y-8 border-double border-black py-8 text-center md:py-12">
          <h1
            className="font-serif text-balance leading-[0.9] tracking-tight"
            style={{ fontSize: 'clamp(4rem, 12vw, 8rem)' }}
          >
            Afiche
          </h1>
          {edition && (
            <>
              <p
                className="mt-4 font-mono text-[11px] uppercase tracking-eyebrow text-ink-gray flex items-center justify-center flex-wrap gap-x-2 gap-y-1"
                aria-hidden="true"
              >
                <span className="text-carmine font-bold">Edición Nº {edition.editionNumber}</span>
                <span className="text-ink-gray/60">·</span>
                <span>
                  {edition.isWeekSpan ? 'Semana del ' : 'Del '}
                  {edition.weekRangeLabel}
                </span>
                <span className="text-ink-gray/60">·</span>
                <span>
                  {totalScreenings} {totalScreenings === 1 ? 'función' : 'funciones'}
                </span>
                <span className="text-ink-gray/60">·</span>
                <span>
                  {distinctCinemas} {distinctCinemas === 1 ? 'sala' : 'salas'}
                </span>
              </p>
              <p className="sr-only">{edition.fullSentence}</p>
            </>
          )}
          <p className="mt-3 font-serif italic text-ink-gray text-lg md:text-xl">
            cartelera curada de Buenos Aires
          </p>
        </header>

        {/* Week view */}
        <section id="cartelera" className="mt-10 space-y-12 md:mt-14">
          {days.length === 0 ? (
            <EmptyState />
          ) : (
            days.map((day) => (
              <div key={day.dateKey}>
                {/* Day banner — tracked mono label on left (with HOY pill
                    when applicable), serif dateline on right, screening
                    count far right. Double-border top + bottom echoes
                    the masthead rule. aria-current="date" announces
                    today to assistive tech. */}
                <div
                  aria-current={day.isToday ? 'date' : undefined}
                  className="border-t border-b-[3px] border-double border-black py-3 mb-6 flex items-baseline justify-between gap-3 flex-wrap"
                >
                  <span className="font-mono text-[11px] uppercase tracking-eyebrow text-balance">
                    {day.label}
                    {day.isToday && (
                      <span className="ml-2 px-1.5 py-0.5 bg-carmine text-cream no-underline">
                        HOY
                      </span>
                    )}
                  </span>
                  <span
                    className={`font-serif italic leading-none text-2xl md:text-3xl ${
                      day.isToday ? 'text-carmine' : 'text-ink'
                    }`}
                  >
                    {day.isToday ? 'Hoy' : formatDayShort(day.dateKey)}
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-eyebrow text-ink-gray">
                    {day.screenings.length}{' '}
                    {day.screenings.length === 1 ? 'función' : 'funciones'}
                  </span>
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
                                <span className="font-serif italic text-center px-1 leading-tight text-sm">
                                  {s.film.title}
                                </span>
                              )}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            {/* Film title — editorial serif display. On chain
                                cards the title drops to Geist 500 for
                                de-emphasis (handled below by the branch). */}
                            {s.cinema.type === 'indie' ? (
                              <h3 className="font-serif text-2xl sm:text-3xl leading-tight tracking-tight text-balance">
                                {s.film.title}
                              </h3>
                            ) : (
                              <h3 className="font-sans font-medium text-lg leading-tight text-balance">
                                {s.film.title}
                              </h3>
                            )}
                            {/* Original title — italic serif subtitle, only
                                when we have it AND it differs from the
                                scraped title. Quoted with Spanish « ». */}
                            {s.film.titleOriginal &&
                              s.film.titleOriginal.toLowerCase() !==
                                s.film.title.toLowerCase() && (
                                <p className="font-serif italic text-ink-gray mt-0.5 text-base sm:text-lg">
                                  «{s.film.titleOriginal}»
                                </p>
                              )}
                            {s.film.director && (
                              <p className="text-sm text-ink-gray mt-1">
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
                                s.cinema.type === 'indie' ? 'text-carmine font-bold' : 'text-ink-gray'
                              }`}
                            >
                              {s.cinema.type === 'indie' && '★ '}
                              {s.cinema.name}
                            </p>
                            {s.cinema.neighborhood && (
                              <p className="text-[11px] font-mono uppercase tracking-wider text-ink-gray mt-1">
                                {s.cinema.neighborhood}
                              </p>
                            )}
                          </div>
                          <time
                            dateTime={s.startsAtUtc.toISOString()}
                            className="font-serif italic text-4xl leading-none text-carmine tabular-nums md:mt-2"
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

        {/* Footer — editorial signature. Kept cream-on-cream so it closes
            the page softly, matching the masthead's editorial weight. */}
        <footer className="mt-20 pt-8 border-t-8 border-double border-black text-center">
          <p className="font-serif italic text-lg">
            Afiche — hecho por cinéfilos, para cinéfilos
          </p>
          <p className="text-[11px] font-mono uppercase tracking-eyebrow text-ink-gray mt-2">
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
      <p className="font-serif italic text-ink-gray text-lg">
        La cartelera se actualiza todas las madrugadas. Volvé en unas horas.
      </p>
      {process.env.NODE_ENV !== 'production' && (
        <p className="font-mono text-[11px] uppercase tracking-eyebrow text-ink-gray/70">
          dev hint: ejecutá <code>npm run db:seed-cinemas</code> y{' '}
          <code>npm run db:scrape</code> para cargar datos
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edition helpers — edition number, week range label, and the full sr-only
// sentence all derive from the same inputs. This is the single source of
// truth for the masthead dateline; the visible mono line and the sr-only
// paragraph both read from this return value.
// ---------------------------------------------------------------------------
interface EditionInfo {
  editionNumber: number;
  weekRangeLabel: string;
  fullSentence: string;
  // True when the programming span fits inside a single calendar week
  // (<=7 days). When false, the masthead drops the "Semana del" framing
  // in favor of an honest "Próximas funciones del X al Y" — otherwise
  // the site labels a 34-day Lugones cycle as a "week," which it isn't.
  isWeekSpan: boolean;
}

function computeEdition(
  days: Array<{ screenings: Array<{ startsAtUtc: Date }> }>,
  totalScreenings: number,
  distinctCinemas: number,
): EditionInfo {
  // All starts, sorted, so we can pick the earliest as the representative
  // date for the ISO week. Data-driven rather than `new Date()` means the
  // edition number always matches the actual programming window.
  const allStarts = days.flatMap((d) => d.screenings.map((s) => s.startsAtUtc));
  const first = allStarts.reduce((a, b) => (a < b ? a : b));
  const last = allStarts.reduce((a, b) => (a > b ? a : b));

  const spanDays = Math.floor((last.getTime() - first.getTime()) / 86_400_000);
  const isWeekSpan = spanDays <= 7;

  const editionNumber = getEditionNumber(first);
  const weekRangeLabel = formatWeekRange(first, last);
  const fullSentence = editionFullSentence({
    editionNumber,
    weekRangeLabel,
    totalScreenings,
    distinctCinemas,
    isWeekSpan,
  });

  return { editionNumber, weekRangeLabel, fullSentence, isWeekSpan };
}

// ---------------------------------------------------------------------------
// Week range helper — bracket the programming span for the masthead.
// Same day   → "23 de abril"
// Same month → "23 al 30 de abril"
// Spanning   → "23 de abril al 5 de mayo"
// ---------------------------------------------------------------------------
function formatWeekRange(first: Date, last: Date): string {
  const fmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: 'numeric',
    month: 'long',
  });

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

// ---------------------------------------------------------------------------
// Short date form for the day banner dateline (e.g., "23 Abr"). Distinct
// from the full `day.label` which reads "miércoles 23 de abril" as a
// screen-reader-friendly full phrase.
// ---------------------------------------------------------------------------
function formatDayShort(dateKey: string): string {
  // dateKey is "YYYY-MM-DD" in BA time; construct a Date at noon UTC to
  // avoid timezone drift when we format in BA.
  const [y, m, d] = dateKey.split('-').map((s) => parseInt(s, 10));
  const date = new Date(Date.UTC(y, m - 1, d, 12));
  const fmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: 'numeric',
    month: 'short',
  });
  const parts = fmt.formatToParts(date);
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  // Month is "abr." — strip trailing dot, capitalize first letter.
  let month = parts.find((p) => p.type === 'month')?.value ?? '';
  month = month.replace(/\.$/, '');
  month = month.charAt(0).toUpperCase() + month.slice(1);
  return `${day} ${month}`;
}
