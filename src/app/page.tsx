import Link from 'next/link';
import {
  getWindowScreeningsByFilm,
  getFeaturedFilms,
  getLastScrapeTime,
  getJsonLdScreenings,
  formatAgendaDayLongBA,
} from '@/db/queries';
import { resolveWindowKey, windowRenderMode, type WindowKey } from '@/lib/windows';
import { computeEdition, formatLastScrape } from '@/lib/edition';
import { JsonLd, buildHomepageJsonLd } from '@/lib/json-ld';
import { WindowNav } from './_components/WindowNav';
import { CuratedBand } from './_components/CuratedBand';
import { FilmRow } from './_components/FilmRow';

// The homepage is a window-scoped, GROUP-BY-FILM cartelera (redesign
// 2026-06-06; see GitHub issue #17 + DESIGN.md). One row per film for a
// selected time window (`?ventana=hoy|finde|semana|prox`, default `hoy`),
// instead of one card per showtime — which produced a 50-70 card scroll wall
// on busy weekends. The exhaustive day-by-day view moved to `/cartelera`
// ("Ver todo →"). The window registry (src/lib/windows.ts) is the single
// source for the nav, the `?ventana=` validation, and the bounded query.
//
// Server Component: awaits the DB directly and ships rendered HTML. The only
// client JS is <ShowtimesDisclosure> (the multi-showtime accordion).

// Render dynamically — the cartelera is anchored to BA "today" via `new Date()`
// below. Without this, Next statically renders the page and bakes `now` into
// cached HTML, so after BA midnight rollover a no-scrape day would serve
// yesterday's window until the next scrape fires revalidatePath('/'). See
// src/app/api/revalidate/route.ts.
export const dynamic = 'force-dynamic';

// Per-window list heading. `semana` reads "La cartelera" to avoid colliding
// with the curated "Esta semana" band that sits above it.
const LIST_HEADING: Record<WindowKey, string> = {
  hoy: 'Hoy',
  finde: 'Este finde',
  semana: 'La cartelera',
  prox: 'Próximamente',
};

const EMPTY_COPY: Record<WindowKey, string> = {
  hoy: 'Hoy las salas descansan.',
  finde: 'Este finde todavía no hay funciones cargadas.',
  semana: 'Esta semana las salas descansan.',
  prox: 'Todavía no hay funciones próximas cargadas.',
};

export default async function HomePage({
  searchParams,
}: {
  // Next 16: searchParams is a Promise — await before reading (AGENTS.md).
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const now = new Date();
  const { ventana } = await searchParams;
  const windowKey = resolveWindowKey(ventana);
  const mode = windowRenderMode(windowKey);

  const [groups, featured, lastScrape, jsonLdRows] = await Promise.all([
    getWindowScreeningsByFilm(windowKey, now),
    getFeaturedFilms(now),
    getLastScrapeTime(),
    getJsonLdScreenings(now),
  ]);

  // Masthead counts reflect the 7-day rolling week (matches the "Semana del
  // X al Y" framing). Editorial flavor — independent of the selected window.
  const weekTotal = jsonLdRows.length;
  const weekCinemas = new Set(jsonLdRows.map((s) => s.cinema.id)).size;
  const edition = computeEdition(now, weekTotal, weekCinemas);

  // 7-day ScreeningEvent JSON-LD (buildHomepageJsonLd trims to today + next 6).
  const jsonLdEvents = buildHomepageJsonLd(jsonLdRows, { now });

  const filmCount = groups.length;
  const screeningTotal = groups.reduce((n, g) => n + g.totalCount, 0);
  const subtitle =
    windowKey === 'hoy'
      ? `${formatAgendaDayLongBA(now)} · ${screeningTotal} funciones`
      : `${filmCount} ${filmCount === 1 ? 'película' : 'películas'} · ${screeningTotal} funciones`;

  return (
    <>
      {jsonLdEvents.map((event, i) => (
        <JsonLd key={i} payload={event} />
      ))}
      <main className="mx-auto w-full max-w-6xl min-w-0 px-4 pb-12 sm:px-6">
        {/* Masthead. Mobile = stacked (wordmark, dateline, tagline). Desktop =
            wordmark hard-left + edition/dateline/tagline right-aligned on the
            baseline, hairline rule under. */}
        <header className="border-b border-black pt-8 pb-4 md:flex md:items-end md:justify-between md:pt-12">
          <h1
            className="font-serif leading-[0.85] tracking-[-0.02em]"
            style={{
              fontSize: 'clamp(3.5rem, 11vw, 6.75rem)',
              fontKerning: 'normal',
              fontFeatureSettings: '"liga", "kern"',
            }}
          >
            Afiche
          </h1>
          <div className="mt-3 md:mt-0 md:pb-2 md:text-right">
            <p className="text-ink-gray font-mono text-[9.5px] leading-[1.7] tracking-[0.18em] uppercase md:text-[10.5px]">
              Edición Nº {edition.editionNumber} · Semana del {edition.weekRangeLabel}
              <span className="md:hidden"> · </span>
              <br className="hidden md:inline" />
              {weekTotal} funciones · {weekCinemas} salas
            </p>
            <p className="text-ink-gray mt-1.5 font-serif text-[17px] italic md:text-xl">
              Cartelera curada de Buenos Aires
            </p>
          </div>
          <p className="sr-only">{edition.fullSentence}</p>
        </header>

        <WindowNav active={windowKey} />

        {/* Curated "Esta semana" band — omitted entirely when nothing qualifies. */}
        <CuratedBand picks={featured} />

        <section id="cartelera" className="mt-6 md:mt-10">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-serif text-[26px] md:text-[30px]">{LIST_HEADING[windowKey]}</h2>
            <span className="tracking-card text-ink-gray ml-auto font-mono text-[9.5px] uppercase md:text-[10.5px]">
              {subtitle}
            </span>
          </div>

          {groups.length === 0 ? (
            <div className="space-y-3 py-12 text-center">
              <p className="text-ink-gray font-serif text-lg italic">
                {EMPTY_COPY[windowKey]}
              </p>
              <p className="tracking-eyebrow font-mono text-[11px] uppercase">
                <Link href="/cartelera" className="text-carmine border-b border-black/10">
                  Ver toda la cartelera →
                </Link>
              </p>
              {process.env.NODE_ENV !== 'production' && weekTotal === 0 && (
                <p className="tracking-eyebrow text-ink-gray/70 font-mono text-[11px] uppercase">
                  dev hint: ejecutá <code>npm run db:seed-cinemas</code> y{' '}
                  <code>npm run db:scrape</code> para cargar datos
                </p>
              )}
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-x-12 md:mt-6 md:grid-cols-2">
              {groups.map((group, i) => (
                <FilmRow
                  // Key by window so a film present in two windows remounts on
                  // switch — otherwise its disclosure keeps stale open-state and
                  // ignores the new window's default.
                  key={`${windowKey}-${group.film.id}`}
                  group={group}
                  now={now}
                  multiDay={mode.multiDay}
                  disclosureDefaultOpen={mode.disclosureDefaultOpen}
                  // The curated band (above the grid) owns the LCP when present;
                  // only when it's omitted does the first film poster lead.
                  priority={featured.length === 0 && i === 0}
                />
              ))}
            </div>
          )}
        </section>

        {/* Footer — only the freshness stamp; omitted until a successful scrape. */}
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
