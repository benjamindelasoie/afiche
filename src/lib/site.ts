/**
 * Canonical production origin — the single source of truth for every absolute
 * URL the app emits: the OG/Twitter `metadataBase` (src/app/layout.tsx), the
 * JSON-LD fallback-image URL (src/lib/json-ld.tsx), and .ics event URLs + UIDs
 * (src/lib/ics.ts).
 *
 * Centralized here after the og:image was found still pointing at
 * `afiche.vercel.app` weeks after the `afiche.ar` cutover — the host had been
 * hardcoded across ~4 files and drifted. Change the canonical origin in ONE
 * place now; everything that builds an absolute URL imports it.
 *
 * NOTE: the host-folding redirects in next.config.ts are a separate layer —
 * they MATCH the old `www` / `*.vercel.app` hosts to fold them onto the apex,
 * so they intentionally do not import this.
 */
export const SITE_URL = 'https://afiche.ar';

/** Host without scheme — e.g. for .ics UID domains. Derived so it can't drift. */
export const SITE_HOST = new URL(SITE_URL).host;
