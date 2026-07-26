import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

// PageShell — the one place the top-level `<main>` layout contract lives.
//
// `<body>` is `flex min-h-full flex-col` (sticky-footer pattern, layout.tsx),
// so every `<main>` is a direct flex child and MUST carry `w-full min-w-0` or
// it sizes to its content's natural width and overflows the viewport on mobile
// (CLAUDE.md "Frontend conventions" #1; the 2026-05-03 incident). Centralizing
// the invariant here means a page can never forget it — and the layout-
// invariant test asserts it on THIS file instead of re-checking every page.
//
// `width` sets the CHROME width (the masthead + footer span this). When a page
// wants a narrower reading column than its chrome (e.g. /cartelera: 6xl chrome,
// 5xl content), it wraps the content in <ContentColumn>. See DESIGN.md
// (2026-07-25 chrome/content split).

export const LAYOUT_WIDTHS = {
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
} as const;

// Vertical rhythm presets. `flush` = no top padding (the masthead's own
// pt-8/md:pt-12 sets the top gap) + pb-12 bottom, for the masthead-led home /
// cartelera. `roomy` = the interior-page py (pelicula, sala). `airy` = the
// generous empty/404 py.
const PADS = {
  flush: 'pb-12',
  roomy: 'py-8 md:py-16',
  airy: 'py-16 md:py-24',
} as const;

export function PageShell({
  width = '6xl',
  pad = 'flush',
  className,
  children,
}: {
  width?: keyof typeof LAYOUT_WIDTHS;
  pad?: keyof typeof PADS;
  /** Extra classes on the <main> itself (e.g. the /sala lg:grid layout). */
  className?: string;
  children: ReactNode;
}) {
  return (
    <main
      className={cn(
        'mx-auto w-full min-w-0 px-4 sm:px-6',
        LAYOUT_WIDTHS[width],
        PADS[pad],
        className,
      )}
    >
      {children}
    </main>
  );
}
