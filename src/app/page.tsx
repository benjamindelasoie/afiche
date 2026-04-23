import Image from 'next/image';
import {
  getThisWeekScreenings,
  getThisMonthScreenings,
  getUpcomingScreenings,
  getLastScrapeTime,
  formatTimeBA,
  formatDayShortBA,
  type DayGroup,
  type ScreeningRow,
} from '@/db/queries';
import { TAG_LABELS_ES } from '@/db';
import { getEditionNumber, editionFullSentence } from '@/lib/iso-week';
import {
  getIsoWeekStartBA,
  getIsoWeekEndBA,
} from '@/lib/date-ranges';

// This page is a Server Component — it runs on the server, awaits the DB
// directly, and ships rendered HTML. Zero client-side JS is shipped for the
// content below (only whatever Next.js needs for Link prefetching).
//
// The view is a three-tier cartelera:
//   1. "Esta semana"  — full cards with synopsis, the decision layer
//   2. "Este mes"     — compact cards (smaller poster, no synopsis), planning layer
//   3. "Próximamente" — text index (no poster, tight rows), awareness layer
//
// The masthead reflects Tier 1 ("Edición Nº N · Semana del X al Y · N
// funciones · M salas"). Tier 2 + Tier 3 each have their own subheader.
export default async function HomePage() {
  const now = new Date();

  const [thisWeek, thisMonth, upcoming, lastScrape] = await Promise.all([
    getThisWeekScreenings(now),
    getThisMonthScreenings(now),
    getUpcomingScreenings(now),
    getLastScrapeTime(),
  ]);

  // Masthead counts reflect THIS WEEK only — it's the edition.
  const thisWeekTotal = thisWeek.reduce((n, d) => n + d.screenings.length, 0);
  const thisWeekCinemas = new Set(
    thisWeek.flatMap((d) => d.screenings.map((s) => s.cinema.id)),
  ).size;

  const edition = computeEdition(now, thisWeekTotal, thisWeekCinemas);
  const hasAny = thisWeek.length > 0 || thisMonth.length > 0 || upcoming.length > 0;

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
        {/* Masthead — pure brand moment. The edition dateline used to
            hang under the h1, but that blurred the brand with the
            "this week" section label. Now the masthead carries only
            the name + tagline; edition metadata moved into the
            "Esta semana" section header below so all three section
            headers (Esta semana / Este mes / Próximamente) are parallel.
            Mobile padding tightened (py-5 vs py-12 desktop) and the
            h1 clamp minimum lowered so the first screening card returns
            to first-fold on a 375×812 viewport. Desktop rhythm unchanged. */}
        <header className="border-y-8 border-double border-black py-5 text-center md:py-12">
          <h1
            className="font-serif text-balance leading-[0.9] tracking-tight"
            style={{ fontSize: 'clamp(3.5rem, 12vw, 8rem)' }}
          >
            Afiche
          </h1>
          <p className="mt-2 font-serif italic text-ink-gray text-lg md:mt-3 md:text-xl">
            cartelera curada de Buenos Aires
          </p>
        </header>

        {!hasAny ? (
          <EmptyStateAll />
        ) : (
          <>
            {/* Tier 1 — Esta semana. The decision layer. Full cards.
                mt-4 mobile / mt-16 desktop — on phones the masthead's
                bottom double-border + the section header's own top
                double-border already do the "new section" work; 40px
                of extra air between them (the earlier mt-10) just read
                as wasted fold. Desktop keeps the generous breathing
                room because the breaks aren't competing for fold space. */}
            <section id="cartelera" className="mt-4 md:mt-16">
              <SectionHeader
                title="Esta semana"
                subtitle={
                  <>
                    <span className="text-carmine font-bold">
                      Edición Nº {edition.editionNumber}
                    </span>
                    <span className="text-ink-gray/60">·</span>
                    <span>Semana del {edition.weekRangeLabel}</span>
                    {/* Counts are desktop-only — on mobile 375 the subtitle
                        wraps to 3 lines when they're shown and adds
                        density without navigation value. Keeps the
                        headers parallel across all three tiers at md+. */}
                    {thisWeekTotal > 0 && (
                      <>
                        <span className="hidden md:inline text-ink-gray/60">·</span>
                        <span className="hidden md:inline">
                          {thisWeekTotal}{' '}
                          {thisWeekTotal === 1 ? 'función' : 'funciones'}
                        </span>
                        <span className="hidden md:inline text-ink-gray/60">·</span>
                        <span className="hidden md:inline">
                          {thisWeekCinemas}{' '}
                          {thisWeekCinemas === 1 ? 'sala' : 'salas'}
                        </span>
                      </>
                    )}
                  </>
                }
              />
              {/* Full edition sentence for screen readers. Placed with the
                  Esta semana header since that's where the span is now
                  announced visually. Keeps the single-source compute
                  so visible + sr-only can't drift. */}
              <p className="sr-only">{edition.fullSentence}</p>
              {thisWeek.length === 0 ? (
                <EmptyWeekMessage hasFollowup={thisMonth.length > 0 || upcoming.length > 0} />
              ) : (
                <div className="mt-10 space-y-12">
                  {thisWeek.map((day, dayIdx) => (
                    <DaySection
                      key={day.dateKey}
                      day={day}
                      variant="full"
                      isFirstDay={dayIdx === 0}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Tier 2 — Este mes. Planning layer. Compact cards. */}
            {thisMonth.length > 0 && (
              <section id="este-mes" className="mt-16 md:mt-24">
                <SectionHeader
                  title="Este mes"
                  subtitle={<SectionSubtitle parts={rangeSubtitleFromDays(thisMonth)} />}
                />
                <div className="mt-10 space-y-10">
                  {thisMonth.map((day) => (
                    <DaySection key={day.dateKey} day={day} variant="compact" />
                  ))}
                </div>
              </section>
            )}

            {/* Tier 3 — Próximamente. Awareness layer. Text index. */}
            {upcoming.length > 0 && (
              <section id="proximamente" className="mt-16 md:mt-24">
                <SectionHeader
                  title="Próximamente"
                  subtitle={<SectionSubtitle parts={rangeSubtitleFromFlat(upcoming)} />}
                />
                <UpcomingIndex screenings={upcoming} />
              </section>
            )}
          </>
        )}

        {/* Footer — editorial signature. Kept cream-on-cream so it closes
            the page softly, matching the masthead's editorial weight.
            "Actualizado el DD de MMMM a las HH:MM" only renders when a
            successful scrape run exists — silence rather than lie when
            there's no timestamp to show. */}
        <footer className="mt-20 pt-8 border-t-8 border-double border-black text-center">
          <p className="font-serif italic text-lg">
            Afiche — hecho por cinéfilos, para cinéfilos
          </p>
          {lastScrape && (
            <p className="mt-2 font-mono text-[11px] uppercase tracking-eyebrow text-ink-gray">
              Actualizado el {formatLastScrape(lastScrape)}
            </p>
          )}
        </footer>
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
  return (
    <div className="text-center border-t-[3px] border-b-[3px] border-double border-black py-4 md:py-6">
      <h2 className="font-serif italic text-4xl md:text-5xl leading-none text-balance">
        {title}
      </h2>
      <p className="mt-2 md:mt-3 font-mono text-[11px] uppercase tracking-eyebrow text-ink-gray flex items-center justify-center flex-wrap gap-x-2 gap-y-1">
        {subtitle}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Day section — banner + screening rows. Shared by Tier 1 (full) and
// Tier 2 (compact). The `variant` flag flows through to ScreeningCard.
// ---------------------------------------------------------------------------
function DaySection({
  day,
  variant,
  isFirstDay = false,
}: {
  day: DayGroup;
  variant: 'full' | 'compact';
  // First day of Tier 1. Drives Next/Image priority on the top cards so
  // the LCP poster loads eagerly even when today has no screenings
  // (otherwise day.isToday is never true and no card gets priority —
  // that was the prod console warning on afiche.vercel.app after deploy).
  isFirstDay?: boolean;
}) {
  return (
    <div>
      {/* Day banner — rendered as <h2> for screen-reader outline.
          aria-current='date' flags today for assistive tech.
          Two columns (no serif center date): the full mono label on the
          left already carries the date. Showing "23 Abr" in a second
          font was editorial repetition, not rhythm — the serif flourish
          lives on each card's time instead, where it's decisive. */}
      <h2
        aria-current={day.isToday ? 'date' : undefined}
        className="border-t border-b-[3px] border-double border-black py-3 mb-6 flex items-baseline justify-between gap-3 flex-wrap font-normal"
      >
        <span
          className={`font-mono text-[11px] uppercase tracking-eyebrow text-balance ${
            day.isToday ? 'text-carmine font-bold' : 'text-ink'
          }`}
        >
          {day.label}
          {day.isToday && (
            <span className="ml-2 px-1.5 py-0.5 bg-carmine text-cream no-underline">
              HOY
            </span>
          )}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-eyebrow text-ink-gray">
          {day.screenings.length}{' '}
          {day.screenings.length === 1 ? 'función' : 'funciones'}
        </span>
      </h2>
      <div className={variant === 'compact' ? 'space-y-3' : 'space-y-5'}>
        {day.screenings.map((s, idx) => (
          <ScreeningCard
            key={s.id}
            s={s}
            variant={variant}
            isAboveFold={
              variant === 'full' && (day.isToday || isFirstDay) && idx < 3
            }
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Screening card — Tier 1 (full) and Tier 2 (compact) share this component.
// Compact drops the synopsis and scales down poster + title. Chain cards
// stay visually de-emphasized via the card shell (border-neutral + muted
// text) regardless of variant.
// ---------------------------------------------------------------------------
function ScreeningCard({
  s,
  variant,
  isAboveFold,
}: {
  s: ScreeningRow;
  variant: 'full' | 'compact';
  isAboveFold: boolean;
}) {
  const isCompact = variant === 'compact';
  const posterSize = isCompact ? 'w-14 h-20' : 'w-20 h-28';
  const posterShadow = isCompact
    ? 'shadow-[3px_3px_0_var(--color-carmine)]'
    : 'shadow-[4px_4px_0_var(--color-carmine)]';
  const titleClass = isCompact
    ? 'font-serif text-xl sm:text-2xl leading-tight tracking-tight text-balance'
    : 'font-serif text-2xl sm:text-3xl leading-tight tracking-tight text-balance';
  const timeClass = isCompact
    ? 'font-serif italic text-3xl leading-none text-carmine tabular-nums md:mt-2'
    : 'font-serif italic text-4xl leading-none text-carmine tabular-nums md:mt-2';
  const cardPadding = isCompact ? 'p-3 sm:p-4' : 'p-4 sm:p-5';
  // Compact keeps the left-bar but thinner so the whole section reads
  // as "related to this week but less important."
  const leftBar = isCompact ? 'border-l-[3px]' : 'border-l-4';

  // Filter out 'cycle' — it's on every Lugones card (inferTags pushes it
  // unconditionally), so universal ≠ signal. Only meaningful tags like
  // 'retrospective' / 'restored' / actual festival names render. When the
  // only tag was the bare cycle, the tag row disappears entirely.
  const visibleTags = s.tags.filter((t) => t !== 'cycle');

  const cardBody = (
    <>
      {/* Tags — only in full variant. Compact / próximamente drop them
          to reduce visual chatter when the card is already smaller. */}
      {!isCompact && visibleTags.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {visibleTags.map((t) => (
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
              Outer tile is cream so lazy-loading images reveal on paper
              rather than flashing solid black; the black bg is scoped to
              the true no-poster fallback span per DESIGN.md. */}
          {s.cinema.type === 'indie' && (
            <div
              className={`shrink-0 ${posterSize} bg-cream flex items-center justify-center overflow-hidden border border-black ${posterShadow}`}
            >
              {s.film.posterUrl ? (
                // Next 16: `priority` is deprecated. Use explicit
                // loading + fetchPriority so the LCP poster is announced
                // to the browser preload scanner. The prod console on
                // afiche.vercel.app was emitting the 'add loading=eager'
                // warning because priority was silently a no-op here.
                <Image
                  src={s.film.posterUrl}
                  alt={s.film.title}
                  width={isCompact ? 56 : 80}
                  height={isCompact ? 80 : 112}
                  sizes={isCompact ? '56px' : '80px'}
                  loading={isAboveFold ? 'eager' : 'lazy'}
                  fetchPriority={isAboveFold ? 'high' : 'auto'}
                  className="w-full h-full object-cover"
                />
              ) : (
                <span className="w-full h-full bg-black text-cream flex items-center justify-center font-serif italic text-center px-1 leading-tight text-sm">
                  {s.film.title}
                </span>
              )}
            </div>
          )}
          <div className="min-w-0 flex-1">
            {s.cinema.type === 'indie' ? (
              <h3 className={titleClass}>{s.film.title}</h3>
            ) : (
              <h3 className="font-sans font-medium text-lg leading-tight text-balance">
                {s.film.title}
              </h3>
            )}
            {s.film.titleOriginal &&
              s.film.titleOriginal.toLowerCase() !==
                s.film.title.toLowerCase() && (
                <p
                  className={`font-serif italic text-ink-gray mt-0.5 ${
                    isCompact ? 'text-sm' : 'text-base sm:text-lg'
                  }`}
                >
                  «{s.film.titleOriginal}»
                </p>
              )}
            {s.film.director && (
              <p
                className={`${isCompact ? 'text-xs' : 'text-sm'} text-ink-gray mt-1`}
              >
                {s.film.director}
                {s.film.year && ` · ${s.film.year}`}
                {s.film.country && (
                  <span className="hidden sm:inline"> · {s.film.country}</span>
                )}
                {s.film.runtimeMin && ` · ${s.film.runtimeMin} min`}
              </p>
            )}
            {/* Synopsis — FULL variant only. Compact drops it to signal
                "planning layer, not decision layer." The display guard
                keeps mid-sentence-truncated legacy DB rows out. */}
            {!isCompact &&
              s.film.synopsisEs &&
              s.cinema.type === 'indie' &&
              isCompleteSynopsis(s.film.synopsisEs) && (
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
            {/* Cinema name — carmine bold for indie, grey for chain.
                The ★ prefix was dropped when the cartelera went all-indie:
                a curation signal with nothing to contrast against just
                adds noise. The color difference is the differentiator
                when chain content returns. */}
            <p
              className={`text-xs font-mono tracking-card uppercase ${
                s.cinema.type === 'indie'
                  ? 'text-carmine font-bold'
                  : 'text-ink-gray'
              }`}
            >
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
            className={timeClass}
          >
            {formatTimeBA(s.startsAtUtc)}
          </time>
        </div>
      </div>
    </>
  );

  const cardClasses = `block ${cardPadding} border transition-[background-color,box-shadow] active:translate-y-[1px] ${
    s.cinema.type === 'indie'
      ? `border-carmine bg-carmine/5 ${leftBar} hover:bg-carmine/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-carmine`
      : 'border-neutral-300 bg-black/[0.02] hover:bg-black/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black'
  }`;

  return s.sourceUrl ? (
    <a
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
    <article className={cardClasses}>{cardBody}</article>
  );
}

// ---------------------------------------------------------------------------
// Próximamente index — Tier 3. Flat chronological list rendered as a
// compressed text table. No posters, no card backgrounds, tight rows.
// Feels like the back-of-zine program guide: just enough to say "this
// film exists in your calendar eventually; tap for detail."
// ---------------------------------------------------------------------------
function UpcomingIndex({ screenings }: { screenings: ScreeningRow[] }) {
  return (
    <ul className="mt-8 divide-y divide-black/15">
      {screenings.map((s) => {
        const isIndie = s.cinema.type === 'indie';
        const rowBody = (
          <div className="grid grid-cols-[auto_1fr] md:grid-cols-[auto_1fr_auto] gap-x-4 gap-y-1 py-3 px-1 items-baseline">
            {/* Date + time column (left) */}
            <div className="font-mono text-[11px] uppercase tracking-eyebrow whitespace-nowrap">
              <span className="text-ink-gray">
                {formatDayShortBA(s.startsAtUtc)}
              </span>
              <span className="mx-1 text-ink-gray/60">·</span>
              <span
                className={
                  isIndie ? 'text-carmine font-bold' : 'text-ink'
                }
              >
                {formatTimeBA(s.startsAtUtc)}
              </span>
            </div>

            {/* Title only (center). The original title is deliberately
                omitted here — on mobile 375, titles like "Los caballeros
                las prefieren rubias «Gentlemen Prefer Blondes»" overflow
                the row. Tier 3 is the awareness layer; the full canonical
                title is what users scan for. Original titles live in the
                full / compact cards where there's room. */}
            <div className="min-w-0">
              <span
                className={
                  isIndie
                    ? 'font-serif text-lg leading-tight'
                    : 'font-sans font-medium text-base'
                }
              >
                {s.film.title}
              </span>
            </div>

            {/* Cinema (right — its own row on mobile). Star prefix
                dropped alongside the card-level one. */}
            <div
              className={`col-span-2 md:col-span-1 font-mono text-[11px] uppercase tracking-card whitespace-nowrap ${
                isIndie ? 'text-carmine font-bold' : 'text-ink-gray'
              }`}
            >
              {s.cinema.name}
            </div>
          </div>
        );

        return (
          <li key={s.id}>
            {s.sourceUrl ? (
              <a
                href={s.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-screening-card
                className="block hover:bg-carmine/5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-carmine"
                aria-label={`${s.film.title} — ${s.cinema.name} — ${formatTimeBA(s.startsAtUtc)}`}
              >
                {rowBody}
              </a>
            ) : (
              rowBody
            )}
          </li>
        );
      })}
    </ul>
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
    <div className="text-center space-y-3 py-8">
      <p className="font-serif italic text-ink-gray text-lg">
        Esta semana las salas descansan.
      </p>
      {hasFollowup && (
        <p className="font-mono text-[11px] uppercase tracking-eyebrow text-ink-gray">
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

function rangeSubtitleFromDays(days: DayGroup[]): SectionSubtitleParts {
  const totalScreenings = days.reduce((n, d) => n + d.screenings.length, 0);
  const cinemas = new Set(
    days.flatMap((d) => d.screenings.map((s) => s.cinema.id)),
  ).size;
  const first = dateKeyToDate(days[0].dateKey);
  const last = dateKeyToDate(days[days.length - 1].dateKey);
  return {
    range: formatRangeLabel(first, last),
    counts: countsLabel(totalScreenings, cinemas),
  };
}

function rangeSubtitleFromFlat(rows: ScreeningRow[]): SectionSubtitleParts {
  const first = rows[0].startsAtUtc;
  const last = rows[rows.length - 1].startsAtUtc;
  const cinemas = new Set(rows.map((r) => r.cinema.id)).size;
  return {
    range: formatRangeLabel(first, last),
    counts: countsLabel(rows.length, cinemas),
  };
}

/** Render {range, counts} as JSX with counts hidden on mobile. */
function SectionSubtitle({ parts }: { parts: SectionSubtitleParts }) {
  return (
    <>
      <span>{parts.range}</span>
      <span className="hidden md:inline text-ink-gray/60">·</span>
      <span className="hidden md:inline">{parts.counts}</span>
    </>
  );
}

// ---------------------------------------------------------------------------
// Display guard: is this synopsis worth rendering?
// Kept from F-011: ~100-140 char Lumiton tile-preview synopses trail off
// mid-sentence with dangling commas. Heuristic: needs min length AND must
// end with terminal punctuation.
// ---------------------------------------------------------------------------
function isCompleteSynopsis(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 60) return false;
  return /[.!?…»"']$/.test(trimmed);
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
  const fullSentence = editionFullSentence({
    editionNumber,
    weekRangeLabel,
    totalScreenings,
    distinctCinemas,
    isWeekSpan: true,
  });
  return { editionNumber, weekRangeLabel, fullSentence };
}

// ---------------------------------------------------------------------------
// Date range formatter — "23 de abril" / "23 al 30 de abril" / "23 de abril
// al 5 de mayo". Shared by the masthead edition dateline and the Tier 2/3
// subtitles.
// ---------------------------------------------------------------------------
function formatRangeLabel(first: Date, last: Date): string {
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

// dateKey "YYYY-MM-DD" → Date at BA noon (safe for formatting without
// timezone drift).
function dateKeyToDate(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1, d, 15)); // 12:00 BA = 15:00 UTC
}

/**
 * Footer timestamp — "23 de abril a las 14:30" in BA time. Rendered after
 * "Actualizado el " so the reader sees the freshness of the cartelera
 * without a label they have to parse. Uppercased by the Tailwind class
 * applied in the footer, so the mo-name lowercase here is fine.
 */
function formatLastScrape(d: Date): string {
  const dateFmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: 'numeric',
    month: 'long',
  });
  const parts = dateFmt.formatToParts(d);
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const time = formatTimeBA(d);
  return `${day} de ${month} a las ${time}`;
}
