import { cache } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  getCinema,
  getTwoWeeksScreeningsByCinema,
  getUpcomingScreeningsByCinema,
  groupCiclos,
  visibleAgendaDays,
  formatTimeBA,
  formatDayShortBA,
  type WeekGroup,
} from '@/db/queries';
import { VenueAgenda } from '@/app/_components/VenueAgenda';
import { CiclosEnCurso } from '@/app/_components/CiclosEnCurso';
import { VenueAbout } from '@/app/_components/VenueAbout';
import { getVenueInfo, hasVenueInfo } from '@/data/venue-info';

export const dynamic = 'force-dynamic';

// Cinema IDs are lowercase slugs (e.g. "malba", "cine-cosmos").
const ID_RE = /^[a-z0-9][a-z0-9-]{0,49}$/;

const lookupCinema = cache(async (id: string) => {
  if (!ID_RE.test(id)) return null;
  return getCinema(id);
});

interface Params {
  id: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { id } = await params;
  const cinema = await lookupCinema(id);
  if (!cinema) return {};
  const title = cinema.neighborhood
    ? `${cinema.name} · ${cinema.neighborhood}`
    : cinema.name;
  return {
    title,
    description: `Cartelera de ${cinema.name}${cinema.neighborhood ? ` en ${cinema.neighborhood}` : ''} — funciones de la semana en Buenos Aires.`,
    robots: { index: false, follow: true },
  };
}

export default async function SalaPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const cinema = await lookupCinema(id);
  if (!cinema) notFound();

  const now = new Date();
  const [twoWeeks, upcoming] = await Promise.all([
    getTwoWeeksScreeningsByCinema(id, now),
    getUpcomingScreeningsByCinema(id, now),
  ]);

  // Drop expired-today rows then empty days. Everything downstream (ciclos,
  // hasAgenda, the empty-state guard) is computed from these VISIBLE rows —
  // never the raw query — or a venue with only past-today screenings would slip
  // past the empty state into a blank agenda. See visibleAgendaDays.
  const visibleDays = visibleAgendaDays(twoWeeks, now);

  // Ciclos are derived from the visible agenda only (v1), so every ciclo has an
  // anchor row in the agenda — no future-only / Próximamente-fallback case.
  const ciclos = groupCiclos(visibleDays.flatMap((d) => d.screenings));
  const anchorSlugByScreeningId = new Map(
    ciclos.map((c) => [c.anchorScreeningId, c.slug]),
  );

  const hasAgenda = visibleDays.length > 0;
  const hasUpcoming = upcoming.length > 0;
  const hasAny = hasAgenda || hasUpcoming;

  const venueInfo = getVenueInfo(id);

  const mapsHref = cinema.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${cinema.name} ${cinema.address} Buenos Aires Argentina`,
      )}`
    : null;

  return (
    <main className="mx-auto w-full max-w-5xl min-w-0 px-4 py-8 sm:px-6 md:py-16">
      <Link
        href="/"
        className="tracking-eyebrow text-carmine mb-6 inline-flex min-h-[44px] items-center font-mono text-[11px] uppercase"
      >
        <span className="border-carmine border-b">← Cartelera</span>
      </Link>

      {/* Utility header: venue name (display-page-title scale) + address on the
          left; the official-site action sits top-right on desktop, stacked below
          on mobile. Type ("Cine independiente") and neighborhood were dropped —
          redundant on an indie-circuit venue page where the address already
          answers "where", and the name is the only identity that matters. */}
      <header className="mb-8 md:mb-12 md:flex md:items-start md:justify-between md:gap-6">
        <div className="min-w-0">
          <h1 className="font-serif text-[clamp(2.5rem,8vw,4.5rem)] leading-[0.95] tracking-[-0.01em] text-balance">
            {cinema.name}
          </h1>
          {mapsHref && (
            <a
              href={mapsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink-gray hover:text-carmine mt-3 inline-flex min-h-[44px] items-center gap-1.5 font-mono text-[11px] tracking-wider uppercase transition-colors"
              aria-label={`Ver en Google Maps — ${cinema.address}`}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-3.5 w-3.5 shrink-0 fill-current"
              >
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
              </svg>
              <span className="border-ink-gray/40 border-b pb-0.5">{cinema.address}</span>
            </a>
          )}
        </div>
        {cinema.ticketingBaseUrl && (
          <a
            href={cinema.ticketingBaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="tracking-card bg-carmine text-cream focus-visible:outline-carmine mt-4 inline-flex min-h-[44px] shrink-0 items-center px-3 font-mono text-[11px] uppercase focus-visible:outline-2 focus-visible:outline-offset-2 md:mt-2"
            aria-label={`Sitio oficial de ${cinema.name}`}
          >
            Sitio oficial →
          </a>
        )}
      </header>

      {hasVenueInfo(venueInfo) && <VenueAbout info={venueInfo} />}

      {!hasAny ? (
        <p className="text-ink-gray py-12 text-center font-serif text-lg italic">
          Por ahora, esta sala descansa.
        </p>
      ) : (
        <>
          {ciclos.length > 0 && (
            <div className="mb-10">
              <CiclosEnCurso ciclos={ciclos} />
            </div>
          )}

          <section id="cartelera">
            {hasAgenda ? (
              <VenueAgenda
                days={visibleDays}
                anchorSlugByScreeningId={anchorSlugByScreeningId}
              />
            ) : (
              <p className="text-ink-gray py-8 font-serif text-lg italic">
                Esta quincena, la sala descansa.{' '}
                {hasUpcoming && (
                  <a
                    href="#proximamente"
                    className="tracking-eyebrow text-carmine border-carmine ml-1 border-b font-mono text-[11px] uppercase not-italic"
                  >
                    Lo que viene ↓
                  </a>
                )}
              </p>
            )}
          </section>

          {hasUpcoming && (
            <section id="proximamente" className="mt-16 md:mt-24">
              <div className="py-3 text-center md:py-4">
                <h2 className="font-serif text-4xl leading-none text-balance italic md:text-5xl">
                  Próximamente
                </h2>
              </div>
              <SalaUpcomingIndex weeks={upcoming} />
            </section>
          )}
        </>
      )}
    </main>
  );
}

// Próximamente index for the cinema page. Omits the cinema column (redundant
// on a page already scoped to one venue) — shows date, time, and film title.
// No "última función" pill here: that signal means "last showing across all of
// BA", which is off-topic on a single-venue schedule, and computing it cost an
// unbounded all-screenings scan we dropped from this page (eng-review perf).
function SalaUpcomingIndex({ weeks }: { weeks: WeekGroup[] }) {
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
              const rowBody = (
                <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1 px-1 py-3">
                  <div className="tracking-eyebrow font-mono text-[11px] whitespace-nowrap uppercase">
                    <span className="text-ink-gray">
                      {formatDayShortBA(s.startsAtUtc)}
                    </span>
                    <span className="text-ink-gray/60 mx-1">·</span>
                    <span className={isIndie ? 'text-carmine font-bold' : 'text-ink'}>
                      {formatTimeBA(s.startsAtUtc)}
                    </span>
                  </div>
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
                  </div>
                </div>
              );
              return (
                <li key={s.id}>
                  <div className="before:bg-carmine relative transition-colors before:absolute before:top-3 before:bottom-3 before:left-0 before:w-[3px] before:origin-top before:scale-y-0 before:transition-transform before:duration-150 hover:bg-black/[0.025] hover:before:scale-y-100">
                    {s.film.slug && (
                      <Link
                        href={`/pelicula/${s.film.slug}`}
                        data-screening-card
                        className="focus-visible:outline-carmine absolute inset-0 focus-visible:outline-2 focus-visible:outline-offset-2"
                        aria-label={`${s.film.title} — ${formatDayShortBA(s.startsAtUtc)} ${formatTimeBA(s.startsAtUtc)}`}
                      />
                    )}
                    {rowBody}
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
