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
import { DaySection } from './_components/DaySection';
import { getEditionNumber, editionFullSentence } from '@/lib/iso-week';
import { getIsoWeekStartBA, getIsoWeekEndBA, BA_TZ } from '@/lib/date-ranges';
import { JsonLd, buildHomepageJsonLd } from '@/lib/json-ld';
import { DateStrip } from '@/app/_components/DateStrip';

// This page is a Server Component — it runs on the server, awaits the DB
// directly, and ships rendered HTML. The only client-side JS is the
// DateStrip Client Component below the masthead, which uses
// IntersectionObserver to highlight the chip whose day section is in view
// while the user scrolls.
//
// The view is a 2-tier cartelera (consolidated 2026-05 from 3 tiers; see
// DESIGN.md Decisions Log):
//
//   1. 14-day rolling window — full cards grouped by day, navigated by
//      the sticky DateStrip below the masthead. Today is always chip 0;
//      the strip extends 13 more days forward, regardless of weekday.
//   2. "Próximamente" — text index, week-grouped. One banner per ISO
//      week ("Semana del 19 al 25 de mayo") + chronological rows. Open-
//      ended upper bound. Reachable via the strip's trailing chip.
//
// The masthead carries decorative editorial framing ("Edición Nº N ·
// Semana del X al Y") anchored to the current ISO week — flavor only,
// decoupled from cartelera content boundaries. The cartelera shows 14
// days regardless of where in the week the user lands.

// Render dynamically. The cartelera is anchored to BA "today" via
// `new Date()` below; without this directive Next.js statically renders the
// page (no dynamic primitives, no fetch — drizzle/Turso reads don't signal
// dynamic), bakes `now` into the cached HTML, and only invalidates when
// `revalidatePath('/')` fires from the scrape webhook. On a day with no
// fresh scrape, BA midnight rollover then leaves yesterday's edition (and
// yesterday's screenings) on the page until the next scrape lands. See
// src/app/api/revalidate/route.ts for the companion comment.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const now = new Date();

  const [twoWeeks, upcoming, lastScrape, lastScreeningPerFilm] = await Promise.all([
    getTwoWeeksScreenings(now),
    getUpcomingScreenings(now),
    getLastScrapeTime(),
    // Per-film MAX(startsAtUtc) across the FULL screenings table.
    // Used by ÚLTIMA FUNCIÓN pill — unbounded by cartelera tier
    // horizons so a film with a screening this week AND another 8
    // weeks out doesn't get falsely flagged on this week's row.
    getLastScreeningPerFilm(now),
  ]);

  // Masthead counts reflect the 14-day window (the visible cartelera).
  // The "Edición Nº · Semana del X al Y" text is anchored to the ISO week
  // (decorative), while the SR-only fullSentence reports what's actually
  // shown — the page below is what these numbers describe.
  const twoWeeksTotal = twoWeeks.reduce((n, d) => n + d.screenings.length, 0);
  const twoWeeksCinemas = new Set(
    twoWeeks.flatMap((d) => d.screenings.map((s) => s.cinema.id)),
  ).size;

  const edition = computeEdition(now, twoWeeksTotal, twoWeeksCinemas);
  const hasAny = twoWeeks.some((d) => d.screenings.length > 0) || upcoming.length > 0;
  const hasUpcoming = upcoming.length > 0;

  // Schema.org JSON-LD events for the 7-day high-intent window. Built
  // from the visible 14-day cartelera (the helper internally filters to
  // today + next 6 days per eng-review D3). Returns one ScreeningEvent
  // payload per upcoming screening; each gets its own <script> tag
  // below (Google's documented pattern for multi-event pages — a single
  // @graph wrapper trips the Rich Results validator as "unknown-type").
  // Empty array is fine when the cartelera is empty.
  const jsonLdEvents = buildHomepageJsonLd(
    twoWeeks.flatMap((d) => d.screenings),
    { now },
  );

  return (
    <>
      {/* Skip link — keyboard users tab onto this first; hits the main
          content, bypassing the masthead. Visually hidden by default,
          shown on focus. */}
      <a
        href="#cartelera"
        className="focus:text-cream focus:tracking-card sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-black focus:px-3 focus:py-2 focus:font-mono focus:text-sm focus:uppercase"
      >
        Saltar al contenido
      </a>
      {jsonLdEvents.map((event, i) => (
        <JsonLd key={i} payload={event} />
      ))}
      <main className="mx-auto w-full max-w-5xl min-w-0 px-4 py-8 sm:px-6 md:py-16">
        {/* Masthead — full editorial layout. Top kicker carries the
            location identity; the wordmark sits in the middle; bottom
            dateline carries the dynamic edition number + week range.
            Top + bottom split duties: no edition number or year repeats
            anywhere on the page. The Esta semana section header below
            drops its edition subtitle since the masthead now owns it.
            tracking-[-0.02em] matches DESIGN.md's display-xl spec
            exactly; explicit fontKerning + fontFeatureSettings turn on
            the Instrument Serif fi ligature next/font ships with but
            doesn't apply by default. */}
        <header className="py-8 text-center md:py-10">
          <div className="bg-carmine/80 mx-auto mb-2 h-[2px] w-[36%] max-w-[260px] md:mb-3 md:w-[44%]" />
          <p className="text-carmine mb-3 font-mono text-[11px] tracking-[0.2em] uppercase md:mb-3">
            Buenos Aires · cartelera curada
          </p>
          {/* Wordmark scale: now that 'Esta semana' is hidden on mobile,
              the masthead is the whole top of the page on small screens.
              Bumping the floor from 3.5rem → 4.5rem (56px → 72px) gives
              the wordmark the presence the page used to borrow from the
              section header. clamp's middle (12vw) and cap (8rem) are
              unchanged — desktop sizing is identical. */}
          <h1
            className="font-serif leading-[0.9] tracking-[-0.02em] text-balance"
            style={{
              fontSize: 'clamp(4.5rem, 12vw, 8rem)',
              fontKerning: 'normal',
              fontFeatureSettings: '"liga", "kern"',
            }}
          >
            Afiche
          </h1>
          {/* Dateline stacks on mobile (Edición number above, week range
              below — centered) and switches to a justified row on md+
              where there's room to breathe. Stacking dodges the ~360px
              minimum width the row needs at mobile font + tracking,
              which was clipping the date range off the right edge on
              375px viewports. Mobile font bumped to 11px (was 10px) to
              balance the now-larger wordmark. */}
          <div className="mx-auto mt-4 flex max-w-[28rem] flex-col items-center gap-y-1 border-t border-black px-1 pt-3 font-mono text-[11px] tracking-[0.15em] uppercase md:mt-4 md:flex-row md:justify-between md:gap-x-6 md:pt-2">
            <span className="text-carmine font-bold">
              Edición Nº {edition.editionNumber}
            </span>
            <span className="text-ink-gray">{edition.weekRangeShort}</span>
          </div>
          {/* Full edition sentence for screen readers — the visible
              dateline above is abbreviated for mobile-first layout, so
              the long form lives here for assistive tech. */}
          <p className="sr-only">{edition.fullSentence}</p>
        </header>

        {!hasAny ? (
          <EmptyStateAll />
        ) : (
          <>
            {/* Sticky date-strip nav. Lives in normal flow on first
                paint (under the masthead); pins to top once the user
                scrolls past the masthead. Today is always position 0. */}
            <DateStrip days={twoWeeks} hasUpcoming={hasUpcoming} />

            {/* Tier 1 — 14-day rolling window. Full cards grouped by day.
                Every day in the rolling window renders, including days
                with zero screenings (banner + editorial empty copy).
                The strip's chips anchor-jump to each day's <h2>.
                Section header is suppressed — the strip is the wayfinding
                layer; an extra "Esta semana" stacked title would be redundant
                editorial chrome. */}
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

            {/* Tier 2 — Próximamente. Awareness layer. Text index,
                week-grouped. One banner per ISO week starting from
                day 15. Reachable via the strip's trailing "→" chip. */}
            {hasUpcoming && (
              <section id="proximamente" className="mt-16 md:mt-24">
                <SectionHeader
                  title="Próximamente"
                  subtitle={<SectionSubtitle parts={proximamenteSubtitle(upcoming)} />}
                />
                <UpcomingIndex
                  weeks={upcoming}
                  lastScreeningPerFilm={lastScreeningPerFilm}
                />
              </section>
            )}
          </>
        )}

        {/* Footer — only the freshness stamp. The italic "hecho por
            cinéfilos" sign-off was dropped per user feedback (read as
            pretentious). Footer renders only when there's a successful
            scrape to point at; otherwise we omit the whole bordered
            block rather than show an empty signature. */}
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
// Used for Tier 2 and Tier 3; Tier 1's header IS the masthead.
// ---------------------------------------------------------------------------
function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  // ReactNode so the Esta semana header can pass the rich edition line
  // (carmine "Edición Nº 17" + the rest in ink-gray) while Este mes and
  // Próximamente keep using plain strings.
  subtitle: React.ReactNode;
}) {
  // Frame removed in favor of typography + whitespace. The masthead
  // already carries enough rule weight; stacking another double-rule
  // frame here was rule-on-rule. The big italic serif title commands
  // the page on its own; subtitle sits with it as a unit.
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
// Próximamente index — Tier 2. Week-grouped text index. One banner per
// ISO week ("Semana del 19 al 25 de mayo") + chronological rows beneath.
// Feels like the back-of-zine program guide. The week-grouping echoes the
// masthead's editorial weekly cadence, applied to the future-week-preview
// horizon — denser than per-day banners at the 4-8-week scale.
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
                  {/* Date + time column (left). */}
                  <div className="tracking-eyebrow font-mono text-[11px] whitespace-nowrap uppercase">
                    <span className="text-ink-gray">
                      {formatDayShortBA(s.startsAtUtc)}
                    </span>
                    <span className="text-ink-gray/60 mx-1">·</span>
                    <span className={isIndie ? 'text-carmine font-bold' : 'text-ink'}>
                      {formatTimeBA(s.startsAtUtc)}
                    </span>
                  </div>

                  {/* Title + última función pill (center). Original title is
                      deliberately omitted — on mobile 375, long bilingual
                      titles overflow the row. Próximamente is the awareness
                      layer; the canonical title is what users scan. */}
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

                  {/* Cinema (right — its own row on mobile). */}
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

/**
 * Zero-screenings-anywhere. Rare; happens only when the DB is fresh or the
 * scraper has never succeeded. Shows the existing editorial copy plus a
 * dev-only hint gated on NODE_ENV so it doesn't leak to visitors.
 */
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

/**
 * Week is empty but there's programming further out. Softer message —
 * the cartelera isn't broken, the week just happens to be quiet (holiday,
 * festival hiatus). Tiers 2 + 3 render below this.
 */
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
// Subtitle builders — return {range, counts} so the page can hide the
// counts segment on mobile (hidden md:inline) while keeping the range
// always visible. On narrow screens the counts ('15 funciones en 5
// salas') add density without navigation value.
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

/** Render {range, counts} as JSX with counts hidden on mobile. */
function SectionSubtitle({ parts }: { parts: SectionSubtitleParts }) {
  return (
    <>
      <span>{parts.range}</span>
      <span className="text-ink-gray/60 hidden md:inline">·</span>
      <span className="hidden md:inline">{parts.counts}</span>
    </>
  );
}

// ---------------------------------------------------------------------------
// Edition helpers — the edition now reflects the ISO WEEK bounds of "now",
// not the data-derived min/max. That way "Edición Nº 17 · Semana del 20
// al 26 de abril" holds even on Wednesday when the first screening is
// on Thursday: we're inside edition 17 regardless.
// ---------------------------------------------------------------------------
interface EditionInfo {
  editionNumber: number;
  weekRangeLabel: string;
  /** Compact "DD MMM — DD MMM" form used in the masthead dateline. The
      verbose `weekRangeLabel` ("28 de abril al 4 de mayo") doesn't fit
      under the wordmark at mobile widths even with mono 10px tracking. */
  weekRangeShort: string;
  fullSentence: string;
}

function computeEdition(
  now: Date,
  totalScreenings: number,
  distinctCinemas: number,
): EditionInfo {
  const weekStart = getIsoWeekStartBA(now);
  const weekEnd = getIsoWeekEndBA(now);
  const editionNumber = getEditionNumber(weekStart);
  const weekRangeLabel = formatRangeLabel(weekStart, weekEnd);
  const weekRangeShort = formatRangeShort(weekStart, weekEnd);
  const fullSentence = editionFullSentence({
    editionNumber,
    weekRangeLabel,
    totalScreenings,
    distinctCinemas,
    isWeekSpan: true,
  });
  return { editionNumber, weekRangeLabel, weekRangeShort, fullSentence };
}

// ---------------------------------------------------------------------------
// Date range formatter — "23 de abril" / "23 al 30 de abril" / "23 de abril
// al 5 de mayo". Shared by the masthead edition dateline and the Tier 2/3
// subtitles.
// ---------------------------------------------------------------------------
function formatRangeLabel(first: Date, last: Date): string {
  const fmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: BA_TZ,
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

/**
 * Compact "DD MMM — DD MMM" range used by the masthead dateline. Months
 * are clipped to 3-letter abbreviations so the row fits under the
 * wordmark at mobile 375 with the chosen tracking. Dropped trailing
 * period on the month abbreviation — Spanish typography convention is
 * to keep abbreviated month names without the period in headlines.
 */
function formatRangeShort(first: Date, last: Date): string {
  const fmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: BA_TZ,
    day: 'numeric',
    month: 'short',
  });
  const firstParts = fmt.formatToParts(first);
  const lastParts = fmt.formatToParts(last);
  const firstDay = firstParts.find((p) => p.type === 'day')?.value;
  const firstMonth = firstParts.find((p) => p.type === 'month')?.value?.replace('.', '');
  const lastDay = lastParts.find((p) => p.type === 'day')?.value;
  const lastMonth = lastParts.find((p) => p.type === 'month')?.value?.replace('.', '');
  return `${firstDay} ${firstMonth} — ${lastDay} ${lastMonth}`;
}

/**
 * Footer timestamp — "23 de abril a las 14:30" in BA time. Rendered after
 * "Actualizado el " so the reader sees the freshness of the cartelera
 * without a label they have to parse. Uppercased by the Tailwind class
 * applied in the footer, so the mo-name lowercase here is fine.
 */
function formatLastScrape(d: Date): string {
  const dateFmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: BA_TZ,
    day: 'numeric',
    month: 'long',
  });
  const parts = dateFmt.formatToParts(d);
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const time = formatTimeBA(d);
  return `${day} de ${month} a las ${time}`;
}
