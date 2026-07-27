import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Caps } from './Caps';

// BackLink — the "← Cartelera" editorial breadcrumb back to the homepage.
// Carmine mono-caps with a carmine underline. Two forms:
//   • default   — inline-block, underline on the link (pelicula, 404s).
//   • hitArea    — 44px touch target with the underline on the inner text span
//                  only (the /sala identity rail, where the link is padded).
export function BackLink({
  href = '/',
  children = 'Cartelera',
  hitArea = false,
  className,
}: {
  href?: string;
  children?: ReactNode;
  /** 44px touch target with the underline scoped to the text (rail context). */
  hitArea?: boolean;
  className?: string;
}) {
  if (hitArea) {
    return (
      <Caps
        as={Link}
        href={href}
        className={cn('text-carmine inline-flex min-h-[44px] items-center', className)}
      >
        <span className="border-carmine border-b">← {children}</span>
      </Caps>
    );
  }
  return (
    <Caps
      as={Link}
      href={href}
      className={cn('text-carmine border-carmine inline-block border-b', className)}
    >
      ← {children}
    </Caps>
  );
}
