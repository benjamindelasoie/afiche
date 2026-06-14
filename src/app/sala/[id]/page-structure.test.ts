/**
 * /sala/[id] structural invariants (#34a — desktop "Programa de mano" layout).
 *
 * The repo's vitest runs in a `node` environment with no jsdom / RTL render
 * harness ("no DOM-touching code yet" — vitest.config.ts), so page structure
 * is pinned the same way layout-invariants.test.ts pins the <main> contract:
 * a static scan of the source. These assertions lock the load-bearing
 * decisions of the desktop rail layout so a future edit that quietly undoes
 * them fails here. Real visual behavior (sticky, 375/390 no-overflow) is
 * verified manually via /browse — jsdom can't measure layout.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGE = resolve(__dirname, 'page.tsx');
const VENUE_AGENDA = resolve(__dirname, '../../_components/VenueAgenda.tsx');
const CICLOS = resolve(__dirname, '../../_components/CiclosEnCurso.tsx');

let page = '';
let venueAgenda = '';
let ciclos = '';

beforeAll(async () => {
  [page, venueAgenda, ciclos] = await Promise.all([
    readFile(PAGE, 'utf8'),
    readFile(VENUE_AGENDA, 'utf8'),
    readFile(CICLOS, 'utf8'),
  ]);
});

describe('/sala/[id] desktop rail layout (#34a)', () => {
  it('main is a max-w-6xl two-column grid that collapses below lg', () => {
    const main = page.match(/<main\s+className="([^"]+)"/)?.[1] ?? '';
    expect(main).toContain('max-w-6xl');
    expect(main).toContain('lg:grid');
    expect(main).toContain('lg:grid-cols-[20rem_1fr]');
    // CLAUDE.md #1 — the grid + its content column must keep these or the
    // 1fr child overflows at 375px (also pinned in layout-invariants.test.ts).
    expect(main).toContain('w-full');
    expect(main).toContain('min-w-0');
  });

  it('renders a sticky identity rail as an <aside>', () => {
    const aside = page.match(/<aside\s+className="([^"]+)"/)?.[1] ?? '';
    expect(aside, 'expected an <aside> rail').not.toBe('');
    expect(aside).toContain('lg:sticky');
    expect(aside).toContain('lg:self-start'); // so the rail doesn't stretch (sticky needs it)
  });

  it('content column has min-w-0 (grid 1fr shrink safety)', () => {
    // The schedule column wrapper sits after the </aside>; assert a min-w-0
    // div exists in the post-aside region.
    const afterAside = page.slice(page.indexOf('</aside>'));
    expect(afterAside).toMatch(/<div className="min-w-0">/);
  });

  it('Ciclos en curso and the view toggle live in the rail (before #cartelera)', () => {
    const asideOpen = page.indexOf('<aside');
    const asideClose = page.indexOf('</aside>');
    const carteleraSection = page.indexOf('id="cartelera"');
    expect(asideOpen).toBeGreaterThanOrEqual(0);
    expect(carteleraSection).toBeGreaterThan(asideClose);

    const railRegion = page.slice(asideOpen, asideClose);
    // Ciclos wayfinding is rendered inside the rail.
    expect(railRegion).toContain('<CiclosEnCurso');
    // The weekly-run Por película / Por día toggle is a venue-level control in
    // the rail now (supersedes the 2026-06-09 "inside #cartelera" placement).
    expect(railRegion).toContain('<CarteleraToggle');
  });

  it('toggle is gated on weeklyRun AND hasAgenda (no toggle on an empty venue)', () => {
    expect(page).toMatch(/weeklyRun && hasAgenda &&[\s\S]*?<CarteleraToggle/);
  });

  it('preserves the existing empty-state copy verbatim (no invented strings)', () => {
    expect(page).toContain('Por ahora, esta sala descansa.');
    expect(page).toContain('Esta quincena, la sala descansa.');
  });
});

describe('VenueAgenda desktop poster (F3) — #34a', () => {
  it('agenda poster steps up to 80×112 at lg', () => {
    expect(venueAgenda).toContain('lg:h-28 lg:w-20');
  });

  it('next/image sizes hint tracks the lg dimension (no blurry desktop poster)', () => {
    // Both AgendaRow and CollapsedRow posters must advertise the 80px source
    // at lg, or next/image serves the 64px candidate into the 80px box.
    const sizes = venueAgenda.match(/sizes="\(min-width: 1024px\) 80px[^"]*"/g) ?? [];
    expect(sizes.length).toBe(2);
  });
});

describe('CiclosEnCurso de-tint — #34a / DESIGN.md 2026-06-07', () => {
  it('no longer uses the retired bg-carmine/5 tint', () => {
    expect(ciclos).not.toContain('bg-carmine/5');
  });

  it('adopts the canonical de-tinted hover (black/[0.025] + carmine before: tick)', () => {
    expect(ciclos).toContain('hover:bg-black/[0.025]');
    expect(ciclos).toContain('before:bg-carmine');
    expect(ciclos).toContain('hover:before:scale-y-100');
  });
});
