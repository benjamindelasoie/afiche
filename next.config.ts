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
      {
        // Markdown content negotiation (acceptmarkdown.com): these pages answer
        // in HTML *or* text/markdown depending on Accept (the proxy, src/proxy.ts,
        // rewrites markdown requests to /api/md, which sets its own
        // `Vary: Accept, Accept-Encoding`). This rule stamps `Vary: Accept` on
        // the pre-render match as belt-and-suspenders so the negotiated response
        // always advertises it. The HTML variant itself is `force-dynamic` →
        // `Cache-Control: no-store` (never shared-cached), so it needs no Vary of
        // its own; the only edge-cached variant is the markdown one, which
        // carries Vary correctly. (Next owns the RSC Vary on the dynamic HTML
        // response and overrides this there — harmless, since it isn't cached.)
        source: '/(|cartelera|acerca)',
        headers: [{ key: 'Vary', value: 'Accept' }],
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
    // Every image is a hotlinked TMDB URL, already pre-resized by TMDB's CDN.
    // The custom loader picks the TMDB size for each srcset width instead of
    // routing through /_next/image, so Vercel Image Optimization (5,000
    // transformations/month on Hobby) is never used. See the loader for why.
    loader: 'custom',
    loaderFile: './src/lib/tmdb-image-loader.ts',
    // srcset widths = TMDB's own size ladder (the loader's TMDB_WIDTHS), so
    // up to the src's stored size each candidate's `w` descriptor is the real
    // width of the file it names, and an 80px@2x slot picks w185. Wider
    // candidates repeat the capped file (a w342 poster also appears as 500w,
    // 780w, 1280w). Next's defaults (32 … 3840) never land on w185.
    imageSizes: [92, 154, 185, 300, 342],
    deviceSizes: [500, 780, 1280],
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
