import { PageShell } from '@/app/_components/ui';

// Route-local loading skeleton for /pelicula/[slug]. The page reads the DB per
// request, so on soft navigation (tapping a card on the cartelera) there's a
// server round-trip with no fallback UI without this file — the same gap TODO
// #37 closed for /sala/[id], left open here until 1.0.
//
// Echoes the detail page's own shape — poster block beside a title/meta stack,
// then a synopsis paragraph and a few showtime rows — so the swap-in doesn't
// reflow. Neutral pulse blocks only, no copy: per DESIGN.md the empty and
// error STATES carry copy, a loading flash should not.
function Bar({ className }: { className: string }) {
  return <div className={`rounded bg-black/[0.06] ${className}`} />;
}

export default function PeliculaLoading() {
  return (
    <PageShell width="5xl" pad="roomy">
      <div aria-hidden="true" className="animate-pulse">
        <Bar className="h-3 w-24" />

        {/* Poster + identity block. */}
        <div className="mt-8 flex flex-col gap-8 sm:flex-row">
          <Bar className="h-[21rem] w-full shrink-0 sm:h-[16.5rem] sm:w-44" />
          <div className="flex-1 space-y-3">
            <Bar className="h-10 w-full" />
            <Bar className="h-10 w-3/5" />
            <Bar className="mt-5 h-3 w-52" />
            <Bar className="h-3 w-40" />
          </div>
        </div>

        {/* Synopsis. */}
        <div className="mt-12 space-y-2">
          <Bar className="h-3 w-full" />
          <Bar className="h-3 w-full" />
          <Bar className="h-3 w-4/5" />
        </div>

        {/* Upcoming showtimes. */}
        <div className="mt-12 space-y-4">
          <Bar className="h-3 w-32" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <Bar className="h-4 w-16" />
              <Bar className="h-4 flex-1" />
            </div>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
