import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Canonical host = the apex afiche.ar (the wordmark). Host-based redirects
  // fold the two alternate hosts onto it so there's a single canonical origin
  // (and a single host the admin session cookie lives on). Query strings are
  // forwarded automatically by Next.
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
};

export default nextConfig;
