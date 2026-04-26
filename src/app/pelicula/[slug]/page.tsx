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
import { TAG_LABELS_ES } from '@/db';

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
  const next = screenings[0];
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
      </header>

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
            <FilmScreeningRow key={s.id} s={s} />
          ))}
        </ul>
      </section>

      <footer className="mt-20 border-t-8 border-double border-black pt-8 text-center">
        <p className="font-serif text-lg italic">
          Afiche — hecho por cinéfilos, para cinéfilos
        </p>
      </footer>
    </main>
  );
}

function FilmScreeningRow({ s }: { s: ScreeningRow }) {
  const visibleTags = s.tags.filter((t) => t !== 'cycle');
  const dayLabel = formatDayShortBA(s.startsAtUtc);
  const timeLabel = formatTimeBA(s.startsAtUtc);

  const rowBody = (
    <div className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-4 gap-y-1 px-1 py-4 md:gap-x-6">
      {/* Date + time — left column. Date in mono caps, time in italic
          carmine serif (matches the cartelera card's time treatment). */}
      <div className="flex items-baseline gap-3">
        <span className="tracking-eyebrow text-ink-gray font-mono text-[11px] whitespace-nowrap uppercase">
          {dayLabel}
        </span>
        <time
          dateTime={s.startsAtUtc.toISOString()}
          className="text-carmine font-serif text-2xl leading-none italic tabular-nums md:text-3xl"
        >
          {timeLabel}
        </time>
      </div>

      {/* Cinema + program context — middle column. The pill renders here
          when the screening has a programName (different visual scale than
          the cartelera tag strip; this column is wider). */}
      <div className="min-w-0">
        <p className="tracking-card text-carmine font-mono text-xs font-bold uppercase">
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
