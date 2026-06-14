import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Canonical host = the apex afiche.ar (the wordmark). Host-based redirects
  // fold the two alternate hosts onto it so there's a single canonical origin
  // (and a single host the admin session cookie lives on). Query strings are
  // forwarded automatically by Next.
  async headers() {
    return [
      {
        // Apply to every route.
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      {
        // www → apex: permanent (308). www is a true, stable alias of the
        // brand domain — safe to harden + browser-cache.
        source: '/:path*',
        has: [{ type: 'host', value: 'www.afiche.ar' }],
        destination: 'https://afiche.ar/:path*',
        permanent: true,
      },
      {
        // vercel.app → apex: temporary (307). Folds the old host onto the
        // custom domain, but stays un-sticky so the raw deployment URL is
        // still reachable for debugging if afiche.ar ever has an issue. Only
        // the production alias matches; per-deploy preview URLs don't.
        source: '/:path*',
        has: [{ type: 'host', value: 'afiche.vercel.app' }],
        destination: 'https://afiche.ar/:path*',
        permanent: false,
      },
    ];
  },
  images: {
    // TMDB serves poster images. We hotlink from their CDN rather than
    // caching locally because /public is read-only at runtime on Vercel.
    // next/image will still optimize, transcode to AVIF/WebP, and cache
    // the transformed output at the edge.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'image.tmdb.org',
        pathname: '/t/p/**',
      },
    ],
  },
  experimental: {
    // Client-side Router Cache TTLs, in seconds. The homepage is force-dynamic,
    // so Next's default (`dynamic: 0`) refetches on EVERY window switch —
    // including re-selecting a window you just viewed. These let the browser
    // reuse a recently-fetched window payload so switching feels instant.
    //   static  — applies to <Link prefetch> targets, i.e. the WindowNav pills
    //             (see WindowNav.tsx). The four windows are prefetched on load
    //             and stay reusable for 3 min, so the first click on any window
    //             is instant and re-clicks within the window don't refetch.
    //   dynamic — the fallback for a dynamic navigation that wasn't fully
    //             prefetched (e.g. before a pill's prefetch lands). Kept short
    //             so data stays fresh.
    // Only WITHIN-SESSION re-navigation is served from this cache; a full page
    // load is always server-rendered fresh, so the scrape / midnight-rollover
    // freshness path (revalidatePath('/')) is unaffected.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
