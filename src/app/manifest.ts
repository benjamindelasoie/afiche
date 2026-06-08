import type { MetadataRoute } from 'next';
import { SITE_NAME, SITE_TITLE, SITE_DESCRIPTION } from '@/lib/site';

// Web App Manifest — makes Afiche installable to a phone home screen.
//
// Division of labor on iOS vs Android:
//   - iOS reads the apple-touch-icon (src/app/apple-icon.png) for the
//     home-screen glyph and the `appleWebApp` block in layout.tsx for the
//     standalone title/launch; it largely ignores this manifest's icons.
//   - Android/Chrome reads THIS file for the install prompt, the icons,
//     and the standalone display mode.
//
// Icons are the carmine "a" wordmark monogram (public/icon-{192,512}.png),
// regenerated from scripts/app-icon.html by scripts/build-app-icons.sh.
// Cream theme/background so the standalone splash + status bar read as the
// same paper as the page. The 512 doubles as the maskable icon — the field
// is full-bleed carmine and the glyph sits well inside the safe zone.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_TITLE,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    lang: 'es-AR',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6efe2',
    theme_color: '#f6efe2',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
