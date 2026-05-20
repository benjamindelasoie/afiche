/**
 * Optimistic route gate for the operator admin panel.
 *
 * Runs before render on every /admin/* path EXCEPT /admin/login. Redirects
 * to /admin/login with ?next preserved (so deep links bounce back after
 * login). This is the cheap first-line check; the load-bearing verify
 * happens in src/lib/admin-dal.ts → verifySession() called inside every
 * admin page and every admin server action.
 *
 * Why two layers (per Next.js 16 authentication guide): proxy.ts alone
 * leaks through Partial Rendering and Server Actions. The DAL closes
 * those gaps. Either alone is wrong.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_SESSION_COOKIE, isValidSessionCookie } from '@/lib/admin-auth';

export function proxy(request: NextRequest) {
  const cookie = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (isValidSessionCookie(cookie)) {
    return NextResponse.next();
  }
  const loginUrl = new URL('/admin/login', request.url);
  // Preserve the deep link so login can bounce back. Skip when the
  // current path IS /admin/login (shouldn't happen given the matcher,
  // but belt + suspenders).
  const path = request.nextUrl.pathname + request.nextUrl.search;
  if (path !== '/admin/login' && path !== '/admin/login/') {
    loginUrl.searchParams.set('next', path);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Match every /admin/* path EXCEPT /admin/login. The login page must
  // be reachable when unauthenticated; everything else requires a
  // session cookie.
  matcher: ['/admin/((?!login).*)', '/admin'],
};
