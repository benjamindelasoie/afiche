import { PageShell } from '@/app/_components/ui';

// Route-local loading skeleton for /sala/[id] (TODO #37). The page is
// force-dynamic, so on soft navigation there's a server round-trip with no
// fallback UI without this file. A quiet placeholder that echoes the page's
// own shape — the two-column identity-rail + schedule grid, a big venue-name
// block in the rail, and a few date-rail / run-block rows on the right — so the
// swap-in doesn't reflow. Neutral pulse blocks only; no copy (per DESIGN.md the
// empty/error STATES carry copy, a loading flash should not).
function Bar({ className }: { className: string }) {
  return <div className={`rounded bg-black/[0.06] ${className}`} />;
}

export default function SalaLoading() {
  return (
    <PageShell
      width="6xl"
      pad="roomy"
      className="lg:grid lg:grid-cols-[20rem_1fr] lg:items-start lg:gap-x-14"
    >
      <div aria-hidden="true" className="animate-pulse">
        {/* Identity rail — back-link, venue name, address line. */}
        <aside className="mb-10 lg:mb-0">
          <Bar className="h-3 w-24" />
          <div className="mt-4 space-y-2">
            <Bar className="h-11 w-full" />
            <Bar className="h-11 w-2/3" />
          </div>
          <Bar className="mt-4 h-3 w-40" />
        </aside>
      </div>

      {/* Schedule column — a handful of date-rail rows. */}
      <div aria-hidden="true" className="animate-pulse space-y-8">
        {[0, 1, 2].map((day) => (
          <div key={day} className="space-y-4">
            <Bar className="h-3 w-32" /> {/* day banner */}
            {[0, 1].map((row) => (
              <div key={row} className="flex gap-4">
                <Bar className="h-24 w-16 shrink-0" /> {/* poster */}
                <div className="min-w-0 flex-1 space-y-2 py-1">
                  <Bar className="h-5 w-3/4" />
                  <Bar className="h-3 w-1/2" />
                  <Bar className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </PageShell>
  );
}
