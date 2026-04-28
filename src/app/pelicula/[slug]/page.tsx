import { cache } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  getUpcomingScreeningsByFilm,
  formatTimeBA,
  formatDayShortBA,
  type ScreeningRow,
} from '@/db/queries';
import { TAG_LABELS_ES, GENRE_LABELS_ES } from '@/db';

// Server Component, dynamic per request. The cartelera anchors to BA
// "today" via `new Date()`, and the screenings horizon shifts every
// four hours; baking would either over-cache (stale 404s) or
// under-cache (rebuild on every request anyway). force-dynamic mirrors
// the cartelera page's choice.
export const dynamic = 'force-dynamic';

// Slug regex: lowercase alphanumeric + hyphens, length-bounded. Rejects
// path traversal (`../`) and weird unicode at the URL boundary before
// the lookup hits the DB. Drizzle's parameterized queries also prevent
// injection regardless, but cheap defense-in-depth at the route layer
// is worth ~3 lines.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;

/**
 * Cached lookup for a single slug. React's `cache()` memoizes per
 * request, so generateMetadata + the page render share one DB hit
 * even though Next.js calls them separately.
 */
const lookupFilm = cache(async (slug: string) => {
  if (!SLUG_RE.test(slug)) return null;
  return getUpcomingScreeningsByFilm(slug, new Date());
});

interface Params {
  slug: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const result = await lookupFilm(slug);
  if (!result) {
    // Unresolved slug: return minimal metadata. The page will 404 anyway,
    // but bots and link-preview crawlers shouldn't get an undefined-shaped
    // response. Inherit homepage defaults via metadataBase + omitting og:*.
    return {};
  }

  const { film, screenings } = result;
  const yearLabel = film.year ? ` (${film.year})` : '';
  const directorLabel = film.director ? ` — ${film.director}` : '';
  const title = `${film.title}${yearLabel}${directorLabel}`;
  // Pick the first FUTURE screening for the og:description "próxima función"
  // line; with the today_start lower bound on getUpcomingScreeningsByFilm
  // (Issue 1 deemphasis fix), screenings[0] could be a past-today row that
  // would mislabel here. Fall back to screenings[0] only when every row is
  // past — a rare end-of-day edge case where nothing future remains.
  const nowMs = new Date().getTime();
  const next = screenings.find((s) => s.startsAtUtc.getTime() >= nowMs) ?? screenings[0];
  const total = screenings.length;
  const next4hLabel = `próxima función ${formatDayShortBA(next.startsAtUtc)} ${formatTimeBA(
    next.startsAtUtc,
  )} en ${next.cinema.name}`;
  const description = `${film.synopsisEs ? film.synopsisEs.slice(0, 140) + '… ' : ''}${total} ${
    total === 1 ? 'función' : 'funciones'
  } en cartelera · ${next4hLabel}.`;

  return {
    title,
    description,
    // noindex per design-review outside-voice #4: /pelicula/<slug> exists
    // conditionally (only when there are upcoming screenings). Letting
    // Google index it would mean flap-404s when films leave BA, which
    // hurts the site's overall SEO health. The page is for cinephiles
    // arriving via the cartelera, not for search engines.
    robots: { index: false, follow: true },
    openGraph: {
      title,
      description,
      url: `/pelicula/${slug}`,
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}

export default async function FilmPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const result = await lookupFilm(slug);
  if (!result) notFound();

  const { film, screenings } = result;
  // "Now" anchor for the past-screening visual treatment. Computed once
  // here so every row's isPast comparison agrees.
  const nowMs = new Date().getTime();
  // Resolve TMDB genre IDs to es-AR labels, dropping any unknown IDs
  // (forward-compat: TMDB may add a genre before we update the map).
  const genreLabels = (film.genres ?? [])
    .map((id) => GENRE_LABELS_ES[id])
    .filter((label): label is string => Boolean(label));

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 md:py-16">
      {/* Back link to cartelera. Editorial breadcrumb-style: small mono
          caps, carmine, sits above the headline. Lets the user ground
          themselves before the page-shaped content lands. */}
      <Link
        href="/"
        className="tracking-eyebrow text-carmine border-carmine mb-8 inline-block border-b font-mono text-[11px] uppercase"
      >
        ← Cartelera
      </Link>

      {/* Title block — display-md tracking, text-balance to keep long
          Spanish titles from orphaning a single word. */}
      <header className="mb-8 md:mb-12">
        <h1 className="font-serif text-4xl leading-tight tracking-[-0.01em] text-balance md:text-6xl">
          {film.title}
        </h1>
        {film.titleOriginal &&
          film.titleOriginal.toLowerCase() !== film.title.toLowerCase() && (
            <p className="text-ink-gray mt-2 font-serif text-lg italic md:text-2xl">
              «{film.titleOriginal}»
            </p>
          )}
        {film.director && (
          <p className="text-ink-gray mt-3 text-sm md:text-base">
            {film.director}
            {film.year && ` · ${film.year}`}
            {film.country && ` · ${film.country}`}
            {film.runtimeMin && ` · ${film.runtimeMin} min`}
          </p>
        )}
        {genreLabels.length > 0 && (
          <p className="tracking-eyebrow text-ink-gray mt-2 font-mono text-[11px] uppercase">
            {genreLabels.join(' · ')}
          </p>
        )}
      </header>

      {/* Editorial still — TMDB backdrop_path at 16:9. Sits between the
          title block and the poster+synopsis row, reading as a magazine
          photograph that opens the article. Desktop-only: on mobile it
          would stack with the carmine poster card right below, reading
          as visual redundancy (the user already saw the poster on the
          cartelera card they clicked from). Skipped silently when TMDB
          has no backdrop on file (common for shorts and long-tail
          festival titles). */}
      {film.backdropUrl && (
        <figure className="mb-12 hidden md:block">
          <div className="relative aspect-[16/9] w-full overflow-hidden border border-black">
            <Image
              src={film.backdropUrl}
              alt=""
              fill
              sizes="(min-width: 1024px) 1024px, 100vw"
              className="object-cover"
            />
          </div>
        </figure>
      )}

      {/* Two-column on desktop: poster + synopsis. On mobile they stack
          (poster above synopsis). The carmine offset shadow is the
          DESIGN.md-non-negotiable visual fingerprint and lands here
          unchanged from the cartelera card. */}
      <div className="mb-12 flex flex-col gap-8 md:flex-row md:items-start md:gap-10">
        {film.posterUrl && (
          <div className="bg-cream flex w-40 shrink-0 items-center justify-center overflow-hidden border border-black shadow-[6px_6px_0_var(--color-carmine)] md:w-56">
            <Image
              src={film.posterUrl}
              alt={film.title}
              width={224}
              height={336}
              sizes="(min-width: 768px) 224px, 160px"
              loading="eager"
              fetchPriority="high"
              className="h-full w-full object-cover"
            />
          </div>
        )}
        {film.synopsisEs && (
          <p className="border-carmine max-w-prose border-l-2 pl-4 text-base leading-relaxed md:text-lg">
            {film.synopsisEs}
          </p>
        )}
      </div>

      {/* Reparto — top-billed cast from TMDB (capped at 8 by the
          enricher, see extractTopCast in src/tmdb/client.ts). Renders
          as a two-column list on sm+, single column on mobile. Each
          entry: name in normal weight, character in ink-gray italic
          after an em-dash. Skips entirely when cast is null
          (pre-enrichment) or empty (TMDB had no credits). */}
      {film.cast && film.cast.length > 0 && (
        <section className="mb-12">
          <h2 className="border-t border-black pt-4 font-serif text-2xl leading-none italic md:text-3xl">
            Reparto
          </h2>
          <ul className="mt-6 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {film.cast.map((c, i) => (
              <li key={`${c.name}-${i}`} className="text-sm md:text-base">
                <span className="font-medium">{c.name}</span>
                {c.character && (
                  <span className="text-ink-gray italic"> — {c.character}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Cross-venue screenings list — the killer feature. Reuses
          editorial registers (mono-tracked date+time chip, italic
          serif time accent, carmine cinema name). Renders as a list
          (semantic <ul>) rather than the cartelera card composition;
          the page is denser and a card grid would feel like SaaS
          slop per the /design-shotgun constraints. */}
      <section>
        <h2 className="border-t border-black pt-4 font-serif text-2xl leading-none italic md:text-3xl">
          Próximas funciones
          <span className="text-ink-gray ml-3 font-mono text-[11px] tracking-[0.2em] uppercase not-italic">
            {screenings.length} {screenings.length === 1 ? 'función' : 'funciones'}
          </span>
        </h2>
        <ul className="mt-6 divide-y divide-black/15">
          {screenings.map((s) => (
            <FilmScreeningRow key={s.id} s={s} isPast={s.startsAtUtc.getTime() < nowMs} />
          ))}
        </ul>
      </section>
    </main>
  );
}

function FilmScreeningRow({ s, isPast }: { s: ScreeningRow; isPast: boolean }) {
  const visibleTags = s.tags.filter((t) => t !== 'cycle');
  const dayLabel = formatDayShortBA(s.startsAtUtc);
  const timeLabel = formatTimeBA(s.startsAtUtc);
  // Past-screening visual: the carmine time + cinema accents mute to
  // ink-gray. No text label — "Ya empezó" overstates an in-progress
  // state for screenings that ended hours ago, and "Ya terminó" would
  // be wrong for one that just started. Color demotion alone is the
  // signal: "you're not making this one."
  const timeColor = isPast ? 'text-ink-gray' : 'text-carmine';
  const cinemaColor = isPast ? 'text-ink-gray' : 'text-carmine';

  const rowBody = (
    <div className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-4 gap-y-1 px-1 py-4 md:gap-x-6">
      {/* Date + time — left column. Date in mono caps, time in italic
          serif (carmine for attendable, ink-gray for past). */}
      <div className="flex items-baseline gap-3">
        <span className="tracking-eyebrow text-ink-gray font-mono text-[11px] whitespace-nowrap uppercase">
          {dayLabel}
        </span>
        <time
          dateTime={s.startsAtUtc.toISOString()}
          className={`${timeColor} font-serif text-2xl leading-none italic tabular-nums md:text-3xl`}
        >
          {timeLabel}
        </time>
      </div>

      {/* Cinema + program context — middle column. The program name pill
          renders here when the screening has a programName (different
          visual scale than the cartelera tag strip; this column is
          wider). */}
      <div className="min-w-0">
        <p
          className={`tracking-card ${cinemaColor} font-mono text-xs font-bold uppercase`}
        >
          {s.cinema.name}
        </p>
        {s.cinema.neighborhood && (
          <p className="text-ink-gray mt-0.5 font-mono text-[11px] tracking-wider uppercase">
            {s.cinema.neighborhood}
          </p>
        )}
        {s.programName && (
          <p className="text-ink-gray mt-1.5 font-serif text-sm italic">
            {s.programName}
          </p>
        )}
        {visibleTags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {visibleTags.map((t) => (
              <span
                key={t}
                className="tracking-card bg-carmine text-cream px-1.5 py-0.5 font-mono text-[10px] uppercase"
              >
                {TAG_LABELS_ES[t]}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <li>
      {s.sourceUrl ? (
        <a
          href={s.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-screening-card
          className="hover:bg-carmine/5 focus-visible:outline-carmine block transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
          aria-label={`${s.cinema.name} — ${dayLabel} ${timeLabel}`}
        >
          {rowBody}
        </a>
      ) : (
        rowBody
      )}
    </li>
  );
}
