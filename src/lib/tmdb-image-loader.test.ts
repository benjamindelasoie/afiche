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
 */

import { describe, it, expect } from 'vitest';
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
    expect(load(POSTER, 232)).not.toBe(POSTER);
    expect(load(BACKDROP, 400)).not.toBe(BACKDROP);
  });

  it('passes non-TMDB srcs through untouched', () => {
    expect(load('/opengraph-image.png', 256)).toBe('/opengraph-image.png');
    expect(load('https://example.com/t/p/w342/x.jpg', 256)).toBe(
      'https://example.com/t/p/w342/x.jpg',
    );
  });
});
