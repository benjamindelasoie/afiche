/**
 * Tests for the markdown content-negotiation builders (src/lib/site-markdown.ts).
 *
 * Pure functions over already-fetched rows, so these run with fixtures and no
 * DB. They pin the acceptmarkdown-facing contract that matters for agents: an
 * H1 is present, films link to their /pelicula fiche, past showtimes are
 * dropped, and every page carries the agent-resources footer (sitemap +
 * llms.txt + MCP).
 */
import { describe, it, expect } from 'vitest';
import {
  renderHomeMarkdown,
  renderCarteleraMarkdown,
  renderAcercaMarkdown,
  render404Markdown,
  carteleraSection,
} from './site-markdown';
import type { FilmGroup, ScreeningRow, CinemaRow } from '@/db/queries';

const NOW = new Date('2026-08-21T15:00:00Z'); // 12:00 BA

function cinema(overrides: Partial<ScreeningRow['cinema']> = {}): ScreeningRow['cinema'] {
  return {
    id: 'lorca',
    name: 'Cine Lorca',
    neighborhood: 'San Nicolás',
    address: 'Av. Corrientes 1428',
    type: 'indie',
    ...overrides,
  };
}

function film(overrides: Partial<ScreeningRow['film']> = {}): ScreeningRow['film'] {
  return {
    id: 1,
    title: 'Mulholland Drive',
    titleOriginal: 'Mulholland Dr.',
    director: 'David Lynch',
    year: 2001,
    country: 'US',
    runtimeMin: 147,
    synopsisEs: 'Una rubia amnésica…',
    posterUrl: null,
    backdropUrl: null,
    slug: 'mulholland-drive',
    cast: null,
    genres: null,
    popularity: null,
    voteAverage: null,
    voteCount: null,
    createdAt: NOW,
    ...overrides,
  };
}

function screening(
  startsAtUtc: Date,
  overrides: Partial<ScreeningRow> = {},
): ScreeningRow {
  return {
    id: 100,
    startsAtUtc,
    tags: [],
    sourceUrl: null,
    programName: null,
    film: film(),
    cinema: cinema(),
    ...overrides,
  };
}

/** A FilmGroup with one future (catchable) screening at Cine Lorca. */
function catchableGroup(overrides: Partial<ScreeningRow['film']> = {}): FilmGroup {
  const s = screening(new Date('2026-08-21T23:00:00Z'), { film: film(overrides) });
  return {
    film: s.film,
    byVenue: [{ cinema: s.cinema, screenings: [s] }],
    screenings: [s],
    nextCatchableUtc: s.startsAtUtc.getTime(),
    totalCount: 1,
  };
}

describe('renderHomeMarkdown', () => {
  it('opens with an H1 and a substantial description (agent-readable without JS)', () => {
    const md = renderHomeMarkdown({
      hoy: [catchableGroup()],
      semana: [catchableGroup()],
      now: NOW,
    });
    expect(md.startsWith('# ')).toBe(true);
    // 500+ chars of real text — the "content without JavaScript" bar.
    expect(md.length).toBeGreaterThan(500);
    expect(md).toContain('Buenos Aires');
  });

  it('lists films with a heading and a /pelicula fiche link', () => {
    const md = renderHomeMarkdown({ hoy: [catchableGroup()], semana: [], now: NOW });
    expect(md).toContain('### Mulholland Drive (2001) — David Lynch');
    expect(md).toContain('https://afiche.ar/pelicula/mulholland-drive');
    expect(md).toContain('Cine Lorca (San Nicolás)');
  });

  it('carries the agent-resources footer (sitemap, llms.txt, MCP)', () => {
    const md = renderHomeMarkdown({ hoy: [], semana: [], now: NOW });
    expect(md).toContain('https://afiche.ar/sitemap.xml');
    expect(md).toContain('https://afiche.ar/llms.txt');
    expect(md).toContain('https://afiche.ar/api/mcp');
  });

  it('shows the empty-state italic line when a window has no films', () => {
    const md = renderHomeMarkdown({ hoy: [], semana: [], now: NOW });
    expect(md).toContain('_No quedan funciones por hoy._');
  });
});

describe('carteleraSection', () => {
  it('drops films whose every showtime already passed (never advertise the unattendable)', () => {
    const past = screening(new Date('2026-08-21T10:00:00Z')); // 07:00 BA, before NOW
    const goneGroup: FilmGroup = {
      film: past.film,
      byVenue: [{ cinema: past.cinema, screenings: [past] }],
      screenings: [past],
      nextCatchableUtc: null,
      totalCount: 1,
    };
    const md = carteleraSection('Hoy', [goneGroup], NOW, 'nada');
    expect(md).toContain('## Hoy');
    expect(md).not.toContain('Mulholland Drive');
    expect(md).toContain('_nada_');
  });
});

describe('renderCarteleraMarkdown', () => {
  it('has an H1 and both weekly + upcoming sections', () => {
    const md = renderCarteleraMarkdown({
      semana: [catchableGroup()],
      prox: [],
      now: NOW,
    });
    expect(md.startsWith('# ')).toBe(true);
    expect(md).toContain('## Esta semana');
    expect(md).toContain('## Próximamente');
  });
});

describe('renderAcercaMarkdown', () => {
  it('lists tracked cinemas with /sala links and documents the MCP endpoint', () => {
    const cinemas: CinemaRow[] = [
      {
        id: 'lorca',
        name: 'Cine Lorca',
        neighborhood: 'San Nicolás',
        address: 'Av. Corrientes 1428',
        type: 'indie',
        ticketingBaseUrl: null,
      },
    ];
    const md = renderAcercaMarkdown(cinemas);
    expect(md).toContain('# Sobre afiche');
    expect(md).toContain('[Cine Lorca](https://afiche.ar/sala/lorca)');
    expect(md).toContain('https://afiche.ar/api/mcp');
  });
});

describe('render404Markdown', () => {
  it('names the missing path and points at the recovery resources', () => {
    const md = render404Markdown('/no-existe');
    expect(md).toContain('# 404');
    expect(md).toContain('/no-existe');
    expect(md).toContain('https://afiche.ar/sitemap.xml');
    expect(md).toContain('https://afiche.ar/llms.txt');
  });
});
