import { Caps, focusRing } from './ui';
import { cn } from '@/lib/cn';
import { buildFilmLinks } from './film-links-model';

// FilmLinks — outbound links to the film's page on the aggregators, in the
// same tracked micro-caps register as the genre eyebrow directly above it on
// /pelicula.
//
// Links only, no scores. The session that designed this measured all three
// candidate sources and then cut every figure: TMDB's stored vote_average has
// a median sample of six votes across the live catalog and must never read as
// a quality signal, IMDb's only free source is a 30 MB dump to maintain ~70
// numbers, and caching Letterboxd's figure would mean automated access their
// terms prohibit. A link performs no automated access at all and is exactly as
// correct as the poster and title already on the page, since all three come
// from the same match. See docs/designs/review-aggregator-ratings.md.
//
// URL construction and the empty case live in film-links-model.ts, where they
// are unit-tested (vitest runs node-only and collects *.test.ts, so the pure
// part of a component is tested separately — same split as FilmRow.tsx and
// film-row-model.ts).

interface FilmLinksProps {
  title: string;
  tmdbId: number | null;
  imdbId: string | null;
  className?: string;
}

export function FilmLinks({ title, tmdbId, imdbId, className }: FilmLinksProps) {
  const links = buildFilmLinks(title, tmdbId, imdbId);
  if (links.length === 0) return null;

  return (
    <p
      className={cn('text-ink-gray mt-2 flex flex-wrap items-center gap-x-3', className)}
    >
      {links.map((link, i) => (
        <span key={link.label} className="contents">
          {i > 0 && (
            <Caps aria-hidden="true" className="text-ink-gray/50">
              ·
            </Caps>
          )}
          <Caps
            as="a"
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={link.ariaLabel}
            className={cn('hover:text-carmine transition-colors', focusRing)}
          >
            {link.label} <span aria-hidden="true">↗</span>
          </Caps>
        </span>
      ))}
    </p>
  );
}
