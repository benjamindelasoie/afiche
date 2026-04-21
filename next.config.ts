import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
