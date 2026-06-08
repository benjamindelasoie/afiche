import type { Metadata } from 'next';
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import { SITE_URL } from '@/lib/site';
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
  title: 'Afiche — cartelera curada de Buenos Aires',
  description:
    'Cartelera curada de cine en Buenos Aires. MALBA, Cine Lorca, Sala Lugones, Cosmos, Gaumont, y más.',
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
