import type { ElementType, ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';

// Pill — the micro-caps tag chip from DESIGN.md's card strip. Two sizes and two
// fills cover every use:
//   • solid (default) — carmine fill, cream text: tags, "Última", program name.
//   • ghost            — carmine text + hairline carmine border, no fill: the
//                        program-name pill on the venue agenda / runs.
//   • size sm (default) — px-1.5 · text-[10px]  (dense index/agenda rows)
//   • size md           — px-2   · text-[11px]  (roomy ScreeningCard strip)
// Rendered inline by default so it drops into text flow like the raw spans it
// replaces; callers add `align-middle` / `ml-*` / `truncate max-w-*` as needed.
const SIZES = {
  sm: 'px-1.5 py-0.5 text-[10px]',
  md: 'px-2 py-0.5 text-[11px]',
} as const;

const VARIANTS = {
  solid: 'bg-carmine text-cream',
  ghost: 'text-carmine border-carmine/40 border',
} as const;

type PillProps<T extends ElementType> = {
  as?: T;
  size?: keyof typeof SIZES;
  variant?: keyof typeof VARIANTS;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className'>;

export function Pill<T extends ElementType = 'span'>({
  as,
  size = 'sm',
  variant = 'solid',
  className,
  ...props
}: PillProps<T>) {
  const Component = as ?? 'span';
  return (
    <Component
      className={cn(
        'tracking-card font-mono uppercase',
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
