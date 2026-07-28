'use client';

import { useEffect } from 'react';

/**
 * Last-resort boundary — catches errors thrown by the ROOT LAYOUT itself,
 * which the sibling error.tsx cannot, because that one renders inside the
 * layout that just failed.
 *
 * This file replaces the root layout entirely, so it must supply its own
 * <html> and <body>. That also means the app's fonts and Tailwind layer may
 * not be available: the styles here are INLINE on purpose, using the raw
 * design tokens (cream #f6efe2, ink #1a1a1a, carmine #c1272d from
 * globals.css) so the page still reads as afiche even with no stylesheet.
 *
 * Should essentially never render. Worth having anyway — the alternative is
 * an unstyled English framework error page as the site's public face during
 * its worst moment.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="es-AR">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f6efe2',
          color: '#1a1a1a',
          fontFamily: 'Georgia, "Times New Roman", serif',
          padding: '2rem',
        }}
      >
        <main style={{ maxWidth: '32rem', textAlign: 'center' }}>
          <p
            style={{
              fontSize: '0.75rem',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: '#c1272d',
              margin: '0 0 1.5rem',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          >
            afiche
          </p>
          <h1
            style={{
              fontSize: '1.75rem',
              fontStyle: 'italic',
              fontWeight: 400,
              lineHeight: 1.25,
              margin: '0 0 1rem',
            }}
          >
            La cartelera no está disponible.
          </h1>
          <p
            style={{
              fontSize: '1.05rem',
              fontStyle: 'italic',
              color: '#4a4a4a',
              margin: '0 0 2rem',
            }}
          >
            Estamos con un problema. Probá de nuevo en unos minutos.
          </p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: '1px solid #c1272d',
              color: '#c1272d',
              cursor: 'pointer',
              fontSize: '0.75rem',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              padding: '0 0 2px',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          >
            Reintentar
          </button>
        </main>
      </body>
    </html>
  );
}
