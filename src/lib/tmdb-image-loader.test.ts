/**
 * Tests for the next/image loader that serves TMDB images straight from
 * TMDB's CDN at its own size ladder (no Vercel Image Optimization).
 *
 * Cover:
 *   - Picks the smallest TMDB size that covers the requested width
 *   - Never exceeds the size already in the src (w342 posters stay ≤ w342)
 *   - Caps `original` at w1280
 *   - Works the same for poster and backdrop paths
 *   - Implements width for Next's dev probe (no "missing width" warning)
 *   - Passes non-TMDB srcs through untouched
 *   - next.config.ts wires this loader in (no fallback to /_next/image)
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import nextConfig from '../../next.config';
import tmdbImageLoader from './tmdb-image-loader';

const POSTER = 'https://image.tmdb.org/t/p/w342/4k4nCzJctpi2kKFIDIfddi2zXIQ.jpg';
const BACKDROP = 'https://image.tmdb.org/t/p/w1280/r5IbY1krzmv3YqW1DKzru9BJIjI.jpg';

const load = (src: string, width: number) => tmdbImageLoader({ src, width, quality: 75 });
const poster = (size: string) =>
  `https://image.tmdb.org/t/p/${size}/4k4nCzJctpi2kKFIDIfddi2zXIQ.jpg`;
const backdrop = (size: string) =>
  `https://image.tmdb.org/t/p/${size}/r5IbY1krzmv3YqW1DKzru9BJIjI.jpg`;

describe('tmdbImageLoader', () => {
  it.each([
    [32, 'w92'],
    [92, 'w92'],
    [96, 'w154'],
    [128, 'w154'],
    // Value: protects=the w185 rung of the ladder; fails_when=185 is dropped
    // or mistyped in TMDB_WIDTHS; why_new=no other row lands on w185;
    // seam=none; no_claim=TMDB actually serving w185 (checked by hand)
    [160, 'w185'],
    [256, 'w300'],
    [342, 'w342'],
    [384, 'w342'],
    [640, 'w342'],
    [3840, 'w342'],
  ])('maps a w342 poster at width %i to %s', (width, size) => {
    expect(load(POSTER, width)).toBe(poster(size));
  });

  it.each([
    [256, 'w300'],
    [750, 'w780'],
    [1080, 'w1280'],
    [3840, 'w1280'],
  ])('maps a w1280 backdrop at width %i to %s', (width, size) => {
    expect(load(BACKDROP, width)).toBe(backdrop(size));
  });

  it('caps an `original` src at w1280', () => {
    expect(load(poster('original'), 3840)).toBe(poster('w1280'));
    expect(load(poster('original'), 400)).toBe(poster('w500'));
  });

  it('implements width for the probe Next runs in dev', () => {
    // Next warns when the loader returns the src unchanged for the image's
    // `width` prop (or 400 for `fill`). Every poster slot is ≤ 232px wide.
    expect(load(POSTER, 232)).toBe(poster('w300'));
    expect(load(BACKDROP, 400)).toBe(backdrop('w500'));
  });

  it('is the loader next.config.ts uses for every next/image', () => {
    // Dropping this (or re-adding `remotePatterns` without a loader) silently
    // routes TMDB images back through Vercel Image Optimization.
    expect(nextConfig.images?.loader).toBe('custom');
    const loaderFile = nextConfig.images?.loaderFile ?? '';
    expect(resolve(loaderFile)).toBe(resolve('src/lib/tmdb-image-loader.ts'));
    expect(existsSync(loaderFile)).toBe(true);
  });

  it('configures srcset widths that are exactly TMDB sizes', () => {
    // Each configured width must come back as that same TMDB size, or the
    // srcset `w` descriptor lies about the file and the browser over-fetches.
    const widths = [
      ...(nextConfig.images?.imageSizes ?? []),
      ...(nextConfig.images?.deviceSizes ?? []),
    ];
    expect(widths.length).toBeGreaterThan(0);
    for (const width of widths) {
      expect(load(poster('original'), width)).toBe(poster(`w${width}`));
    }
  });

  it('passes non-TMDB srcs through untouched', () => {
    expect(load('/opengraph-image.png', 256)).toBe('/opengraph-image.png');
    expect(load('https://example.com/t/p/w342/x.jpg', 256)).toBe(
      'https://example.com/t/p/w342/x.jpg',
    );
    // A malformed TMDB size (no `w`) is left as stored, not silently repaired,
    // so an ingest bug shows up instead of being masked by the srcset.
    expect(load('https://image.tmdb.org/t/p/342/x.jpg', 256)).toBe(
      'https://image.tmdb.org/t/p/342/x.jpg',
    );
  });
});
