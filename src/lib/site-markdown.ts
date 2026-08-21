/**
 * Markdown representations of afiche's public pages, served via HTTP content
 * negotiation (the acceptmarkdown.com convention): a client that sends
 * `Accept: text/markdown` gets these instead of the React-rendered HTML. The
 * proxy (proxy.ts) detects the preference and rewrites to the markdown route
 * (src/app/api/md/route.ts), which calls the builders here.
 *
 * Why a parallel markdown surface: AI agents and LLM crawlers read markdown far
 * more reliably than a hydrated React tree. The HTML stays the human product;
 * this is the same information, linearized and link-dense, for machines.
 *
 * The builders are PURE — they take already-fetched rows (FilmGroup[],
 * CinemaRow[]) and return a string. The route handler owns the DB reads, so
 * these unit-test with fixtures and no DATABASE_URL (mirrors src/mcp/format.ts).
 */

import type { FilmGroup, CinemaRow } from '@/db/queries';
import { catchable, formatBALabel } from '@/mcp/format';
import { SITE_URL, SITE_NAME } from './site';

/** Shared machine-readable footer: where an agent looks next. */
const RESOURCES_SECTION = [
  '## Recursos para agentes',
  '',
  `- Cartelera completa: [${SITE_URL}/cartelera](${SITE_URL}/cartelera)`,
  `- Sobre afiche: [${SITE_URL}/acerca](${SITE_URL}/acerca)`,
  `- Mapa del sitio (sitemap): [${SITE_URL}/sitemap.xml](${SITE_URL}/sitemap.xml)`,
  `- Guía para agentes (llms.txt): [${SITE_URL}/llms.txt](${SITE_URL}/llms.txt)`,
  `- API en vivo (MCP, sólo lectura): \`${SITE_URL}/api/mcp\` — tools: whats_on, search_films, get_film, list_cinemas`,
].join('\n');

/**
 * One film as a markdown block: a `###` heading (title · year · director), a
 * `[Ficha](url)` link when the film has a slug, and one bullet per venue with
 * that venue's still-catchable showtimes. Past showtimes are dropped — an agent
 * should never be handed a time it can't act on.
 */
function filmBlock(group: FilmGroup, now: Date): string | null {
  const { film } = group;
  const lines: string[] = [];

  const venueLines: string[] = [];
  for (const v of group.byVenue) {
    const live = catchable(v.screenings, now);
    if (live.length === 0) continue;
    const where = v.cinema.neighborhood
      ? `${v.cinema.name} (${v.cinema.neighborhood})`
      : v.cinema.name;
    const times = live.map((s) => formatBALabel(s.startsAtUtc)).join(' · ');
    venueLines.push(`- ${where}: ${times}`);
  }
  // Every showtime already passed within the window — nothing catchable to list.
  if (venueLines.length === 0) return null;

  const bits = [film.title];
  if (film.year) bits.push(`(${film.year})`);
  const headingTail = film.director ? ` — ${film.director}` : '';
  lines.push(`### ${bits.join(' ')}${headingTail}`);
  if (film.slug) lines.push(`[Ficha](${SITE_URL}/pelicula/${film.slug})`);
  lines.push(...venueLines);

  return lines.join('\n');
}

/**
 * A titled section (`## heading`) listing every film in `groups`. Films with no
 * catchable showtime left are skipped; when that empties the whole section, a
 * single italic "nothing left" line stands in so the structure is never blank.
 */
export function carteleraSection(
  heading: string,
  groups: FilmGroup[],
  now: Date,
  emptyCopy: string,
): string {
  const blocks = groups
    .map((g) => filmBlock(g, now))
    .filter((b): b is string => b !== null);
  const body = blocks.length ? blocks.join('\n\n') : `_${emptyCopy}_`;
  return `## ${heading}\n\n${body}`;
}

/**
 * The homepage as markdown: an H1, a plain-language description of what afiche
 * is (so an agent that fetched only `/` understands the product), then "Hoy"
 * and "Esta semana" film lists, and the agent-resources footer.
 */
export function renderHomeMarkdown(args: {
  hoy: FilmGroup[];
  semana: FilmGroup[];
  now: Date;
}): string {
  const { hoy, semana, now } = args;
  return [
    `# ${SITE_NAME} — cartelera curada de Buenos Aires`,
    '',
    'afiche reúne la programación de los cines independientes y de repertorio de ' +
      'Buenos Aires —MALBA, Cine Lorca, Sala Lugones, Cosmos, Gaumont, y más— en una ' +
      'sola cartelera, ordenada por película. Cada madrugada lee los sitios de las ' +
      'salas, deduplica la misma película entre cines y la enriquece con datos de ' +
      'TMDB (sinopsis, director, elenco, país). Cubre sólo el circuito indie: las ' +
      'cadenas quedan afuera a propósito.',
    '',
    carteleraSection('Hoy', hoy, now, 'No quedan funciones por hoy.'),
    '',
    carteleraSection(
      'Esta semana',
      semana,
      now,
      'No hay funciones cargadas esta semana.',
    ),
    '',
    RESOURCES_SECTION,
    '',
  ].join('\n');
}

/**
 * The full cartelera as markdown: the next 7 days ("Esta semana") plus the
 * awareness horizon ("Próximamente"). Same information as the `/cartelera`
 * HTML view, linearized for machines.
 */
export function renderCarteleraMarkdown(args: {
  semana: FilmGroup[];
  prox: FilmGroup[];
  now: Date;
}): string {
  const { semana, prox, now } = args;
  return [
    `# ${SITE_NAME} — cartelera completa`,
    '',
    'Toda la programación del circuito indie y de repertorio de Buenos Aires, ' +
      'ordenada por película. Los horarios son hora local de Buenos Aires.',
    '',
    carteleraSection(
      'Esta semana',
      semana,
      now,
      'No hay funciones cargadas esta semana.',
    ),
    '',
    carteleraSection(
      'Próximamente',
      prox,
      now,
      'Todavía no hay funciones próximas cargadas.',
    ),
    '',
    RESOURCES_SECTION,
    '',
  ].join('\n');
}

/**
 * The about page ("Sobre afiche") as markdown: what afiche is, how it's built,
 * the salas it tracks, and the read-only MCP endpoint.
 */
export function renderAcercaMarkdown(cinemas: CinemaRow[]): string {
  const salas = cinemas.length
    ? cinemas
        .map(
          (c) =>
            `- [${c.name}](${SITE_URL}/sala/${c.id})${c.neighborhood ? ` — ${c.neighborhood}` : ''}`,
        )
        .join('\n')
    : '_Sin salas cargadas._';
  return [
    '# Sobre afiche',
    '',
    'afiche es una cartelera — un mapa de lo que se proyecta esta semana en las ' +
      'salas independientes y de repertorio de Buenos Aires. Una sola pantalla para ' +
      'todo el circuito. Sin buscador, sin cuenta, sin algoritmo: la cartelera es el ' +
      'índice.',
    '',
    '## Cómo se arma',
    '',
    'Todas las madrugadas afiche revisa los sitios de las salas, junta las funciones ' +
      'nuevas y colapsa la misma película —que suele aparecer con títulos distintos en ' +
      'cada cine— en una sola ficha. Después la enriquece con datos de TMDB: afiche, ' +
      'sinopsis, director, elenco, país.',
    '',
    '## Las salas',
    '',
    salas,
    '',
    '## afiche como datos (MCP)',
    '',
    'La cartelera se puede leer a máquina vía MCP (Model Context Protocol), sólo ' +
      'lectura, sobre datos públicos, sin credenciales.',
    '',
    `- Endpoint: \`${SITE_URL}/api/mcp\``,
    '- Conectar (Claude Code): `claude mcp add --transport http afiche ' +
      `${SITE_URL}/api/mcp\``,
    '- Herramientas: whats_on · search_films · get_film · list_cinemas',
    '',
    RESOURCES_SECTION,
    '',
  ].join('\n');
}

/**
 * Markdown body for a 404 under content negotiation: a short recovery map so an
 * agent that hit a dead path can find its way to real content instead of
 * parsing an HTML error shell.
 */
export function render404Markdown(path: string): string {
  return [
    '# 404 — página no encontrada',
    '',
    `No existe ninguna página en \`${path}\`. El link puede estar viejo o mal escrito.`,
    '',
    RESOURCES_SECTION,
    '',
  ].join('\n');
}
