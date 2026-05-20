/**
 * Data Access Layer (DAL) for the admin panel.
 *
 * Per Next.js 16's authentication guide:
 *   - proxy.ts is the optimistic route gate; cheap, runs before render
 *   - DAL is the load-bearing check; runs inside every server action and
 *     at the top of every server-rendered admin page
 *
 * Without the DAL, the proxy alone would leak through Partial Rendering
 * and Server Actions (action POSTs don't re-evaluate the proxy in every
 * scenario). The official guidance is: layout/proxy checks are not enough;
 * verify the session as close to the data as possible.
 *
 * verifySession is memoized via React's `cache` so the same render pass
 * doesn't re-verify the cookie multiple times when multiple components
 * call it. Across requests, no caching.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { ADMIN_SESSION_COOKIE, isValidSessionCookie } from './admin-auth';

export interface AdminSession {
  authenticated: true;
}

/**
 * Verify the admin session cookie. Redirects to `/admin/login` on any
 * failure (missing cookie, invalid signature, expired). Memoized per
 * render pass via `react/cache`.
 *
 * Callers do NOT need to handle the false case — redirect() throws a
 * Next.js navigation signal that aborts the current render/action.
 *
 * Returns AdminSession on success so the caller can keep typesafety
 * (the return is `{ authenticated: true }` for now, future-proofed to
 * accept role/identity fields when multi-user lands).
 */
export const verifySession = cache(async (): Promise<AdminSession> => {
  const jar = await cookies();
  const value = jar.get(ADMIN_SESSION_COOKIE)?.value;
  if (!isValidSessionCookie(value)) {
    redirect('/admin/login');
  }
  return { authenticated: true };
});
