import Link from 'next/link';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';
import { focusRing } from './recipes';

// StretchedLink — the invisible absolute anchor that turns a whole row/card
// into one tap target (→ /pelicula) without nesting <a> inside <a>. Sibling
// links (cinema name, ticketing, Agendar) sit above it via `relative z-10`.
// `data-screening-card` opts the row into the visited-fade (globals.css) and is
// the hook the layout-invariant test counts. Internal Next links only; the
// external ticketing stretch on /pelicula stays a raw <a target=_blank>.
export function StretchedLink({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof Link>) {
  return (
    <Link
      data-screening-card
      className={cn('absolute inset-0', focusRing, className)}
      {...props}
    />
  );
}
