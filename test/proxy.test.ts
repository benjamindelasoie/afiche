/**
 * Tests for the edge proxy (proxy.ts): markdown content negotiation on the
 * public pages and the existing admin auth gate. NextRequest/NextResponse are
 * the real ones from next/server; we assert on the middleware-control headers
 * NextResponse sets (`x-middleware-rewrite`, `x-middleware-next`, `location`).
 */
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../src/proxy';

function req(
  path: string,
  { accept, method = 'GET' }: { accept?: string; method?: string } = {},
): NextRequest {
  const headers = new Headers();
  if (accept) headers.set('accept', accept);
  return new NextRequest(new URL(`https://afiche.ar${path}`), { headers, method });
}

describe('markdown content negotiation', () => {
  it('rewrites "/" to /api/md when Accept prefers text/markdown', () => {
    const res = proxy(req('/', { accept: 'text/markdown' }));
    const rewrite = res.headers.get('x-middleware-rewrite');
    expect(rewrite).toBeTruthy();
    const url = new URL(rewrite!);
    expect(url.pathname).toBe('/api/md');
    expect(url.searchParams.get('p')).toBe('/');
  });

  it('rewrites /cartelera and /acerca too, preserving the original path in ?p', () => {
    for (const path of ['/cartelera', '/acerca']) {
      const res = proxy(req(path, { accept: 'text/markdown' }));
      const url = new URL(res.headers.get('x-middleware-rewrite')!);
      expect(url.pathname).toBe('/api/md');
      expect(url.searchParams.get('p')).toBe(path);
    }
  });

  it('serves HTML (no rewrite) + appends Vary: Accept for a normal browser', () => {
    const res = proxy(req('/', { accept: 'text/html,application/xhtml+xml,*/*' }));
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect((res.headers.get('vary') ?? '').toLowerCase()).toContain('accept');
  });

  it('respects q-values: markdown loses when html is weighted higher', () => {
    const res = proxy(req('/', { accept: 'text/markdown;q=0.5, text/html;q=0.9' }));
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('respects q-values: markdown wins when it outweighs html', () => {
    const res = proxy(req('/', { accept: 'text/markdown;q=0.9, text/html;q=0.5' }));
    expect(res.headers.get('x-middleware-rewrite')).toBeTruthy();
  });

  it('does not negotiate on a non-GET request', () => {
    const res = proxy(req('/', { accept: 'text/markdown', method: 'POST' }));
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('does not rewrite a non-negotiable path even with a markdown Accept', () => {
    const res = proxy(req('/pelicula/blue-velvet', { accept: 'text/markdown' }));
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
  });
});

describe('admin gate (unchanged behavior)', () => {
  it('redirects an unauthenticated /admin request to /admin/login with ?next', () => {
    const res = proxy(req('/admin/runs'));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/admin/login');
    expect(loc.searchParams.get('next')).toBe('/admin/runs');
  });

  it('never treats /admin as a markdown-negotiable page', () => {
    // Even with a markdown Accept, /admin routes through the auth gate, not the
    // markdown rewrite.
    const res = proxy(req('/admin', { accept: 'text/markdown' }));
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.status).toBe(307);
  });
});
