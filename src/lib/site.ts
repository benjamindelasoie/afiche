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
 * Product name in metadata. Lowercase "afiche" EVERYWHERE — the brand is
 * standardized on the lowercase wordmark (decision 2026-06-14); capital-A
 * "Afiche" is retired. Drives SITE_TITLE, the manifest name/short_name, and the
 * apple-web-app home-screen label. (Readable-English prose in docs is a
 * separate style call and stays mixed-case.)
 */
export const SITE_NAME = 'afiche';

/** Default page title + og:title + manifest `name`. */
export const SITE_TITLE = 'afiche — cartelera curada de Buenos Aires';

/**
 * Default meta description — shared by the page metadata (src/app/layout.tsx)
 * and the web manifest (src/app/manifest.ts) so the two can't drift apart.
 */
export const SITE_DESCRIPTION =
  'Cartelera curada de cine en Buenos Aires. MALBA, Cine Lorca, Sala Lugones, Cosmos, Gaumont, y más.';

/**
 * BCP-47 language tag for the site. `es-AR` (used on <html lang>) for human
 * copy; the OpenGraph `og:locale` variant is the underscore form `es_AR`
 * (see src/app/layout.tsx). Single source so the two can't drift.
 */
export const SITE_LOCALE = 'es-AR';

/**
 * Canonical public source-of-truth for the project — the code-available repo's
 * author profile. afiche has no separate social presence; this GitHub identity
 * IS the project's external home, so it's the `sameAs` on the site's
 * Organization JSON-LD (src/lib/json-ld.tsx) and the "source" pointer in
 * /llms.txt. Kept out of product copy per the public-repo hygiene rule.
 */
export const SITE_SOURCE_URL = 'https://github.com/benjamindelasoie';
