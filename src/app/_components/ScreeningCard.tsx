import Image from 'next/image';
import Link from 'next/link';
import { formatTimeBA, type ScreeningRow } from '@/db/queries';
import { TAG_LABELS_ES } from '@/db';
import { cn } from '@/lib/cn';
import { Pill, StretchedLink, hoverRail } from './ui';

// Heuristic: synopsis must be long enough and end with terminal punctuation.
// Filters out ~100-140 char Lumiton tile-preview synopses that trail off
// mid-sentence with dangling commas.
export function isCompleteSynopsis(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 60) return false;
  return /[.!?…»"']$/.test(trimmed);
}

function ProgramPill({ name }: { name: string }) {
  return (
    <Pill size="md" title={name} className="max-w-[40ch] truncate">
      {name}
    </Pill>
  );
}

export function ScreeningCard({
  s,
  isAboveFold,
  isLastFunction,
}: {
  s: ScreeningRow;
  isAboveFold: boolean;
  // True when this screening is the LAST upcoming screening of its
  // film across the entire BA cartelera (computed unbounded, NOT
  // limited to cartelera tier horizons). Renders a carmine ÚLTIMA
  // FUNCIÓN pill in the tag strip.
  isLastFunction: boolean;
}) {
  // DESIGN.md display-md spec: tracking -0.01em (NOT Tailwind's tracking-tight
  // = -0.025em). Looser tracking is more legible at 24–30px card-title sizes.
  const titleClass =
    'font-serif text-2xl sm:text-3xl leading-tight tracking-[-0.01em] text-balance';
  const timeClass =
    'font-serif italic text-4xl leading-none text-carmine tabular-nums md:mt-2';

  // Filter out 'cycle' — inferTags pushes it onto every cycle-venue card, so
  // universal ≠ signal. Only meaningful tags (RESTAURADA / RETROSPECTIVA /
  // festival names) render; the ProgramPill carries the cycle name instead.
  const visibleTags = s.tags.filter((t) => t !== 'cycle');
  const showTagStrip = visibleTags.length > 0 || s.programName !== null || isLastFunction;

  const cardBody = (
    <>
      {showTagStrip && (
        <div className="mb-2 flex flex-wrap gap-2">
          {isLastFunction && <Pill size="md">Última función</Pill>}
          {visibleTags.map((t) => (
            <Pill key={t} size="md">
              {TAG_LABELS_ES[t]}
            </Pill>
          ))}
          {s.programName && <ProgramPill name={s.programName} />}
        </div>
      )}

      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="flex min-w-0 gap-4 md:flex-1">
          {s.cinema.type === 'indie' && (
            <div className="bg-cream flex h-28 w-20 shrink-0 items-center justify-center overflow-hidden border border-black shadow-[4px_4px_0_var(--color-carmine)] transition-[box-shadow,transform] duration-150 group-hover:translate-x-px group-hover:translate-y-px group-hover:shadow-[2px_2px_0_var(--color-carmine)]">
              {s.film.posterUrl ? (
                <Image
                  src={s.film.posterUrl}
                  alt={s.film.title}
                  width={80}
                  height={112}
                  sizes="80px"
                  loading={isAboveFold ? 'eager' : 'lazy'}
                  fetchPriority={isAboveFold ? 'high' : 'auto'}
                  className="h-full w-full object-cover"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src="/no-poster.svg"
                  alt=""
                  width={80}
                  height={112}
                  className="h-full w-full object-cover"
                />
              )}
            </div>
          )}
          <div className="min-w-0 flex-1">
            {s.cinema.type === 'indie' ? (
              <h3 className={titleClass}>{s.film.title}</h3>
            ) : (
              <h3 className="font-sans text-lg leading-tight font-medium text-balance">
                {s.film.title}
              </h3>
            )}
            {s.film.titleOriginal &&
              s.film.titleOriginal.toLowerCase() !== s.film.title.toLowerCase() && (
                <p className="text-ink-gray mt-0.5 font-serif text-base italic sm:text-lg">
                  «{s.film.titleOriginal}»
                </p>
              )}
            {s.film.director && (
              <p className="text-ink-gray mt-1 text-sm">
                {s.film.director}
                {s.film.year && ` · ${s.film.year}`}
                {s.film.country && (
                  <span className="hidden sm:inline"> · {s.film.country}</span>
                )}
                {s.film.runtimeMin ? ` · ${s.film.runtimeMin} min` : null}
              </p>
            )}
            {s.film.synopsisEs &&
              s.cinema.type === 'indie' &&
              isCompleteSynopsis(s.film.synopsisEs) && (
                <div className="mt-3 hidden md:block">
                  <p
                    className="line-clamp-3 max-w-prose text-sm"
                    style={{
                      maskImage:
                        'linear-gradient(to bottom, black 70%, transparent 100%)',
                      WebkitMaskImage:
                        'linear-gradient(to bottom, black 70%, transparent 100%)',
                    }}
                  >
                    {s.film.synopsisEs}
                  </p>
                </div>
              )}
          </div>
        </div>

        <div className="flex items-end justify-between gap-4 md:shrink-0 md:flex-col md:items-end md:gap-0 md:text-right">
          <div>
            <Link
              href={`/sala/${s.cinema.id}`}
              className={`tracking-card relative z-10 font-mono text-xs uppercase ${
                s.cinema.type === 'indie' ? 'text-carmine font-bold' : 'text-ink-gray'
              }`}
            >
              {s.cinema.name}
            </Link>
            {s.cinema.neighborhood && (
              <p className="text-ink-gray mt-1 font-mono text-[11px] tracking-wider uppercase">
                {s.cinema.neighborhood}
              </p>
            )}
          </div>
          <time dateTime={s.startsAtUtc.toISOString()} className={timeClass}>
            {formatTimeBA(s.startsAtUtc)}
          </time>
        </div>
      </div>
    </>
  );

  // Stretched-link pattern: article is the visual card; invisible absolute
  // <Link> covers it for the film-page tap target. Cinema name sits above
  // via relative z-10 — avoids nesting <a> inside <a>.
  // De-tinted hairline row, aligned with the homepage FilmRow: no card fill,
  // no carmine left-bar — carmine lives on the time + a hover left-tick. The
  // carmine offset-shadow poster (the site's visual fingerprint) stays.
  const cardClasses = cn(
    'group isolate block border-b border-black/10 px-1 py-4 last:border-b-0 [&:has(a:active)]:translate-y-[1px]',
    hoverRail({ inset: 'lg' }),
  );

  const ariaLabel = `${s.film.title} — ${s.cinema.name} — ${formatTimeBA(s.startsAtUtc)}`;
  return (
    <article className={cardClasses}>
      {s.film.slug && (
        <StretchedLink href={`/pelicula/${s.film.slug}`} aria-label={ariaLabel} />
      )}
      {cardBody}
    </article>
  );
}
