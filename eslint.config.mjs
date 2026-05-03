import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import betterTailwind from 'eslint-plugin-better-tailwindcss';

// `eslint-plugin-better-tailwindcss` is the Tailwind-4-compatible fork
// of `eslint-plugin-tailwindcss`. It catches className typos (e.g.,
// `min-width-0` instead of `min-w-0` — silently no CSS without the
// linter), warns on contradicting classes, and enforces canonical order.
// Tailwind 4 reads tokens from @theme blocks in globals.css; pointing
// the plugin at our entry CSS file teaches it our project utilities.
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    ...betterTailwind.configs['correctness-error'],
    settings: {
      'better-tailwindcss': {
        // Path to the entry CSS file with @theme blocks (Tailwind 4 idiom).
        // Plugin reads it to learn project-specific utilities (bg-cream,
        // text-carmine, tracking-eyebrow) that come from our @theme tokens.
        entryPoint: 'src/app/globals.css',
      },
    },
    rules: {
      ...betterTailwind.configs['correctness-error'].rules,
      // Allow our own non-utility classnames used as CSS hooks in
      // globals.css (.date-strip-wrapper / .date-strip / .date-chip
      // selectors with ::before/::after pseudo-elements).
      'better-tailwindcss/no-unknown-classes': [
        'error',
        { detectComponentClasses: false, ignore: ['^date-strip', '^date-chip'] },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
]);

export default eslintConfig;
