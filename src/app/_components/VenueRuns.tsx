import Image from 'next/image';
import Link from 'next/link';
import {
  formatWeekdaySet,
  formatRunDateRange,
  type ScreeningRun,
  type RunSignature,
} from '@/lib/screening-runs';

// ---------------------------------------------------------------------------
// VenueRuns — the /sala/<id> "weekly-run" shape for fixed-weekly venues
// (Lorca, Cosmos). Film-first ALL THE WAY THROUGH: one block per film. A
// uniform daily run shows a single "días · horarios" line; a non-uniform film
// (rare; defensive) keeps ONE block with a line per time-signature — never a
// separate chronological section (design review 2026-06-09). See TODOS.md #34b.
//
// Reuses VenueAgenda's vocabulary: cream-box poster + carmine offset shadow,
// carmine serif-italic times, stretched /pelicula link, hover left-tick.
// ---------------------------------------------------------------------------
export function VenueRuns({ runs }: { runs: ScreeningRun[] }) {
  return (
    <div>
      {runs.map((run) => (
        <RunBlock key={run.film.id} run={run} />
      ))}
    </div>
  );
}

function RunBlock({ run }: { run: ScreeningRun }) {
  const { film, programName } = run;
  return (
    <article className="group before:bg-carmine relative flex gap-4 border-b border-black/10 py-5 transition-colors before:absolute before:top-5 before:bottom-5 before:-left-1.5 before:w-[3px] before:origin-top before:scale-y-0 before:transition-transform before:duration-150 first:border-t hover:bg-black/[0.025] hover:before:scale-y-100 [&:has(a:active)]:translate-y-[1px]">
      {film.slug && (
        <Link
          href={`/pelicula/${film.slug}`}
          data-screening-card
          className="focus-visible:outline-carmine absolute inset-0 focus-visible:outline-2 focus-visible:outline-offset-2"
          aria-label={`${film.title} — funciones`}
        />
      )}

      <div className="bg-cream flex h-[108px] w-[74px] shrink-0 items-center justify-center overflow-hidden border border-black shadow-[4px_4px_0_var(--color-carmine)] transition-[box-shadow,transform] duration-150 group-hover:translate-x-px group-hover:translate-y-px group-hover:shadow-[3px_3px_0_var(--color-carmine)]">
        {film.posterUrl ? (
          <Image
            src={film.posterUrl}
            alt={film.title}
            width={74}
            height={108}
            sizes="74px"
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/no-poster.svg"
            alt=""
            width={74}
            height={108}
            className="h-full w-full object-cover"
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {programName && (
          <div className="mb-1 flex flex-wrap gap-1.5">
            <span
              title={programName}
              className="tracking-card text-carmine border-carmine/40 max-w-[28ch] truncate border px-1.5 py-0.5 font-mono text-[10px] uppercase"
            >
              {programName}
            </span>
          </div>
        )}
        <h3 className="font-serif text-2xl leading-[1.05] tracking-[-0.01em] text-balance sm:text-3xl">
          {film.title}
        </h3>
        {film.titleOriginal &&
          film.titleOriginal.toLowerCase() !== film.title.toLowerCase() && (
            <p className="text-ink-gray mt-0.5 font-serif text-sm italic">
              «{film.titleOriginal}»
            </p>
          )}
        {film.director && (
          <p className="text-ink-gray mt-0.5 text-sm">
            {film.director}
            {film.year && ` · ${film.year}`}
            {film.runtimeMin ? ` · ${film.runtimeMin} min` : null}
          </p>
        )}

        {run.uniform ? (
          <div className="mt-3">
            <DaysLine
              label={formatWeekdaySet(run.signatures[0].weekdays)}
              range={formatRunDateRange(run.firstUtc, run.lastUtc)}
            />
            <Times times={run.signatures[0].times} />
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {run.signatures.map((sig) => (
              <SignatureLine key={sig.times.join('|')} sig={sig} />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function DaysLine({ label, range }: { label: string; range?: string }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="tracking-card text-ink font-mono text-[10px] uppercase">
        {label}
      </span>
      {range && (
        <span className="tracking-card text-ink-gray font-mono text-[10px] uppercase">
          {range}
        </span>
      )}
    </p>
  );
}

function SignatureLine({ sig }: { sig: RunSignature }) {
  return (
    <div>
      <DaysLine label={formatWeekdaySet(sig.weekdays)} />
      <Times times={sig.times} />
    </div>
  );
}

// Carmine serif-italic times. Each `·` rides AFTER its time (never leads a
// wrapped line), so the row wraps cleanly at 375px with many showtimes.
function Times({ times }: { times: string[] }) {
  return (
    <p className="text-carmine mt-1 flex flex-wrap items-baseline font-serif text-xl italic tabular-nums sm:text-2xl">
      {times.map((t, i) => (
        <span key={t} className="whitespace-nowrap">
          {t}
          {i < times.length - 1 && (
            <span aria-hidden="true" className="text-carmine/40 mx-2">
              ·
            </span>
          )}
        </span>
      ))}
    </p>
  );
}
