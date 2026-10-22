'use client';

/**
 * next/image loader (wired via `images.loaderFile` in next.config.ts) that
 * serves TMDB images straight from TMDB's CDN instead of Vercel Image
 * Optimization.
 *
 * Every poster and backdrop in afiche is a TMDB URL, which TMDB already
 * serves pre-resized. Routing them through `/_next/image` re-encoded the same
 * JPEGs and billed one Vercel transformation per (image × width). The Hobby
 * plan allows 5,000/month and a single crawl that fetched every srcset
 * candidate burned ~1.8k in a day. This loader swaps the size segment of the
 * TMDB URL (`/t/p/w342/…`) for the smallest TMDB size that covers the width
 * the browser picked from srcset, so srcset still works and Vercel never
 * transforms anything.
 *
 * TMDB only accepts the sizes it publishes (an arbitrary `w256` is a 400),
 * but it accepts any published size for both posters and backdrops, so one
 * merged ladder serves both. The size already in the src is the ceiling
 * (w342 posters, w1280 backdrops), so a 2x/3x screen never pulls a bigger
 * file than the one ingest chose; `original` (several MB) caps at w1280.
 *
 * Non-TMDB srcs are returned unchanged (served as-is, unoptimized).
 */

const TMDB_PATH = /^(https:\/\/image\.tmdb\.org\/t\/p\/)w?(\d+|original)(\/.+)$/;
const TMDB_WIDTHS = [92, 154, 185, 300, 342, 500, 780, 1280] as const;
const MAX_WIDTH = TMDB_WIDTHS[TMDB_WIDTHS.length - 1];

export default function tmdbImageLoader({
  src,
  width,
}: {
  src: string;
  width: number;
  quality?: number;
}): string {
  const match = TMDB_PATH.exec(src);
  if (!match) return src;
  const [, base, srcSize, file] = match;
  const ceiling =
    srcSize === 'original' ? MAX_WIDTH : Math.min(Number(srcSize), MAX_WIDTH);
  const size = TMDB_WIDTHS.find((w) => w >= width && w <= ceiling) ?? ceiling;
  return `${base}w${size}${file}`;
}
