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

/**
 * Product NAME in prose/metadata. Capitalized "Afiche" everywhere it's prose
 * (page title, og:title, manifest, the apple-web-app home-screen label) — the
 * lowercase "afiche" is the wordmark LOGOTYPE only (see DESIGN.md 2026-06-07).
 */
export const SITE_NAME = 'Afiche';

/** Default page title + og:title + manifest `name`. */
export const SITE_TITLE = 'Afiche — cartelera curada de Buenos Aires';

/**
 * Default meta description — shared by the page metadata (src/app/layout.tsx)
 * and the web manifest (src/app/manifest.ts) so the two can't drift apart.
 */
export const SITE_DESCRIPTION =
  'Cartelera curada de cine en Buenos Aires. MALBA, Cine Lorca, Sala Lugones, Cosmos, Gaumont, y más.';
