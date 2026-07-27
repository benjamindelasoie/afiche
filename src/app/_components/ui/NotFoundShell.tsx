import type { ReactNode } from 'react';
import { PageShell } from './PageShell';
import { BackLink } from './BackLink';

// NotFoundShell — the shared editorial 404 layout for /sala and /pelicula.
// Per design-review 2026-04-25: soft recovery copy (serif italic) + a clear
// path back to the cartelera, no generic error chrome. The two callers differ
// only in the two copy strings.
export function NotFoundShell({
  title,
  children,
}: {
  /** The serif-italic headline (e.g. "Esta sala no está en nuestra cartelera."). */
  title: string;
  /** The softer supporting line beneath it. */
  children: ReactNode;
}) {
  return (
    <PageShell width="5xl" pad="airy">
      <section className="space-y-6 py-12 text-center">
        <h1 className="text-ink font-serif text-2xl leading-tight text-balance italic md:text-3xl">
          {title}
        </h1>
        <p className="text-ink-gray font-serif text-lg italic">{children}</p>
        <BackLink className="mt-2">Cartelera actual</BackLink>
      </section>
    </PageShell>
  );
}
