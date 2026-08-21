import type { Metadata } from 'next';
import Link from 'next/link';
import {
  getWindowScreeningsByFilm,
  getFeaturedFilms,
  getLastScrapeTime,
  getJsonLdScreenings,
  formatAgendaDayLongBA,
} from '@/db/queries';
import { resolveWindowKey, windowRenderMode, type WindowKey } from '@/lib/windows';
import { computeEdition } from '@/lib/edition';
import { JsonLd, buildHomepageJsonLd, buildSiteJsonLd } from '@/lib/json-ld';
import { Masthead } from './_components/Masthead';
import { WindowNav } from './_components/WindowNav';
import { CuratedBand } from './_components/CuratedBand';
import { FilmRow } from './_components/FilmRow';
import { PageShell, PageFooter } from './_components/ui';

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

// Canonical URL for the homepage. The window selector rides on `?ventana=`
// (hoy|finde|semana|prox) — four query variants of the SAME page — so every
// one canonicalizes to the bare apex. Set here rather than in the root layout
// so interior pages (/pelicula, /sala) aren't wrongly canonicalized to `/`.
// Resolves against `metadataBase` (layout.tsx) → https://afiche.ar/.
export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

// Per-window list heading. `semana` reads "La cartelera" to avoid colliding
// with the curated "Esta semana" band that sits above it.
const LIST_HEADING: Record<WindowKey, string> = {
  hoy: 'Hoy',
  finde: 'Este finde',
  semana: 'La cartelera',
  prox: 'Próximamente',
};

const EMPTY_COPY: Record<WindowKey, string> = {
  hoy: 'No quedan funciones por hoy. Mirá lo que viene este finde o esta semana.',
  finde: 'Este finde no quedan funciones por ver.',
  semana: 'Esta semana no quedan funciones por ver.',
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
      {/* Site-identity node — tells crawlers "afiche is an Organization" with a
          canonical url, logo, and description, so the page's identity doesn't
          resolve to the nested Person directors inside the event graph. */}
      <JsonLd payload={buildSiteJsonLd()} />
      {jsonLdEvents.map((event, i) => (
        <JsonLd key={i} payload={event} />
      ))}
      <PageShell width="6xl" pad="flush">
        <Masthead edition={edition} funcionesTotal={weekTotal} salasTotal={weekCinemas} />

        <WindowNav active={windowKey} />

        {/* Curated "Esta semana" band — omitted entirely when nothing qualifies. */}
        <CuratedBand picks={featured} />

        <section id="cartelera" className="mt-6 md:mt-10">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-serif text-[26px] md:text-[30px]">
              {LIST_HEADING[windowKey]}
            </h2>
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
        <PageFooter lastScrape={lastScrape} />
      </PageShell>
    </>
  );
}
