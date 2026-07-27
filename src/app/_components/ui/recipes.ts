import { cn } from '@/lib/cn';

// Class-recipe tokens — named Tailwind recipes that are too structural to be a
// component (the caller owns the element + layout) but too repeated to inline.
// CVA-style: each returns a className string, composed at the call site via
// `cn('...caller layout...', recipe())`.

// focusRing — the keyboard focus treatment used on every interactive element.
// DESIGN.md: 2px carmine outline, 2px offset, focus-visible only. (Chain-venue
// surfaces that want a black ring override `outline-carmine` via cn.)
export const focusRing =
  'focus-visible:outline-carmine focus-visible:outline-2 focus-visible:outline-offset-2';

// hoverRail — Afiche's signature row-hover interaction (DESIGN.md 2026-06-06/07,
// the de-tint that retired bg-carmine/5): a faint bg wash + a 3px carmine
// left-tick that scales in from the top on hover. The tick's vertical inset
// tracks the row's own padding so it never runs past the row edges; `gutter`
// shifts it left into a rail gutter (the /sala VenueAgenda date-rail) instead
// of flush at the row's left edge.
const RAIL_INSET = {
  xs: 'before:top-2 before:bottom-2', // tight rows (CiclosEnCurso py-2)
  sm: 'before:top-3 before:bottom-3', // index rows (py-3)
  md: 'before:top-4 before:bottom-4', // standard rows (py-4)
  lg: 'before:top-5 before:bottom-5', // roomy cards (py-5 / ScreeningCard)
} as const;

export function hoverRail({
  inset = 'md',
  gutter = false,
}: { inset?: keyof typeof RAIL_INSET; gutter?: boolean } = {}) {
  return cn(
    'relative transition-colors',
    'before:bg-carmine before:absolute before:w-[3px] before:origin-top before:scale-y-0 before:transition-transform before:duration-150',
    'hover:bg-black/[0.025] hover:before:scale-y-100',
    RAIL_INSET[inset],
    gutter ? 'before:-left-1.5' : 'before:left-0',
  );
}
