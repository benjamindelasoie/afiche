/**
 * Cache revalidation endpoint.
 *
 * Purpose: the GitHub Actions scraper writes to Turso (the production DB),
 * but the Next.js server component that renders the week view
 * (src/app/page.tsx) caches its DB read via the default React/Next.js
 * caching. After a fresh scrape, the cache is stale — visitors see
 * yesterday's screenings until the cache evicts naturally.
 *
 * Solution: the GHA workflow hits this endpoint after every successful
 * scrape run. We call revalidatePath('/') to invalidate the home page's
 * cache. The next visitor triggers a fresh render against the updated DB.
 *
 * Auth: a shared secret. The secret is stored as a repo secret in GitHub
 * Actions (REVALIDATE_SECRET) and as an env var on Vercel. The workflow
 * sends it as an `X-Revalidate-Secret` header. Without the secret, a
 * public endpoint could be hammered to drop the cache repeatedly — a
 * very mild DoS but not worth leaving open.
 */

import { timingSafeEqual } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

/**
 * Constant-time secret comparison. Mirrors the admin path
 * (src/lib/admin-auth.ts). timingSafeEqual throws on unequal lengths, so the
 * length is checked first (length is not itself secret here). Returns false for
 * a missing header rather than throwing.
 */
function secretsMatch(provided: string | null, expected: string): boolean {
  if (provided === null) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const expected = process.env.REVALIDATE_SECRET;
  if (!expected) {
    // If the env var isn't configured on the deploy, refuse. Better to
    // fail loud than silently ignore revalidation requests forever.
    return NextResponse.json(
      { error: 'REVALIDATE_SECRET not configured on this deploy' },
      { status: 500 },
    );
  }

  const provided = req.headers.get('x-revalidate-secret');
  if (!secretsMatch(provided, expected)) {
    return NextResponse.json({ error: 'invalid secret' }, { status: 401 });
  }

  revalidatePath('/');
  // `/cartelera` is the relocated day-by-day view; it reads the same DB and
  // must invalidate together with the homepage after a fresh scrape.
  revalidatePath('/cartelera');
  return NextResponse.json({ revalidated: true, paths: ['/', '/cartelera'] });
}
