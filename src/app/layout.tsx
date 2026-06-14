import type { Metadata } from 'next';
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SITE_URL, SITE_TITLE, SITE_DESCRIPTION } from '@/lib/site';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

// Instrument Serif is the display family — masthead, day banners, film
// titles, time. Regular + italic in one weight (400). `display: swap`
// with Georgia fallback keeps the first paint fast; next/font auto-
// generates size-adjust metrics on Georgia to minimize layout shift
// when the real font swaps in.
const instrumentSerif = Instrument_Serif({
  variable: '--font-instrument-serif',
  weight: '400',
  style: ['normal', 'italic'],
  subsets: ['latin'],
  display: 'swap',
  fallback: ['Georgia', 'serif'],
});

// metadataBase lets Next.js resolve the file-convention OG image
// (src/app/opengraph-image.png) to an absolute URL for og:image and
// twitter:image meta tags. Without it the OG image URL is relative,
// which Instagram/Slack/etc. won't resolve correctly when a link is
// shared from a third-party context.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  // Home-screen / standalone behavior on iOS. `capable` opts into the
  // fullscreen standalone launch (no Safari chrome) so a home-screen tap
  // feels like an app; `title` is the short label shown under the icon
  // (the full <title> would truncate to "Afiche — c…"). The home-screen
  // glyph itself comes from the apple-icon file convention
  // (src/app/apple-icon.png). Android/Chrome install is driven by
  // src/app/manifest.ts.
  appleWebApp: {
    capable: true,
    title: 'afiche',
    statusBarStyle: 'default',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es-AR"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
      data-scroll-behavior="smooth"
    >
      <body className="bg-cream text-ink flex min-h-full flex-col">
        {children}
        {/* Vercel Web Analytics — cookieless pageview + referrer tracking.
            No PII, no consent banner required under Ley 25.326 / GDPR.
            Inert in development (no requests fire from localhost). Dashboard
            at vercel.com/<project>/analytics. */}
        <Analytics />
      </body>
    </html>
  );
}
