'use client'; // Error boundaries must be Client Components

import { useEffect } from 'react';
// Deep imports, not the '@/app/_components/ui' barrel — see the note in
// src/app/error.tsx and src/client-boundary.test.ts. A barrel pulled into a
// Client Component bundles everything it re-exports.
import { PageShell } from '@/app/_components/ui/PageShell';
import { BackLink } from '@/app/_components/ui/BackLink';
import { Caps } from '@/app/_components/ui/Caps';
import { focusRing } from '@/app/_components/ui/recipes';
import { cn } from '@/lib/cn';

// Route-local error boundary for /sala/[id] (TODO #37). Editorial recovery copy
// per DESIGN.md Interaction-States (the "Error" row): serif-italic, an action
// hint, a retry, and a path back to the cartelera — no generic error chrome,
// matching NotFoundShell's grammar. In dev we surface the stack; in prod the
// message is withheld (Server-Component errors arrive as a generic string +
// digest anyway, see Next's error.js docs).
export default function SalaError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  // Next 16 renamed the old `reset` prop to `unstable_retry` — it re-fetches
  // and re-renders this segment's children (node_modules/next/dist/docs error.js).
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
          La cartelera está rehaciéndose.
        </h1>
        <p className="text-ink-gray font-serif text-lg italic">
          Intentá de nuevo en unos minutos.
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
