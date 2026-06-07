import Image from 'next/image';
import Link from 'next/link';
import type { FeaturedPick } from '@/db/queries';

// ---------------------------------------------------------------------------
// CuratedBand — the static "Esta semana" hero band.
//
// 0–4 derived picks (Estreno / Última función / Ciclo …), never auto-rotating.
// Mobile = horizontal scroll of compact poster cards; desktop = a full-width
// 4-column grid of larger posters. When `picks` is empty the band is omitted
// ENTIRELY (no empty shell, no neutral filler) — the caller already passes
// `[]` in that case, and this component returns null defensively too.
// ---------------------------------------------------------------------------

function CuratedCard({ pick, priority }: { pick: FeaturedPick; priority: boolean }) {
  const { film, reasonLabel } = pick;
  const href = film.slug ? `/pelicula/${film.slug}` : undefined;
  const meta = [film.director, film.year ? String(film.year) : null]
    .filter(Boolean)
    .join(' · ');

  const inner = (
    <>
      <div className="bg-cream relative aspect-[3/4] w-full overflow-hidden border border-black shadow-[4px_4px_0_var(--color-carmine)] transition-[box-shadow,transform] duration-150 group-hover:translate-x-px group-hover:translate-y-px group-hover:shadow-[2px_2px_0_var(--color-carmine)] md:shadow-[6px_6px_0_var(--color-carmine)] md:group-hover:shadow-[3px_3px_0_var(--color-carmine)]">
        {film.posterUrl ? (
          <Image
            src={film.posterUrl}
            alt={film.title}
            width={232}
            height={310}
            sizes="(min-width: 768px) 270px, 116px"
            // The band sits above the film grid, so its first poster is the
            // page LCP — eager-load it (ISSUE-001, /qa 2026-06-06).
            priority={priority}
            className="h-full w-full object-cover"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/no-poster.svg"
            alt=""
            width={232}
            height={310}
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <p className="text-carmine mt-2 truncate font-mono text-[9px] tracking-[0.15em] uppercase md:mt-3 md:text-[10px]">
        {reasonLabel}
      </p>
      <p className="font-serif text-[18px] leading-[1.05] md:text-2xl">{film.title}</p>
      {meta ? (
        <p className="text-ink-gray hidden font-sans text-xs md:block">{meta}</p>
      ) : null}
    </>
  );

  return href ? (
    <Link href={href} className="group block w-[116px] shrink-0 md:w-auto">
      {inner}
    </Link>
  ) : (
    <div className="group w-[116px] shrink-0 md:w-auto">{inner}</div>
  );
}

export function CuratedBand({ picks }: { picks: FeaturedPick[] }) {
  if (picks.length === 0) return null;
  return (
    <section aria-label="Esta semana" className="mt-5 md:mt-8">
      <h2 className="mb-3 font-serif text-[23px] italic md:mb-4 md:text-[30px]">
        Esta semana <span className="text-carmine">—</span>
      </h2>
      <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-1.5 sm:-mx-6 sm:px-6 md:mx-0 md:grid md:grid-cols-4 md:gap-[30px] md:overflow-visible md:px-0">
        {picks.map((p, i) => (
          <CuratedCard key={p.film.id} pick={p} priority={i === 0} />
        ))}
      </div>
    </section>
  );
}
