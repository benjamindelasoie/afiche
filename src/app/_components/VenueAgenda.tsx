import Image from 'next/image';
import {
  formatTimeBA,
  formatAgendaDayBA,
  formatAgendaDayLongBA,
  type DayGroup,
  type ScreeningRow,
} from '@/db/queries';
import { collapseDayByFilm, type DayFilmGroup } from '@/lib/screening-runs';
import { TAG_LABELS_ES } from '@/db';
import { cn } from '@/lib/cn';
import { Pill, StretchedLink, hoverRail } from './ui';

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
  // Within-day collapse (one row per film, same-day showtimes as chips). Only
  // weekly-run venues' "Por día" view passes true; chronological-default venues
  // render the original per-screening rows untouched.
  collapse = false,
}: {
  days: DayGroup[];
  anchorSlugByScreeningId: Map<number, string>;
  collapse?: boolean;
}) {
  return (
    <div className="space-y-8 md:space-y-10">
      {days.map((day) => {
        const {
          dow,
          day: dayNum,
          month,
        } = formatAgendaDayBA(day.screenings[0].startsAtUtc);
        const longLabel = formatAgendaDayLongBA(day.screenings[0].startsAtUtc);
        return (
          <div
            key={day.dateKey}
            className="grid grid-cols-[3.25rem_1fr] gap-4 md:grid-cols-[5rem_1fr] md:gap-6"
          >
            {/* Date rail, promoted to the day group's <h2> so heading
                navigation has a per-day landmark (films below are <h3>).
                Tailwind preflight resets h2 font/margin to inherit, so the
                three-line visual stack is unchanged. The verbose date is the
                screen-reader name; the abbreviated spans are aria-hidden to
                avoid double-announcing. aria-current flags today (parity with
                the homepage day banners). */}
            <h2 aria-current={day.isToday ? 'date' : undefined}>
              <span className="sr-only">
                {day.isToday ? `Hoy, ${longLabel}` : longLabel}
              </span>
              <span
                aria-hidden="true"
                className="tracking-card text-ink-gray block font-mono text-[10px] uppercase"
              >
                {dow}
              </span>
              <span
                aria-hidden="true"
                className={`block font-serif text-4xl leading-none tabular-nums md:text-5xl ${
                  day.isToday ? 'text-carmine font-bold' : 'text-ink'
                }`}
              >
                {dayNum}
              </span>
              <span
                aria-hidden="true"
                className="tracking-card text-ink-gray block font-mono text-[10px] uppercase"
              >
                {month}
              </span>
            </h2>

            <div className="min-w-0 divide-y divide-black/10">
              {collapse
                ? // Collapse view (weekly-run venues' "Por día"): EVERY film
                  // renders as a CollapsedRow so the poster-left column stays
                  // consistent. A single-showtime film shows one time-chip and
                  // keeps its Agendar link (one screening ⇒ unambiguous .ics).
                  // (Using AgendaRow for the single case indented its poster by
                  // the left-time column and broke the row rhythm.)
                  collapseDayByFilm(day).map((g) => {
                    // The program anchor lives on a specific screening; surface
                    // it if any of this film's same-day screenings carries it.
                    const anchorSlug = g.screenings
                      .map((s) => anchorSlugByScreeningId.get(s.id))
                      .find(Boolean);
                    return (
                      <CollapsedRow key={g.film.id} group={g} anchorSlug={anchorSlug} />
                    );
                  })
                : day.screenings.map((s) => (
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
      className={cn(
        'group flex gap-3 py-4 sm:gap-4 [&:has(a:active)]:translate-y-[1px]',
        hoverRail({ inset: 'md', gutter: true }),
      )}
    >
      {s.film.slug && (
        <StretchedLink
          href={`/pelicula/${s.film.slug}`}
          aria-label={`${s.film.title} — ${formatTimeBA(s.startsAtUtc)}`}
        />
      )}

      <time
        dateTime={s.startsAtUtc.toISOString()}
        className="text-carmine w-[3rem] shrink-0 font-serif text-2xl leading-none italic tabular-nums sm:w-[3.75rem] sm:text-3xl"
      >
        {formatTimeBA(s.startsAtUtc)}
      </time>

      <div className="bg-cream flex h-[70px] w-12 shrink-0 items-center justify-center overflow-hidden border border-black shadow-[3px_3px_0_var(--color-carmine)] transition-[box-shadow,transform] duration-150 group-hover:translate-x-px group-hover:translate-y-px group-hover:shadow-[2px_2px_0_var(--color-carmine)] sm:h-24 sm:w-16 sm:shadow-[4px_4px_0_var(--color-carmine)] sm:group-hover:shadow-[3px_3px_0_var(--color-carmine)] lg:h-28 lg:w-20">
        {s.film.posterUrl ? (
          <Image
            src={s.film.posterUrl}
            alt={s.film.title}
            width={80}
            height={112}
            sizes="(min-width: 1024px) 80px, (min-width: 640px) 64px, 48px"
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/no-poster.svg"
            alt=""
            width={64}
            height={96}
            className="h-full w-full object-cover"
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {showTagStrip && (
          <div className="mb-1 flex flex-wrap gap-1.5">
            {visibleTags.map((t) => (
              <Pill key={t}>{TAG_LABELS_ES[t]}</Pill>
            ))}
            {s.programName && (
              <Pill
                variant="ghost"
                title={s.programName}
                className="max-w-[28ch] truncate"
              >
                {s.programName}
              </Pill>
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
            {s.film.runtimeMin ? ` · ${s.film.runtimeMin} min` : null}
          </p>
        )}

        {/* Add-to-calendar, mobile placement: its own line below the meta so
            the title column keeps full width on 375px. Hidden on sm+, where
            the row-level column below takes over. `display:none` drops the
            inactive twin from the a11y tree, so only one Agendar is announced
            at any viewport. */}
        <a
          href={`/api/screening/${s.id}/ics`}
          download
          className="tracking-eyebrow text-ink-gray hover:text-carmine focus-visible:outline-carmine relative z-10 mt-2 inline-flex min-h-[40px] items-center font-mono text-[10px] uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 sm:hidden"
          aria-label={`Agendar ${s.film.title} a las ${formatTimeBA(s.startsAtUtc)} (.ics)`}
        >
          Agendar ⤓
        </a>
      </div>

      {/* Add-to-calendar, desktop placement: vertically centered in the
          right column — fills what used to be the redundant "where" slot, and
          matches /pelicula's "Agendar ⤓". Real <a> to the .ics download, so
          it needs `relative z-10` to sit above the stretched film-page link.
          Every row here is future (expired-today rows are pre-filtered), so
          no isPast guard. */}
      <a
        href={`/api/screening/${s.id}/ics`}
        download
        className="tracking-eyebrow text-ink-gray hover:text-carmine focus-visible:outline-carmine relative z-10 hidden min-h-[44px] shrink-0 items-center self-center font-mono text-[10px] uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 sm:inline-flex"
        aria-label={`Agendar ${s.film.title} a las ${formatTimeBA(s.startsAtUtc)} (.ics)`}
      >
        Agendar ⤓
      </a>
    </article>
  );
}

// A film that screens MORE THAN ONCE on the same agenda day — collapsed to one
// row with its showtimes as carmine chips (no single left-time column, no
// per-row .ics since "which time" is ambiguous). Only fires at venues that
// repeat a film within a day (Lorca/Cosmos in the "Por día" view); repertory
// venues never reach here. The whole row stays the stretched /pelicula link.
function CollapsedRow({
  group,
  anchorSlug,
}: {
  group: DayFilmGroup;
  anchorSlug?: string;
}) {
  const { film, programName, tags, times, screenings } = group;
  // Same tag-strip rule as AgendaRow: 'cycle' is universal noise, the
  // ProgramPill carries the curatorial signal instead.
  const visibleTags = tags.filter((t) => t !== 'cycle');
  const showTagStrip = visibleTags.length > 0 || programName !== null;
  return (
    <article
      id={anchorSlug ? `programa-${anchorSlug}` : undefined}
      className={cn(
        'group flex gap-3 py-4 sm:gap-4 [&:has(a:active)]:translate-y-[1px]',
        hoverRail({ inset: 'md', gutter: true }),
      )}
    >
      {film.slug && (
        <StretchedLink
          href={`/pelicula/${film.slug}`}
          aria-label={`${film.title} — ${times.join(', ')}`}
        />
      )}

      <div className="bg-cream flex h-[70px] w-12 shrink-0 items-center justify-center overflow-hidden border border-black shadow-[3px_3px_0_var(--color-carmine)] transition-[box-shadow,transform] duration-150 group-hover:translate-x-px group-hover:translate-y-px group-hover:shadow-[2px_2px_0_var(--color-carmine)] sm:h-24 sm:w-16 sm:shadow-[4px_4px_0_var(--color-carmine)] sm:group-hover:shadow-[3px_3px_0_var(--color-carmine)] lg:h-28 lg:w-20">
        {film.posterUrl ? (
          <Image
            src={film.posterUrl}
            alt={film.title}
            width={80}
            height={112}
            sizes="(min-width: 1024px) 80px, (min-width: 640px) 64px, 48px"
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/no-poster.svg"
            alt=""
            width={64}
            height={96}
            className="h-full w-full object-cover"
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {showTagStrip && (
          <div className="mb-1 flex flex-wrap gap-1.5">
            {visibleTags.map((t) => (
              <Pill key={t}>{TAG_LABELS_ES[t]}</Pill>
            ))}
            {programName && (
              <Pill variant="ghost" title={programName} className="max-w-[28ch] truncate">
                {programName}
              </Pill>
            )}
          </div>
        )}
        <h3 className="font-serif text-xl leading-tight tracking-[-0.01em] text-balance sm:text-2xl">
          {film.title}
        </h3>
        {film.titleOriginal &&
          film.titleOriginal.toLowerCase() !== film.title.toLowerCase() && (
            <p className="text-ink-gray mt-0.5 font-serif text-sm italic">
              «{film.titleOriginal}»
            </p>
          )}
        {film.director && (
          <p className="text-ink-gray mt-0.5 text-sm">
            {film.director}
            {film.year && ` · ${film.year}`}
            {film.runtimeMin ? ` · ${film.runtimeMin} min` : null}
          </p>
        )}
        <p className="text-carmine mt-2 flex flex-wrap items-baseline font-serif text-lg italic tabular-nums sm:text-xl">
          {times.map((t, i) => (
            <span key={t} className="whitespace-nowrap">
              <time dateTime={screenings[i].startsAtUtc.toISOString()}>{t}</time>
              {i < times.length - 1 && (
                <span aria-hidden="true" className="text-carmine/40 mx-2">
                  ·
                </span>
              )}
            </span>
          ))}
        </p>

        {/* A single-showtime film has exactly one screening, so its .ics is
            unambiguous — keep the add-to-calendar action (a real <a> above the
            stretched /pelicula link, hence relative z-10). Multi-showtime rows
            omit it: "which time" can't be answered. */}
        {screenings.length === 1 && (
          <a
            href={`/api/screening/${screenings[0].id}/ics`}
            download
            className="tracking-eyebrow text-ink-gray hover:text-carmine focus-visible:outline-carmine relative z-10 mt-2 inline-flex min-h-[40px] items-center font-mono text-[10px] uppercase transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
            aria-label={`Agendar ${film.title} a las ${times[0]} (.ics)`}
          >
            Agendar ⤓
          </a>
        )}
      </div>
    </article>
  );
}
