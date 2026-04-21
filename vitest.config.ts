/**
 * Vitest configuration.
 *
 * Tests colocated with source files as *.test.ts. Integration tests under test/.
 * Node environment (not jsdom) — we have no DOM-touching code yet.
 *
 * Path alias "@/*" mirrors tsconfig.json's paths block. Inlined here rather
 * than via vite-tsconfig-paths to keep this config CJS-compatible (Vite's
 * tsconfig-paths plugin is ESM-only).
 */

import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts'],
    },
  },
});
