import Link from 'next/link';
import type { EditionInfo } from '@/lib/edition';

// ---------------------------------------------------------------------------
// Masthead — the shared editorial header for `/` and `/cartelera`.
//
// Mobile = stacked (wordmark, dateline, tagline). Desktop = wordmark hard-left
// + edition/dateline/tagline right-aligned on the baseline, hairline rule
// under. The dateline ("Edición Nº N · Semana del X al Y") is anchored to the
// ISO week — editorial flavor, decoupled from the content below.
//
// On `/` the wordmark is the page `<h1>`. On `/cartelera` it's a link home
// (`wordmarkHref="/"`), so the secondary view carries a back-to-main
// affordance while reading as the same product.
//
// The wordmark is the lowercase logotype `afiche` — deliberate (quiet,
// editorial, leans into "afiche" being a common noun; see DESIGN.md). The
// NAME stays "Afiche" everywhere it's prose, not logo: the `aria-label`
// below, the metadata `title` / og:title, and the JSON-LD. Don't "fix" the
// casing of the visible wordmark.
// ---------------------------------------------------------------------------

const WORDMARK_CLASS = 'font-serif leading-[0.85] tracking-[-0.02em]';
const WORDMARK_STYLE = {
  fontSize: 'clamp(3.5rem, 11vw, 6.75rem)',
  fontKerning: 'normal',
  fontFeatureSettings: '"liga", "kern"',
} as const;

export function Masthead({
  edition,
  funcionesTotal,
  salasTotal,
  wordmarkHref,
}: {
  edition: EditionInfo;
  funcionesTotal: number;
  salasTotal: number;
  /** When set, the wordmark links here (e.g. "/" on /cartelera); else it's the page <h1>. */
  wordmarkHref?: string;
}) {
  return (
    <header className="border-b border-black pt-8 pb-4 md:flex md:items-end md:justify-between md:pt-12">
      {wordmarkHref ? (
        <Link
          href={wordmarkHref}
          aria-label="Afiche — inicio"
          className={WORDMARK_CLASS}
          style={WORDMARK_STYLE}
        >
          afiche
        </Link>
      ) : (
        <h1 className={WORDMARK_CLASS} style={WORDMARK_STYLE}>
          afiche
        </h1>
      )}
      <div className="mt-3 md:mt-0 md:pb-2 md:text-right">
        <p className="text-ink-gray font-mono text-[9.5px] leading-[1.7] tracking-[0.18em] uppercase md:text-[10.5px]">
          Edición Nº {edition.editionNumber} · Semana del {edition.weekRangeLabel}
          <span className="md:hidden"> · </span>
          <br className="hidden md:inline" />
          {funcionesTotal} funciones · {salasTotal} salas
        </p>
        <p className="text-ink-gray mt-1.5 font-serif text-[17px] italic md:text-xl">
          Cartelera curada de Buenos Aires
        </p>
      </div>
      <p className="sr-only">{edition.fullSentence}</p>
    </header>
  );
}
