/**
 * HTTP-layer tests for the markdown content-negotiation route (/api/md).
 *
 * Pins the acceptmarkdown.com contract: `Content-Type: text/markdown` and a
 * `Vary` that includes `Accept`, correct body per `?p=`, and a real 404 status
 * (with a markdown recovery body) for an unknown path. The DB layer is mocked
 * so the route imports without DATABASE_URL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const q = vi.hoisted(() => ({
  getWindowScreeningsByFilm: vi.fn().mockResolvedValue([]),
  listCinemas: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/db/queries', () => q);

const { GET } = await import('./route');

function mdRequest(p: string): Request {
  const url = new URL('https://afiche.ar/api/md');
  url.searchParams.set('p', p);
  return new Request(url, { headers: { accept: 'text/markdown' } });
}

beforeEach(() => {
  q.getWindowScreeningsByFilm.mockClear();
  q.listCinemas.mockClear();
});

describe('GET /api/md', () => {
  it('serves the homepage as text/markdown with Vary: Accept', async () => {
    const res = await GET(mdRequest('/'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    const vary = res.headers.get('vary') ?? '';
    expect(vary.toLowerCase()).toContain('accept');
    const body = await res.text();
    expect(body.startsWith('# ')).toBe(true);
  });

  it('is not shared-cacheable — no cross-variant CDN poisoning at the shared URL', () => {
    // The markdown is served via a rewrite at the same public URL as the HTML;
    // caching it there risks a CDN handing markdown to an HTML crawler.
    return GET(mdRequest('/')).then((res) => {
      expect(res.headers.get('cache-control')).toContain('no-store');
    });
  });

  it('reads the two homepage windows (hoy + semana)', async () => {
    await GET(mdRequest('/'));
    const windows = q.getWindowScreeningsByFilm.mock.calls.map((c) => c[0]);
    expect(windows).toContain('hoy');
    expect(windows).toContain('semana');
  });

  it('serves /cartelera from the semana + prox windows', async () => {
    const res = await GET(mdRequest('/cartelera'));
    expect(res.status).toBe(200);
    const windows = q.getWindowScreeningsByFilm.mock.calls.map((c) => c[0]);
    expect(windows).toContain('semana');
    expect(windows).toContain('prox');
    const body = await res.text();
    expect(body).toContain('cartelera completa');
  });

  it('serves /acerca and reads the cinema directory', async () => {
    const res = await GET(mdRequest('/acerca'));
    expect(res.status).toBe(200);
    expect(q.listCinemas).toHaveBeenCalledOnce();
    const body = await res.text();
    expect(body).toContain('# Sobre afiche');
  });

  it('normalizes a trailing slash (/acerca/ == /acerca)', async () => {
    const res = await GET(mdRequest('/acerca/'));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('# Sobre afiche');
  });

  it('returns a 404 markdown body for an unknown path', async () => {
    const res = await GET(mdRequest('/no-existe'));
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    const body = await res.text();
    expect(body).toContain('# 404');
    expect(body).toContain('/no-existe');
  });

  it('defaults to the homepage when p is absent', async () => {
    const res = await GET(new Request('https://afiche.ar/api/md'));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.startsWith('# ')).toBe(true);
  });
});
