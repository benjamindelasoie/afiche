import Image from 'next/image';
import Link from 'next/link';
import {
  formatTimeBA,
  formatAgendaDayBA,
  type DayGroup,
  type ScreeningRow,
} from '@/db/queries';
import { TAG_LABELS_ES } from '@/db';

// ---------------------------------------------------------------------------
// VenueAgenda — the /sala/<id> week, rendered as a date-rail agenda rather
// than the homepage's bordered ScreeningCard stack. A single-screen venue has
// no screening overlap, so the honest shape is a chronological programme, not
// a feed of cards (see DESIGN.md 2026-05-25 decisions-log).
//
//   left rail (dow · big serif day number · month)   |   screening rows
//
// Days are pre-filtered by the page: expired-today rows removed, then empty
// days dropped entirely (dark days simply don't appear — no "las salas
// descansan" filler). So `days` here is always non-empty and every day has
// ≥1 screening.
// ---------------------------------------------------------------------------
export function VenueAgenda({
  days,
  // screeningId → ciclo slug, for the rows that are a program's FIRST visible
  // screening. That row gets id="programa-<slug>" so the Ciclos block can
  // anchor-jump to it. Built by the page from groupCiclos().
  anchorSlugByScreeningId,
}: {
  days: DayGroup[];
  anchorSlugByScreeningId: Map<number, string>;
}) {
  return (
    <div className="space-y-8 md:space-y-10">
      {days.map((day) => {
        const {
          dow,
          day: dayNum,
          month,
        } = formatAgendaDayBA(day.screenings[0].startsAtUtc);
        return (
          <div
            key={day.dateKey}
            className="grid grid-cols-[3.25rem_1fr] gap-4 md:grid-cols-[5rem_1fr] md:gap-6"
          >
            {/* Date rail. aria-current flags today for assistive tech (parity
                with the homepage day banners). */}
            <div aria-current={day.isToday ? 'date' : undefined}>
              <span className="tracking-card text-ink-gray block font-mono text-[10px] uppercase">
                {dow}
              </span>
              <span
                className={`block font-serif text-4xl leading-none tabular-nums md:text-5xl ${
                  day.isToday ? 'text-carmine font-bold' : 'text-ink'
                }`}
              >
                {dayNum}
              </span>
              <span className="tracking-card text-ink-gray block font-mono text-[10px] uppercase">
                {month}
              </span>
            </div>

            <div className="min-w-0 divide-y divide-black/10">
              {day.screenings.map((s) => (
                <AgendaRow
                  key={s.id}
                  s={s}
                  anchorSlug={anchorSlugByScreeningId.get(s.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// One screening row. Stretched-link pattern (same as ScreeningCard): the
// <article> is the visual row; an invisible absolute <Link> covers it for the
// /pelicula tap target. Keeping the row a link to the film page is load-bearing
// — it's the only way off the agenda into film context (eng-review P1).
function AgendaRow({ s, anchorSlug }: { s: ScreeningRow; anchorSlug?: string }) {
  // 'cycle' is on every card from cycle-organizing venues, so it's noise here;
  // the ProgramPill below carries the curatorial signal instead.
  const visibleTags = s.tags.filter((t) => t !== 'cycle');
  const showTagStrip = visibleTags.length > 0 || s.programName !== null;

  return (
    <article
      // Anchor target for the Ciclos block's jump, placed on the program's
      // first visible screening. The global `scroll-padding-top: 70px` on the
      // scrollport (globals.css) supplies the landing offset — no scroll-mt
      // here or the two would compound into a large dead gap.
      id={anchorSlug ? `programa-${anchorSlug}` : undefined}
      className="hover:bg-carmine/5 relative flex gap-3 py-4 transition-colors sm:gap-4 [&:has(a:active)]:translate-y-[1px]"
    >
      {s.film.slug && (
        <Link
          href={`/pelicula/${s.film.slug}`}
          data-screening-card
          className="focus-visible:outline-carmine absolute inset-0 focus-visible:outline-2 focus-visible:outline-offset-2"
          aria-label={`${s.film.title} — ${formatTimeBA(s.startsAtUtc)}`}
        />
      )}

      <time
        dateTime={s.startsAtUtc.toISOString()}
        className="text-carmine w-[3rem] shrink-0 font-serif text-2xl leading-none italic tabular-nums sm:w-[3.75rem] sm:text-3xl"
      >
        {formatTimeBA(s.startsAtUtc)}
      </time>

      <div className="bg-cream flex h-[62px] w-11 shrink-0 items-center justify-center overflow-hidden border border-black shadow-[3px_3px_0_var(--color-carmine)]">
        {s.film.posterUrl ? (
          <Image
            src={s.film.posterUrl}
            alt={s.film.title}
            width={44}
            height={62}
            sizes="44px"
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/no-poster.svg"
            alt=""
            width={44}
            height={62}
            className="h-full w-full object-cover"
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {showTagStrip && (
          <div className="mb-1 flex flex-wrap gap-1.5">
            {visibleTags.map((t) => (
              <span
                key={t}
                className="tracking-card bg-carmine text-cream px-1.5 py-0.5 font-mono text-[10px] uppercase"
              >
                {TAG_LABELS_ES[t]}
              </span>
            ))}
            {s.programName && (
              <span
                title={s.programName}
                className="tracking-card text-carmine border-carmine/40 max-w-[28ch] truncate border px-1.5 py-0.5 font-mono text-[10px] uppercase"
              >
                {s.programName}
              </span>
            )}
          </div>
        )}
        <h3 className="font-serif text-xl leading-tight tracking-[-0.01em] text-balance sm:text-2xl">
          {s.film.title}
        </h3>
        {s.film.titleOriginal &&
          s.film.titleOriginal.toLowerCase() !== s.film.title.toLowerCase() && (
            <p className="text-ink-gray mt-0.5 font-serif text-sm italic">
              «{s.film.titleOriginal}»
            </p>
          )}
        {s.film.director && (
          <p className="text-ink-gray mt-0.5 text-sm">
            {s.film.director}
            {s.film.year && ` · ${s.film.year}`}
            {s.film.runtimeMin && ` · ${s.film.runtimeMin} min`}
          </p>
        )}
      </div>
    </article>
  );
}
