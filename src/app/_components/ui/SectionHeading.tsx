import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Caps } from './Caps';

// SectionHeading — the two section-title registers used across the site.
//
//   • display (default) — the big centered serif-italic header (DESIGN.md
//     display-lg: "Próximamente" / "Destacados"), with an optional centered
//     mono subtitle line (range · counts). Used on /cartelera + /sala.
//   • bordered           — a smaller serif-italic header sitting on a top
//     hairline, with an optional inline `trailing` node (e.g. a function
//     count). Used on /pelicula ("Reparto", "Próximas funciones").
export function SectionHeading({
  variant = 'display',
  subtitle,
  trailing,
  className,
  children,
}: {
  variant?: 'display' | 'bordered';
  /** display only — centered mono subtitle beneath the title. */
  subtitle?: ReactNode;
  /** bordered only — inline node after the title (e.g. a count). */
  trailing?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  if (variant === 'bordered') {
    return (
      <h2
        className={cn(
          'border-t border-black pt-4 font-serif text-2xl leading-none italic md:text-3xl',
          className,
        )}
      >
        {children}
        {trailing}
      </h2>
    );
  }
  return (
    <div className={cn('py-3 text-center md:py-4', className)}>
      <h2 className="font-serif text-4xl leading-none text-balance italic md:text-5xl">
        {children}
      </h2>
      {subtitle ? (
        <Caps
          as="p"
          className="text-ink-gray mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 md:mt-3"
        >
          {subtitle}
        </Caps>
      ) : null}
    </div>
  );
}
