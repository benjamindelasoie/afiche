import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { LAYOUT_WIDTHS } from './PageShell';

// ContentColumn — a narrower reading column nested inside a wider PageShell.
//
// Used when a page's chrome (masthead + footer) should span a wider width than
// its content. Today that's /cartelera: 6xl chrome so its masthead matches the
// homepage's, 5xl content so the day-by-day list keeps the DESIGN.md-documented
// single-column reading width (2026-06-06/07). Carries `w-full min-w-0` for the
// same flex-item reason as PageShell (it's still inside the flex column).
export function ContentColumn({
  width = '5xl',
  className,
  children,
}: {
  width?: keyof typeof LAYOUT_WIDTHS;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('mx-auto w-full min-w-0', LAYOUT_WIDTHS[width], className)}>
      {children}
    </div>
  );
}
