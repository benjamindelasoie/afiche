import { cache } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  getCinema,
  getTwoWeeksScreeningsByCinema,
  getUpcomingScreeningsByCinema,
  getLastScreeningPerFilm,
  formatTimeBA,
  formatDayShortBA,
  type WeekGroup,
} from '@/db/queries';
import { DateStrip } from '@/app/_components/DateStrip';
import { DaySection } from '@/app/_components/DaySection';

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
  const [twoWeeks, upcoming, lastScreeningPerFilm] = await Promise.all([
    getTwoWeeksScreeningsByCinema(id, now),
    getUpcomingScreeningsByCinema(id, now),
    getLastScreeningPerFilm(now),
  ]);

  const hasAny = twoWeeks.some((d) => d.screenings.length > 0) || upcoming.length > 0;
  const hasUpcoming = upcoming.length > 0;

  return (
    <main className="mx-auto w-full max-w-5xl min-w-0 px-4 py-8 sm:px-6 md:py-16">
      <Link
        href="/"
        className="tracking-eyebrow text-carmine border-carmine mb-8 inline-block border-b font-mono text-[11px] uppercase"
      >
        ← Cartelera
      </Link>

      <header className="mb-8 md:mb-12">
        <p className="tracking-eyebrow text-carmine mb-2 font-mono text-[11px] uppercase">
          {cinema.type === 'indie' ? 'Cine independiente' : 'Multiplex'}
          {cinema.neighborhood && ` · ${cinema.neighborhood}`}
        </p>
        <h1 className="font-serif text-4xl leading-tight tracking-[-0.01em] text-balance md:text-6xl">
          {cinema.name}
        </h1>
        {cinema.address && (
          <p className="text-ink-gray mt-3 font-mono text-[11px] tracking-wider uppercase">
            {cinema.address}
          </p>
        )}
      </header>

      {!hasAny ? (
        <p className="text-ink-gray py-12 text-center font-serif text-lg italic">
          No hay funciones programadas en este momento.
        </p>
      ) : (
        <>
          <DateStrip days={twoWeeks} hasUpcoming={hasUpcoming} />

          <section id="cartelera" className="mt-6 md:mt-8">
            {twoWeeks.every((d) => d.screenings.length === 0) ? (
              <p className="text-ink-gray py-8 text-center font-serif text-lg italic">
                Esta semana las salas descansan.
              </p>
            ) : (
              <div className="mt-10 space-y-12">
                {twoWeeks.map((day, dayIdx) => (
                  <DaySection
                    key={day.dateKey}
                    day={day}
                    isFirstDay={dayIdx === 0}
                    lastScreeningPerFilm={lastScreeningPerFilm}
                    now={now}
                  />
                ))}
              </div>
            )}
          </section>

          {hasUpcoming && (
            <section id="proximamente" className="mt-16 md:mt-24">
              <div className="py-3 text-center md:py-4">
                <h2 className="font-serif text-4xl leading-none text-balance italic md:text-5xl">
                  Próximamente
                </h2>
              </div>
              <SalaUpcomingIndex
                weeks={upcoming}
                lastScreeningPerFilm={lastScreeningPerFilm}
              />
            </section>
          )}
        </>
      )}
    </main>
  );
}

// Próximamente index for the cinema page. Omits the cinema column (redundant
// on a page that is already scoped to one venue) — shows date, time, and
// film title only.
function SalaUpcomingIndex({
  weeks,
  lastScreeningPerFilm,
}: {
  weeks: WeekGroup[];
  lastScreeningPerFilm: Map<number, number>;
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
                lastScreeningPerFilm.get(s.film.id) === s.startsAtUtc.getTime();
              const rowBody = (
                <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1 px-1 py-3">
                  <div className="tracking-eyebrow font-mono text-[11px] whitespace-nowrap uppercase">
                    <span className="text-ink-gray">{formatDayShortBA(s.startsAtUtc)}</span>
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
                    {isLastFunction && (
                      <span className="tracking-card bg-carmine text-cream ml-2 px-1.5 py-0.5 align-middle font-mono text-[10px] uppercase">
                        Última
                      </span>
                    )}
                  </div>
                </div>
              );
              return (
                <li key={s.id}>
                  <div className="relative hover:bg-carmine/5 transition-colors">
                    {s.film.slug && (
                      <Link
                        href={`/pelicula/${s.film.slug}`}
                        data-screening-card
                        className="absolute inset-0 focus-visible:outline-carmine focus-visible:outline-2 focus-visible:outline-offset-2"
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
