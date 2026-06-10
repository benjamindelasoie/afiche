'use client';

/**
 * ShowtimesDisclosure — the only client component on the redesigned homepage.
 *
 * A multi-showtime film row collapses to a one-line summary (lead time +
 * "{n} funciones · {venue}" + caret) and tap-expands to its full showtimes.
 * In the single-day `hoy` window it expands by default and lists times grouped
 * by venue; in the multi-day windows (`finde`/`semana`/`prox`) it stays
 * collapsed and, when opened, groups times by day under each venue (capped at
 * a few days + "ver todas →" to /pelicula). This is the anti-bloat structure
 * that keeps a 25-showtime heavy-tail film to one line by default.
 *
 * Receives a fully pre-formatted, serializable view-model from FilmRow (the
 * server component) — no DB types, no Date objects, no Intl here — so all the
 * BA-timezone formatting stays server-side and out of the client bundle.
 *
 * Tap model: the toggle is a real <button> raised above the row's stretched
 * card link (relative z-10, keyboard-focusable). Inner time links open the
 * ticketing URL; venue labels link to /sala. No nested <a>.
 */

import { useState } from 'react';
import Link from 'next/link';

export interface DisclosureTime {
  id: number;
  time: string;
  /** ISO instant for the <time dateTime> attribute. */
  iso: string;
  /** Ticketing/source URL, or null when the venue exposes none. */
  href: string | null;
  isPast: boolean;
}

export interface DisclosureDay {
  key: string;
  /** Day chip label ("Hoy" / "Vie 6") — rendered only in multi-day windows. */
  label: string;
  times: DisclosureTime[];
}

export interface DisclosureVenue {
  cinemaId: string;
  cinemaName: string;
  cinemaHref: string;
  /** One entry per day. A single entry (label unused) in the `hoy` window. */
  days: DisclosureDay[];
  /** Short weekday names of days beyond the per-venue cap (multi-day only). */
  omittedDayNames: string[];
}

export interface ShowtimesDisclosureProps {
  venues: DisclosureVenue[];
  /** Multi-day window — group expanded times by day and show day chips. */
  multiDay: boolean;
  defaultOpen: boolean;
  /** Soonest catchable time, shown in the collapsed summary. */
  leadTime: string | null;
  /** Relative-day hint beside the lead time (multi-day only): "Hoy" / "Vie 6". */
  leadDayHint: string | null;
  /** Right-hand summary text, e.g. "4 funciones hoy · Sala Lugones". */
  summaryRest: string;
  /** /pelicula/{slug} target for "ver todas →"; null when the film has no slug. */
  verTodasHref: string | null;
  /** Film title — for the toggle's aria-label. */
  filmTitle: string;
}

const TIME_CLASS =
  'font-serif text-[23px] italic leading-none tabular-nums md:text-[25px]';

function TimeItem({ t }: { t: DisclosureTime }) {
  if (t.isPast) {
    return (
      <time dateTime={t.iso} className={`${TIME_CLASS} text-ink-gray line-through`}>
        {t.time}
      </time>
    );
  }
  if (t.href) {
    return (
      <a
        href={t.href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Comprar entradas — ${t.time}`}
        // relative z-10: raise above the row's stretched card-link overlay so
        // the ticket tap reaches the ticketing URL, not /pelicula.
        className={`${TIME_CLASS} text-carmine focus-visible:outline-carmine relative z-10 focus-visible:outline-2 focus-visible:outline-offset-2`}
      >
        {t.time}
      </a>
    );
  }
  return (
    <time dateTime={t.iso} className={`${TIME_CLASS} text-carmine`}>
      {t.time}
    </time>
  );
}

function TimeRow({ times }: { times: DisclosureTime[] }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-3.5 gap-y-2">
      {times.map((t) => (
        <TimeItem key={t.id} t={t} />
      ))}
    </span>
  );
}

export function ShowtimesDisclosure({
  venues,
  multiDay,
  defaultOpen,
  leadTime,
  leadDayHint,
  summaryRest,
  verTodasHref,
  filmTitle,
}: ShowtimesDisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`${open ? 'Ocultar' : 'Ver'} funciones de ${filmTitle}`}
        className="focus-visible:outline-carmine relative z-10 mt-2.5 flex min-h-11 w-full items-center gap-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 md:mt-3.5"
      >
        {!open && leadTime ? (
          <span className="flex items-baseline gap-1.5">
            <span className="text-carmine font-serif text-[26px] leading-none italic tabular-nums md:text-[30px]">
              {leadTime}
            </span>
            {leadDayHint ? (
              <span className="tracking-card text-ink-gray font-mono text-[9px] uppercase">
                {leadDayHint}
              </span>
            ) : null}
          </span>
        ) : null}
        <span className="tracking-card text-ink-gray font-mono text-[10px] uppercase">
          {summaryRest}
        </span>
        <span
          aria-hidden
          className={`ml-auto font-serif text-2xl leading-none ${open ? 'text-carmine' : 'text-ink-gray'}`}
        >
          {open ? '–' : '+'}
        </span>
      </button>

      {open ? (
        <div className="mt-3">
          {venues.map((v) => (
            <div key={v.cinemaId} className="mt-3 first:mt-0">
              <Link
                href={v.cinemaHref}
                className="text-ink-gray relative z-10 mb-1.5 inline-block font-mono text-[9px] tracking-[0.16em] uppercase"
              >
                {v.cinemaName}
              </Link>
              {multiDay ? (
                <div>
                  {v.days.map((day) => (
                    <div
                      key={day.key}
                      className="mt-2 flex items-baseline gap-3 first:mt-0"
                    >
                      <span className="tracking-card text-ink min-w-[62px] font-mono text-[10px] uppercase">
                        {day.label}
                      </span>
                      <TimeRow times={day.times} />
                    </div>
                  ))}
                  {v.omittedDayNames.length > 0 ? (
                    verTodasHref ? (
                      <Link
                        href={verTodasHref}
                        className="text-carmine relative z-10 mt-2 inline-block font-mono text-[10px] tracking-[0.1em] uppercase"
                      >
                        + {v.omittedDayNames.join(', ')} · ver todas →
                      </Link>
                    ) : (
                      <span className="text-ink-gray mt-2 inline-block font-mono text-[10px] tracking-[0.1em] uppercase">
                        + {v.omittedDayNames.join(', ')}
                      </span>
                    )
                  ) : null}
                </div>
              ) : (
                <TimeRow times={v.days[0]?.times ?? []} />
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
