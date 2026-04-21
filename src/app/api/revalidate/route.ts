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

import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

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
  if (provided !== expected) {
    return NextResponse.json({ error: 'invalid secret' }, { status: 401 });
  }

  revalidatePath('/');
  return NextResponse.json({ revalidated: true, path: '/' });
}
