import Link from 'next/link';
import { WINDOWS, DEFAULT_WINDOW, type WindowKey } from '@/lib/windows';

// ---------------------------------------------------------------------------
// WindowNav — sticky time-window pills + "Ver todo →".
//
// Server component: the pills are plain <Link>s to `/?ventana=…` (the default
// window links to clean `/`), so window switching is a server-rendered
// navigation — shareable URLs, no client JS. The active pill is derived from
// the resolved window key. "Ver todo →" links to /cartelera (the exhaustive
// day-by-day view), reassuring against the illusion-of-completeness risk.
//
// Sticky lives on the <nav> itself; the pill rail scrolls horizontally via its
// own overflow-x-auto (no body-level overflow, no transforms — both compose
// badly with position: sticky, per CLAUDE.md frontend conventions).
// ---------------------------------------------------------------------------

function pillHref(key: WindowKey): string {
  return key === DEFAULT_WINDOW ? '/' : `/?ventana=${key}`;
}

function VerTodo({ className }: { className?: string }) {
  return (
    <Link
      href="/cartelera"
      className={`tracking-card text-ink-gray border-b border-black/10 font-mono text-[10px] whitespace-nowrap uppercase ${className ?? ''}`}
    >
      Ver todo <span className="text-carmine">→</span>
    </Link>
  );
}

export function WindowNav({ active }: { active: WindowKey }) {
  return (
    <nav
      aria-label="Ventana temporal"
      className="bg-cream sticky top-0 z-10 border-b border-black"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {WINDOWS.map((w) => {
            const isActive = w.key === active;
            return (
              <Link
                key={w.key}
                href={pillHref(w.key)}
                aria-current={isActive ? 'page' : undefined}
                className={[
                  'tracking-card shrink-0 border px-3 py-1.5 font-mono text-[11px] whitespace-nowrap uppercase transition-colors duration-[50ms] ease-out',
                  isActive
                    ? 'border-carmine bg-carmine text-cream'
                    : 'border-ink text-ink hover:bg-black/5',
                ].join(' ')}
              >
                {w.label}
                {w.key === 'prox' ? ' →' : ''}
              </Link>
            );
          })}
        </div>
        {/* Desktop: inline on the pill row, right-aligned. */}
        <VerTodo className="hidden shrink-0 md:inline-block" />
      </div>
      {/* Mobile: its own right-aligned row under the pills. */}
      <div className="flex justify-end pb-2 md:hidden">
        <VerTodo />
      </div>
    </nav>
  );
}
