import {
  getTwoWeeksScreenings,
  getUpcomingScreenings,
  getLastScrapeTime,
  getLastScreeningPerFilm,
  type WeekGroup,
} from '@/db/queries';
import { DaySection } from '@/app/_components/DaySection';
import { DateStrip } from '@/app/_components/DateStrip';
import { Masthead } from '@/app/_components/Masthead';
import { UpcomingIndex } from '@/app/_components/UpcomingIndex';
import {
  PageShell,
  ContentColumn,
  PageFooter,
  SectionHeading,
} from '@/app/_components/ui';
import { computeEdition, formatRangeLabel } from '@/lib/edition';

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
      <PageShell width="6xl" pad="flush">
        <Masthead
          edition={edition}
          funcionesTotal={twoWeeksTotal}
          salasTotal={twoWeeksCinemas}
          wordmarkHref="/"
        />

        {/* Content clamps to the DESIGN.md 5xl single-column reading width;
            the masthead + footer above/below span the wider 6xl chrome so the
            header matches the homepage's (2026-07-25 chrome/content split). */}
        <ContentColumn width="5xl">
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
                  <SectionHeading
                    subtitle={<SectionSubtitle parts={proximamenteSubtitle(upcoming)} />}
                  >
                    Próximamente
                  </SectionHeading>
                  <UpcomingIndex
                    weeks={upcoming}
                    showCinema
                    lastScreeningPerFilm={lastScreeningPerFilm}
                  />
                </section>
              )}
            </>
          )}
        </ContentColumn>

        <PageFooter lastScrape={lastScrape} />
      </PageShell>
    </>
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
