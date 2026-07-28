'use client'; // Error boundaries must be Client Components

import { useEffect } from 'react';
import { PageShell, BackLink, Caps, focusRing } from '@/app/_components/ui';
import { cn } from '@/lib/cn';

/**
 * Root error boundary — catches render errors on /, /cartelera, /acerca and
 * /pelicula/[slug] (which has no boundary of its own until this release).
 *
 * TODO #37 gave /sala/[id] this treatment and stopped there, so every other
 * route fell through to Next's default error page. Same editorial grammar as
 * the /sala boundary and NotFoundShell: serif-italic recovery copy, a retry,
 * a way back to the cartelera, no generic error chrome. Dev surfaces the
 * stack; prod withholds it (Server-Component errors arrive as a generic
 * string + digest anyway).
 *
 * Copy differs from /sala's deliberately: that one can promise the cartelera
 * is "rehaciéndose" because a venue page is one slice of a known-good whole.
 * At the root the failure may BE the cartelera, so the line is about the page,
 * not the data.
 */
export default function RootError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  // Next 16 renamed `reset` → `unstable_retry`.
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const isDev = process.env.NODE_ENV === 'development';

  return (
    <PageShell width="5xl" pad="airy">
      <section className="space-y-6 py-12 text-center">
        <h1 className="text-ink font-serif text-2xl leading-tight text-balance italic md:text-3xl">
          Algo se rompió de este lado.
        </h1>
        <p className="text-ink-gray font-serif text-lg italic">
          No es tu conexión. Probá de nuevo en unos minutos.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 pt-2">
          <Caps
            as="button"
            type="button"
            onClick={() => unstable_retry()}
            className={cn('text-carmine border-carmine border-b', focusRing)}
          >
            Reintentar
          </Caps>
          <BackLink>Cartelera actual</BackLink>
        </div>
        {isDev && (
          <pre className="text-ink-gray mt-8 overflow-x-auto rounded border border-black/10 bg-black/[0.03] p-4 text-left font-mono text-xs whitespace-pre-wrap">
            {error.stack ?? error.message}
            {error.digest ? `\n\ndigest: ${error.digest}` : ''}
          </pre>
        )}
      </section>
    </PageShell>
  );
}
