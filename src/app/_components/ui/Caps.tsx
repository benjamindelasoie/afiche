import type { ElementType, ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';

// Caps — the mono micro-caps type token (Geist Mono, uppercase, tracked).
// Implements the two tracked-label roles from DESIGN.md's type scale:
//   • eyebrow   — 0.25em tracking, weight 400 (masthead dateline, footer,
//                 week context, section counts, back-links)
//   • card      — 0.2em tracking, weight 500 (card-caps: cinema names, denser
//                 in-card labels)
// Size (text-[11px] default) and color are left to the caller via `className`
// — cn()'s tailwind-merge lets an override beat the default predictably.
const TRACKING = {
  eyebrow: 'tracking-eyebrow font-normal',
  card: 'tracking-card font-medium',
} as const;

type CapsProps<T extends ElementType> = {
  as?: T;
  variant?: keyof typeof TRACKING;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className'>;

export function Caps<T extends ElementType = 'span'>({
  as,
  variant = 'eyebrow',
  className,
  ...props
}: CapsProps<T>) {
  const Component = as ?? 'span';
  return (
    <Component
      className={cn('font-mono text-[11px] uppercase', TRACKING[variant], className)}
      {...props}
    />
  );
}
