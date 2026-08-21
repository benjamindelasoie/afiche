/**
 * Edge request gate. Two independent jobs, keyed by path:
 *
 *  1. Admin auth (every /admin/* except /admin/login). Optimistic first-line
 *     check — redirects to /admin/login with ?next preserved. The load-bearing
 *     verify still happens in src/lib/admin-dal.ts → verifySession() inside
 *     every admin page and server action (proxy alone leaks through Partial
 *     Rendering and Server Actions; per the Next.js 16 auth guide).
 *
 *  2. Markdown content negotiation (the acceptmarkdown.com convention) on the
 *     public reading pages. A client that sends `Accept: text/markdown` is
 *     rewritten to the markdown endpoint (src/app/api/md) — same URL, machine-
 *     readable body. Everyone else gets the normal HTML, with `Accept` appended
 *     to `Vary` so a shared cache never crosses the two variants.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_SESSION_COOKIE, isValidSessionCookie } from '@/lib/admin-auth';

/** Public pages that also answer in markdown under Accept negotiation. */
const NEGOTIABLE_PATHS = new Set(['/', '/cartelera', '/acerca']);

/**
 * True when the client explicitly prefers `text/markdown` over `text/html`.
 * Honors RFC 9110 q-values: markdown wins when it's present with a positive q
 * that is at least the q of text/html. A normal browser (`text/html,...` with
 * no markdown) never triggers this; an agent sending `Accept: text/markdown`
 * (with or without a lower-q html fallback) does.
 */
function prefersMarkdown(accept: string | null): boolean {
  if (!accept) return false;
  let markdownQ = -1;
  let htmlQ = 0; // html is acceptable by default even when unlisted
  for (const range of accept.split(',')) {
    const [rawType, ...params] = range.trim().split(';');
    const type = rawType.trim().toLowerCase();
    let q = 1;
    for (const param of params) {
      const m = param.trim().match(/^q=([0-9.]+)$/i);
      if (m) q = Number.parseFloat(m[1]);
    }
    if (type === 'text/markdown') markdownQ = Math.max(markdownQ, q);
    else if (type === 'text/html') htmlQ = Math.max(htmlQ, q);
  }
  return markdownQ > 0 && markdownQ >= htmlQ;
}

function handleAdmin(request: NextRequest): NextResponse {
  const cookie = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (isValidSessionCookie(cookie)) {
    return NextResponse.next();
  }
  const loginUrl = new URL('/admin/login', request.url);
  // Preserve the deep link so login can bounce back. Skip when the current path
  // IS /admin/login (the matcher excludes it, but belt + suspenders).
  const path = request.nextUrl.pathname + request.nextUrl.search;
  if (path !== '/admin/login' && path !== '/admin/login/') {
    loginUrl.searchParams.set('next', path);
  }
  return NextResponse.redirect(loginUrl);
}

/** The login page must stay reachable unauthenticated — never gate it. */
function isAdminLogin(pathname: string): boolean {
  return pathname === '/admin/login' || pathname === '/admin/login/';
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // 1. Admin surface (everything under /admin except the login page).
  if (
    (pathname === '/admin' || pathname.startsWith('/admin/')) &&
    !isAdminLogin(pathname)
  ) {
    return handleAdmin(request);
  }

  // 2. Public markdown negotiation.
  if (request.method === 'GET' && NEGOTIABLE_PATHS.has(pathname)) {
    if (prefersMarkdown(request.headers.get('accept'))) {
      const url = request.nextUrl.clone();
      url.pathname = '/api/md';
      url.search = '';
      // The original path travels to the route as BOTH a forwarded request
      // header and a query param. The header is load-bearing: a middleware
      // rewrite does not reliably surface the middleware-set query string on
      // the destination route's `request.url`, but a forwarded header always
      // arrives. The query is a readable fallback for direct/manual calls.
      url.searchParams.set('p', pathname);
      const headers = new Headers(request.headers);
      headers.set('x-md-path', pathname);
      return NextResponse.rewrite(url, { request: { headers } });
    }
    // Serving the HTML variant — tell caches it varies on Accept. `append`
    // rather than `set` so Next's own Vary (RSC / router) isn't clobbered.
    const res = NextResponse.next();
    res.headers.append('Vary', 'Accept');
    return res;
  }

  return NextResponse.next();
}

export const config = {
  // Run on every page-like request, excluding API routes, Next internals, and
  // any path with a file extension (static assets: /llms.txt, /sitemap.xml,
  // images, etc.). Bare literal entries like '/' proved unreliable in this Next
  // build, so we use the documented negative-lookahead form and let the
  // in-function path checks (admin vs. negotiable vs. pass-through) do the real
  // routing — including keeping /admin/login reachable (isAdminLogin).
  matcher: ['/((?!api|_next/static|_next/image|.*\\.[^/]+$).*)'],
};
