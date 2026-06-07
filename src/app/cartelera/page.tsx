import Link from 'next/link';
import {
  getTwoWeeksScreenings,
  getUpcomingScreenings,
  getLastScrapeTime,
  getLastScreeningPerFilm,
  formatTimeBA,
  formatDayShortBA,
  type WeekGroup,
} from '@/db/queries';
import { DaySection } from '@/app/_components/DaySection';
import { DateStrip } from '@/app/_components/DateStrip';
import { Masthead } from '@/app/_components/Masthead';
import { computeEdition, formatRangeLabel, formatLastScrape } from '@/lib/edition';

// `/cartelera` — the exhaustive, day-by-day cartelera. This is the view the
// homepage used to be; the 2026-06-06 redesign promoted a window-scoped
// group-by-film view to `/` and RELOCATED this full day-grouped view here,
// reachable via the homepage's "Ver todo →". It reassures against the
// illusion-of-completeness risk of the windowed front door: everything is
// still one tap away.
//
// Two tiers (consolidated 2026-05 from 3; see DESIGN.md Decisions Log):
//   1. 14-day rolling window — full cards grouped by day, navigated by the
//      sticky DateStrip below the masthead. Today is always chip 0.
//   2. "Próximamente" — text index, week-grouped, open-ended upper bound.
//
// JSON-LD lives on `/` (the indexed homepage), NOT here — emitting the same
// ScreeningEvents on two indexable pages would duplicate structured data.

// Render dynamically — anchored to BA "today" via `new Date()`. See the
// companion comment in src/app/page.tsx + src/app/api/revalidate/route.ts;
// the scrape webhook fires revalidatePath('/cartelera') alongside '/'.
export const dynamic = 'force-dynamic';

export default async function CarteleraPage() {
  const now = new Date();

  const [twoWeeks, upcoming, lastScrape, lastScreeningPerFilm] = await Promise.all([
    getTwoWeeksScreenings(now),
    getUpcomingScreenings(now),
    getLastScrapeTime(),
    // Per-film MAX(startsAtUtc) across the FULL table — unbounded so the
    // ÚLTIMA FUNCIÓN pill doesn't false-fire for a film that also screens
    // beyond the cartelera horizon.
    getLastScreeningPerFilm(now),
  ]);

  const twoWeeksTotal = twoWeeks.reduce((n, d) => n + d.screenings.length, 0);
  const twoWeeksCinemas = new Set(
    twoWeeks.flatMap((d) => d.screenings.map((s) => s.cinema.id)),
  ).size;

  const edition = computeEdition(now, twoWeeksTotal, twoWeeksCinemas);
  const hasAny = twoWeeks.some((d) => d.screenings.length > 0) || upcoming.length > 0;
  const hasUpcoming = upcoming.length > 0;

  return (
    <>
      <main className="mx-auto w-full max-w-5xl min-w-0 px-4 py-8 sm:px-6 md:py-16">
        <Masthead
          edition={edition}
          funcionesTotal={twoWeeksTotal}
          salasTotal={twoWeeksCinemas}
          wordmarkHref="/"
        />

        {!hasAny ? (
          <EmptyStateAll />
        ) : (
          <>
            <DateStrip days={twoWeeks} hasUpcoming={hasUpcoming} />

            <section id="cartelera" className="mt-6 md:mt-8">
              {twoWeeks.every((d) => d.screenings.length === 0) ? (
                <EmptyWeekMessage hasFollowup={hasUpcoming} />
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
                <SectionHeader
                  title="Próximamente"
                  subtitle={<SectionSubtitle parts={proximamenteSubtitle(upcoming)} />}
                />
                <UpcomingIndex weeks={upcoming} lastScreeningPerFilm={lastScreeningPerFilm} />
              </section>
            )}
          </>
        )}

        {lastScrape && (
          <footer className="mt-20 border-t-8 border-double border-black pt-8 text-center">
            <p className="tracking-eyebrow text-ink-gray font-mono text-[11px] uppercase">
              Actualizado el {formatLastScrape(lastScrape)}
            </p>
          </footer>
        )}
      </main>
    </>
  );
}

// ---------------------------------------------------------------------------
// Section header — serif italic title + mono subtitle (range + counts).
// ---------------------------------------------------------------------------
function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: React.ReactNode;
}) {
  return (
    <div className="py-3 text-center md:py-4">
      <h2 className="font-serif text-4xl leading-none text-balance italic md:text-5xl">
        {title}
      </h2>
      {subtitle ? (
        <p className="tracking-eyebrow text-ink-gray mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 font-mono text-[11px] uppercase md:mt-3">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Próximamente index — week-grouped text index. One banner per ISO week +
// chronological rows beneath.
// ---------------------------------------------------------------------------
function UpcomingIndex({
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
                <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1 px-1 py-3 md:grid-cols-[auto_1fr_auto]">
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
                  <Link
                    href={`/sala/${s.cinema.id}`}
                    className={`tracking-card relative z-10 col-span-2 font-mono text-[11px] whitespace-nowrap uppercase md:col-span-1 ${
                      isIndie ? 'text-carmine font-bold' : 'text-ink-gray'
                    }`}
                  >
                    {s.cinema.name}
                  </Link>
                </div>
              );
              return (
                <li key={s.id}>
                  <div className="hover:bg-carmine/5 relative transition-colors">
                    {s.film.slug && (
                      <Link
                        href={`/pelicula/${s.film.slug}`}
                        data-screening-card
                        className="focus-visible:outline-carmine absolute inset-0 focus-visible:outline-2 focus-visible:outline-offset-2"
                        aria-label={`${s.film.title} — ${s.cinema.name} — ${formatTimeBA(s.startsAtUtc)}`}
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

// ---------------------------------------------------------------------------
// Empty states
// ---------------------------------------------------------------------------
function EmptyStateAll() {
  return (
    <section className="mt-10 md:mt-14">
      <div className="space-y-3 py-12 text-center">
        <p className="text-ink-gray font-serif text-lg italic">
          La cartelera se actualiza todas las madrugadas. Volvé en unas horas.
        </p>
        {process.env.NODE_ENV !== 'production' && (
          <p className="tracking-eyebrow text-ink-gray/70 font-mono text-[11px] uppercase">
            dev hint: ejecutá <code>npm run db:seed-cinemas</code> y{' '}
            <code>npm run db:scrape</code> para cargar datos
          </p>
        )}
      </div>
    </section>
  );
}

function EmptyWeekMessage({ hasFollowup }: { hasFollowup: boolean }) {
  return (
    <div className="space-y-3 py-8 text-center">
      <p className="text-ink-gray font-serif text-lg italic">
        Esta semana las salas descansan.
      </p>
      {hasFollowup && (
        <p className="tracking-eyebrow text-ink-gray font-mono text-[11px] uppercase">
          Lo que viene ↓
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subtitle builders — return {range, counts} so the page can hide counts on
// mobile (hidden md:inline) while keeping the range always visible.
// ---------------------------------------------------------------------------
interface SectionSubtitleParts {
  range: string;
  counts: string;
}

function countsLabel(total: number, cinemas: number): string {
  return `${total} ${total === 1 ? 'función' : 'funciones'} en ${cinemas} ${cinemas === 1 ? 'sala' : 'salas'}`;
}

function proximamenteSubtitle(weeks: WeekGroup[]): SectionSubtitleParts {
  const flat = weeks.flatMap((w) => w.screenings);
  const first = flat[0].startsAtUtc;
  const last = flat[flat.length - 1].startsAtUtc;
  const cinemas = new Set(flat.map((r) => r.cinema.id)).size;
  return {
    range: formatRangeLabel(first, last),
    counts: countsLabel(flat.length, cinemas),
  };
}

function SectionSubtitle({ parts }: { parts: SectionSubtitleParts }) {
  return (
    <>
      <span>{parts.range}</span>
      <span className="text-ink-gray/60 hidden md:inline">·</span>
      <span className="hidden md:inline">{parts.counts}</span>
    </>
  );
}
