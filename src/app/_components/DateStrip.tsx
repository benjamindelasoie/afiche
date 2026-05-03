'use client';

/**
 * DateStrip — sticky horizontal day-chip nav above the cartelera.
 *
 * Layout: 14 date chips (today through today+13) + 1 trailing "Próximamente →"
 * chip (only when there's content beyond day 14). Today is permanently
 * carmine-filled. Days with zero screenings are muted (50% opacity, still
 * tappable). When the user scrolls, the chip whose corresponding day section
 * is currently in the upper-middle viewport band gets a carmine underline.
 *
 * Active-state IO model:
 *
 *      viewport top
 *      ─────────────────────────────  ← rootMargin top: -30%
 *      |                            |
 *      |   ░░░░░░░░░░░░░░░░░░░░░░   |  ← 30% from top: active band starts
 *      |   ░░░  active band  ░░░░   |
 *      |   ░░░░░░░░░░░░░░░░░░░░░░   |  ← 50% from top: active band ends
 *      |                            |
 *      ─────────────────────────────  ← rootMargin bottom: -50%
 *      viewport bottom
 *
 * A day section is "in view" (and its chip gets the underline) when its
 * top edge is within that 30%-50% upper-middle band. Threshold is 0 — any
 * pixel-level intersection inside the rootMargin counts. This prevents
 * tall day sections (with 25 screenings) from never crossing a threshold:0.3
 * because they'd never be 30% inside such a small band.
 *
 * Auto-scroll-today: NOT implemented. Today is always the first chip
 * (position 0) in 14-day rolling, so it's never off-screen on first paint.
 */

import { useEffect, useRef, useState } from 'react';
import type { DayGroup } from '@/db/queries';

interface DateStripProps {
  days: DayGroup[];
  hasUpcoming: boolean;
}

const SHORT_DOW: Record<number, string> = {
  // ISO 0..6 with 0=Sunday matches Date.getUTCDay() / Date.getDay()
  0: 'dom',
  1: 'lun',
  2: 'mar',
  3: 'mié',
  4: 'jue',
  5: 'vie',
  6: 'sáb',
};

interface ChipMeta {
  dateKey: string;
  dayNum: string; // "2", "15", etc.
  dow: string; // "sáb"
  isToday: boolean;
  isWeekend: boolean;
  isEmpty: boolean;
  href: string;
  label: string;
}

function deriveChipMeta(day: DayGroup): ChipMeta {
  // Parse the dateKey ('YYYY-MM-DD') as a BA-noon UTC instant for stable
  // weekday derivation across time zones — same trick page.tsx uses elsewhere.
  const [y, m, d] = day.dateKey.split('-').map(Number);
  const noonBaUtc = new Date(Date.UTC(y, m - 1, d, 15));
  const dow = noonBaUtc.getUTCDay();
  return {
    dateKey: day.dateKey,
    dayNum: String(d),
    dow: SHORT_DOW[dow],
    isToday: day.isToday,
    isWeekend: dow === 0 || dow === 6,
    isEmpty: day.screenings.length === 0,
    href: `#dia-${day.dateKey}`,
    label: day.isToday ? `Hoy, ${day.label}` : day.label,
  };
}

export function DateStrip({ days, hasUpcoming }: DateStripProps) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Edge-fade gradients show only when the strip can actually scroll in
  // that direction — at scroll-start, no left fade; at scroll-end, no
  // right fade. Avoids a phantom "more this way" pointing at nothing.
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const stripRef = useRef<HTMLElement | null>(null);
  // Suppress IO updates while a chip-tap-driven smooth-scroll is in flight.
  // Otherwise the active chip would flicker through intermediate day
  // sections as scroll passes them, then settle on the target — visually
  // noisy and laggy. With this lockout, the optimistic update from the
  // click handler holds while the page scrolls; IO resumes once scroll
  // settles (~700ms is a generous budget for the smoothest case).
  const scrollLockoutUntilRef = useRef<number>(0);

  useEffect(() => {
    // Observe each day section by its anchor ID + the Próximamente
    // section. page.tsx must render <h2 id="dia-${dateKey}"> for each
    // day section AND <section id="proximamente"> for the awareness
    // layer — this is the contract.
    const dayTargets = days
      .map((d) => document.getElementById(`dia-${d.dateKey}`))
      .filter((el): el is HTMLElement => el !== null);
    const upcomingTarget = hasUpcoming ? document.getElementById('proximamente') : null;
    const targets = upcomingTarget ? [...dayTargets, upcomingTarget] : dayTargets;

    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Suppress updates during a click-driven smooth-scroll so the
        // optimistic active state from the click handler holds.
        if (Date.now() < scrollLockoutUntilRef.current) return;

        // Multiple sections may be intersecting simultaneously during scroll.
        // Pick the one closest to the top of the active band — that's the
        // section the user is "on."
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          const id = visible[0].target.id;
          // id is "dia-YYYY-MM-DD" or "proximamente"; map to chip key.
          if (id === 'proximamente') {
            setActiveKey('upcoming');
          } else {
            setActiveKey(id.slice(4));
          }
        }
      },
      {
        threshold: 0,
        rootMargin: '-30% 0px -50% 0px',
      },
    );

    targets.forEach((t) => observer.observe(t));
    return () => observer.disconnect();
  }, [days, hasUpcoming]);

  // Click-handler factory: optimistically set active chip + lock out IO
  // for ~700ms while the browser handles the anchor smooth-scroll. The
  // browser still does the actual scrolling natively (anchor href).
  const onChipClick = (key: string) => () => {
    setActiveKey(key);
    scrollLockoutUntilRef.current = Date.now() + 700;
  };

  // Edge-scroll detection: track whether the strip can scroll left or
  // right and toggle data-attributes on the wrapper. CSS in globals.css
  // shows the ::before / ::after edge-fade gradients only when the
  // matching data-attribute is "yes" — so the fades disappear at
  // scroll-start / scroll-end where they'd be phantom affordances.
  useEffect(() => {
    const stripEl = stripRef.current?.querySelector<HTMLElement>('.date-strip');
    if (!stripEl) return;

    const updateScrollState = () => {
      const { scrollLeft, scrollWidth, clientWidth } = stripEl;
      setCanScrollLeft(scrollLeft > 0);
      // -1 px tolerance for sub-pixel rounding at scroll-end.
      setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 1);
    };

    updateScrollState();
    stripEl.addEventListener('scroll', updateScrollState, { passive: true });
    // ResizeObserver picks up viewport changes (rotate, devtools resize)
    // that change clientWidth without firing a scroll event.
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(stripEl);

    return () => {
      stripEl.removeEventListener('scroll', updateScrollState);
      ro.disconnect();
    };
  }, []);

  // Scroll-spy companion: when the active chip changes (from IO scroll
  // tracking or from a click), if the active chip is NOT currently fully
  // visible inside the strip's horizontal viewport, scroll the strip
  // horizontally to center the active chip. This is the "you are here"
  // feedback the user expects on a sticky scroll-spy nav.
  //
  // We scroll the strip element directly via scrollTo (NOT
  // Element.scrollIntoView) because scrollIntoView would scroll all
  // ancestor scrollables — potentially nudging the page mid-interaction.
  // Manual scrollLeft on the strip stays scoped to just the strip.
  useEffect(() => {
    if (!activeKey) return;
    const stripEl = stripRef.current?.querySelector<HTMLElement>('.date-strip');
    if (!stripEl) return;
    const activeChip = stripEl.querySelector<HTMLElement>(
      `[data-date-key="${activeKey}"]`,
    );
    if (!activeChip) return;

    const chipStart = activeChip.offsetLeft;
    const chipEnd = chipStart + activeChip.offsetWidth;
    const visibleStart = stripEl.scrollLeft;
    const visibleEnd = visibleStart + stripEl.clientWidth;

    // Only intervene if chip is not fully visible. Otherwise leave the
    // strip's scroll position alone so manual scrolling within the strip
    // isn't fought by this effect.
    if (chipStart >= visibleStart && chipEnd <= visibleEnd) return;

    // Center the chip in the strip's visible area, clamped to scroll
    // bounds. Math.max(0, ...) prevents negative scroll on left edge;
    // the browser handles the right edge naturally.
    const targetScroll =
      activeChip.offsetLeft - (stripEl.clientWidth - activeChip.offsetWidth) / 2;
    stripEl.scrollTo({
      left: Math.max(0, targetScroll),
      behavior: 'smooth',
    });
  }, [activeKey]);

  return (
    <nav
      ref={stripRef}
      aria-label="Navegación por día"
      data-scroll-left={canScrollLeft ? 'yes' : 'no'}
      data-scroll-right={canScrollRight ? 'yes' : 'no'}
      // Sticky wrapper kept within the parent container's content bounds.
      // No positioning tricks (translate, viewport-width) — those compose
      // badly with `position: sticky`. The chips below clip to wrapper
      // width via `overflow-x: auto`, which is the textbook pattern for
      // sticky horizontal-scroll nav inside a max-width layout.
      // The data-scroll-* attrs drive conditional edge-fades in
      // globals.css — fades show only when scroll is possible in that
      // direction (no phantom affordances at scroll boundaries).
      className="date-strip-wrapper bg-cream sticky top-0 z-10 border-b border-black"
    >
      <div className="date-strip flex gap-1 overflow-x-auto py-2">
        {days.map((day) => {
          const c = deriveChipMeta(day);
          return (
            <a
              key={c.dateKey}
              href={c.href}
              data-date-key={c.dateKey}
              aria-label={c.label}
              aria-current={c.isToday ? 'date' : undefined}
              onClick={onChipClick(c.dateKey)}
              className={[
                'date-chip flex shrink-0 snap-start flex-col items-center justify-center px-3 py-2 font-mono no-underline',
                'min-w-[64px] transition-[background-color,border-color] duration-[50ms] ease-out',
                'focus-visible:outline-carmine focus-visible:outline-2 focus-visible:outline-offset-2',
                c.isToday ? 'bg-carmine text-cream' : 'text-ink hover:bg-carmine/10',
                c.isEmpty && !c.isToday ? 'opacity-50' : '',
                !c.isToday && c.dateKey === activeKey
                  ? 'border-carmine border-b-2'
                  : 'border-b-2 border-transparent',
              ].join(' ')}
            >
              <span
                className={[
                  'tracking-card text-[10px] uppercase',
                  c.isToday
                    ? 'text-cream'
                    : c.isWeekend
                      ? 'text-carmine'
                      : 'text-ink-gray',
                ].join(' ')}
              >
                {c.dow}
              </span>
              {c.isToday ? (
                // Today's chip carries "HOY" (mono caps) instead of the
                // numeric day. Echoes DESIGN.md's day-banner HOY pill —
                // tapping the today chip lands on a banner that also
                // reads "HOY". Visual + verbal symmetry.
                <span className="tracking-card text-cream font-mono text-[15px] font-bold uppercase">
                  HOY
                </span>
              ) : (
                <span className="text-ink font-serif text-[22px] leading-none tabular-nums">
                  {c.dayNum}
                </span>
              )}
            </a>
          );
        })}

        {hasUpcoming && (
          <a
            href="#proximamente"
            data-date-key="upcoming"
            aria-label="Saltar a próximamente"
            onClick={onChipClick('upcoming')}
            className={[
              'date-chip flex shrink-0 snap-start flex-col items-center justify-center px-3 py-2 font-mono no-underline',
              'text-ink hover:bg-carmine/10 min-w-[64px] transition-colors duration-[50ms] ease-out',
              'focus-visible:outline-carmine focus-visible:outline-2 focus-visible:outline-offset-2',
              activeKey === 'upcoming'
                ? 'border-carmine border-b-2'
                : 'border-b-2 border-transparent',
            ].join(' ')}
          >
            <span className="tracking-card text-ink-gray text-[10px] uppercase">
              próx.
            </span>
            <span className="font-serif text-[22px] leading-none">→</span>
          </a>
        )}
      </div>
    </nav>
  );
}
