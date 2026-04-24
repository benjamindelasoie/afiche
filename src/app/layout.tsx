import type { Metadata } from 'next';
import { Geist, Geist_Mono, Instrument_Serif } from 'next/font/google';
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

export const metadata: Metadata = {
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
    >
      <body className="bg-cream text-ink flex min-h-full flex-col">{children}</body>
    </html>
  );
}
