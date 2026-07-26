import Image from 'next/image';
import Link from 'next/link';
import {
  formatTimeBA,
  formatDayChipBA,
  type FilmGroup,
  type ScreeningRow,
} from '@/db/queries';
import { isScreeningExpired } from '@/lib/date-ranges';
import { filmMetaLine } from '@/lib/film-meta';
import { cn } from '@/lib/cn';
import { focusRing, hoverRail } from './ui';
import { ShowtimesDisclosure } from './ShowtimesDisclosure';
import { buildDisclosureVenue, filmRowSummary, filmRowLead } from './film-row-model';

// ---------------------------------------------------------------------------
// FilmRow — one row per film in the window-scoped homepage cartelera.
//
// Single-showtime films (the 64% common case) render a clean inline
// `time · venue` (prefixed with a day chip in multi-day windows). Multi-
// showtime films collapse behind <ShowtimesDisclosure>. This server component
// owns ALL the BA-timezone / Date formatting and hands the client disclosure a
// fully-serialized, primitive-only view-model.
//
// Tap model (stretched-link, no nested <a>): the row is `relative`; the title
// link carries `after:absolute after:inset-0` so its hit-area covers the whole
// row → /pelicula. The time link (→ ticketing), venue link (→ /sala), and the
// disclosure toggle are siblings raised with `relative z-10` so they sit above
// the stretched pseudo-element. All targets are ≥44px and keyboard-focusable.
// ---------------------------------------------------------------------------

function FilmPoster({
  film,
  priority,
}: {
  film: ScreeningRow['film'];
  priority: boolean;
}) {
  return (
    <div className="bg-cream relative h-[88px] w-[62px] shrink-0 overflow-hidden border border-black shadow-[4px_4px_0_var(--color-carmine)] transition-[box-shadow,transform] duration-150 group-hover:translate-x-px group-hover:translate-y-px group-hover:shadow-[2px_2px_0_var(--color-carmine)] md:h-[148px] md:w-[104px]">
      {film.posterUrl ? (
        <Image
          src={film.posterUrl}
          alt={film.title}
          width={104}
          height={148}
          sizes="(min-width: 768px) 104px, 62px"
          priority={priority}
          className="h-full w-full object-cover"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/no-poster.svg"
          alt=""
          width={104}
          height={148}
          className="h-full w-full object-cover"
        />
      )}
    </div>
  );
}

function FilmMeta({ film }: { film: ScreeningRow['film'] }) {
  // filmMetaLine joins built parts (no leading separators) and drops a 0
  // runtime via a truthiness guard — never the `&&`-renders-0 trap (ISSUE-001).
  const line = filmMetaLine(film);
  if (!line) return null;
  return (
    <p className="text-ink-gray mt-1.5 font-sans text-[11.5px] md:mt-2 md:text-[12.5px]">
      {line}
    </p>
  );
}

function SingleShowtime({
  s,
  multiDay,
  now,
}: {
  s: ScreeningRow;
  multiDay: boolean;
  now: Date;
}) {
  const past = isScreeningExpired(s.startsAtUtc, now);
  const time = formatTimeBA(s.startsAtUtc);
  const iso = s.startsAtUtc.toISOString();
  const timeCls =
    'font-serif text-[26px] italic leading-none tabular-nums md:text-[30px]';
  return (
    <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 md:mt-3.5">
      {multiDay ? (
        <span className="tracking-card text-ink border-ink/15 border px-1.5 py-0.5 font-mono text-[10px] uppercase">
          {formatDayChipBA(s.startsAtUtc, now)}
        </span>
      ) : null}
      {past ? (
        <time dateTime={iso} className={`${timeCls} text-ink-gray line-through`}>
          {time}
        </time>
      ) : s.sourceUrl ? (
        <a
          href={s.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Comprar entradas — ${time}`}
          className={cn(timeCls, 'text-carmine relative z-10', focusRing)}
        >
          {time}
        </a>
      ) : (
        <time dateTime={iso} className={`${timeCls} text-carmine`}>
          {time}
        </time>
      )}
      <Link
        href={`/sala/${s.cinema.id}`}
        className={cn(
          'tracking-card text-ink relative z-10 font-mono text-[10px] uppercase',
          focusRing,
        )}
      >
        {s.cinema.name}
      </Link>
    </div>
  );
}

export function FilmRow({
  group,
  now,
  multiDay,
  disclosureDefaultOpen,
  priority = false,
}: {
  group: FilmGroup;
  now: Date;
  /** Multi-day window (finde/semana/prox) — day chips + by-day disclosure. */
  multiDay: boolean;
  /** Multi-showtime films expand by default (hoy only). */
  disclosureDefaultOpen: boolean;
  /** Eager-load the poster for above-the-fold rows (LCP). */
  priority?: boolean;
}) {
  const { film, byVenue, screenings, totalCount } = group;
  const isMulti = totalCount > 1;
  const titleHref = film.slug ? `/pelicula/${film.slug}` : null;
  const titleClass = 'font-serif text-[25px] leading-[1.04] text-balance md:text-[28px]';

  // Multi-showtime summary view-model (only used when isMulti).
  const { summaryRest } = filmRowSummary(group, multiDay);
  const { leadTime, leadDayHint } = filmRowLead(group, multiDay, now);

  return (
    // `isolate` scopes the row's z-10 children (time/venue links, disclosure
    // toggle) to this article's stacking context so they can't paint over the
    // sticky WindowNav (also z-10) as the row scrolls under it.
    <article
      className={cn(
        'group isolate flex gap-4 border-b border-black/10 py-4 md:gap-[18px] md:px-3.5 md:py-[22px]',
        hoverRail({ inset: 'lg' }),
      )}
    >
      <FilmPoster film={film} priority={priority} />
      <div className="min-w-0 flex-1">
        {titleHref ? (
          <Link
            href={titleHref}
            data-screening-card
            aria-label={film.title}
            className={cn('after:absolute after:inset-0', focusRing)}
          >
            <h3 className={titleClass}>{film.title}</h3>
          </Link>
        ) : (
          <h3 className={titleClass}>{film.title}</h3>
        )}
        {film.titleOriginal &&
        film.titleOriginal.toLowerCase() !== film.title.toLowerCase() ? (
          <p className="text-ink-gray font-serif text-sm leading-tight italic md:text-[15px]">
            «{film.titleOriginal}»
          </p>
        ) : null}
        <FilmMeta film={film} />
        {isMulti ? (
          <ShowtimesDisclosure
            venues={byVenue.map((v) => buildDisclosureVenue(v, now, multiDay))}
            multiDay={multiDay}
            defaultOpen={disclosureDefaultOpen}
            leadTime={leadTime}
            leadDayHint={leadDayHint}
            summaryRest={summaryRest}
            // Fall back to /cartelera when the film has no slug, so capped days
            // ("ver todas →") are never dead-ended.
            verTodasHref={titleHref ?? '/cartelera'}
            filmTitle={film.title}
          />
        ) : (
          <SingleShowtime s={screenings[0]} multiDay={multiDay} now={now} />
        )}
      </div>
    </article>
  );
}
