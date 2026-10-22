import { focusRing } from './ui';
import { cn } from '@/lib/cn';
import { buildFilmLinks, type FilmLinkTarget } from './film-links-model';

// FilmLinks — outbound marks linking to the film's page on the aggregators, at
// the foot of the /pelicula header.
//
// Marks, not words. An earlier pass set these as tracked micro-caps labels
// ("LETTERBOXD ↗ · IMDB ↗") directly under the genre eyebrow, which is the same
// ink-gray micro-caps register — two adjacent rows in one treatment read as a
// single repeated label strip and the header looked cluttered. A serif-italic
// "Ver en …" line fixed the echo but was still a row of words for what is meant
// to be a quiet detail.
//
// Monotone, in currentColor, so they inherit ink-gray and flip to carmine on
// hover and focus like every other interactive element on the page. Rendering
// the brands' real colours was rejected: IMDb's #F5C518 and Letterboxd's
// orange/green/blue would be the only saturated hues on a deliberately 4-hue
// page (DESIGN.md: "Restrained. 4 hues, 0 gradients") and they out-shout the
// film title.
//
// The Letterboxd dots need the compounding opacity below. Its mark carries its
// identity in three colours; flattened to one solid tone the circles merge into
// an undifferentiated blob that reads as a bullet ornament. Drawing them at
// partial opacity so the overlaps darken rebuilds the multiply behaviour of the
// real mark, which is what makes it legible as three dots in a single hue.

const MARK_HEIGHT = 'h-4 w-auto';

/**
 * Letterboxd: three overlapping dots. `fillOpacity` below 1 is load-bearing,
 * not decoration — see the note above.
 */
function LetterboxdMark() {
  return (
    <svg
      viewBox="0 0 460 180"
      className={MARK_HEIGHT}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="90" cy="90" r="90" fill="currentColor" fillOpacity="0.55" />
      <circle cx="230" cy="90" r="90" fill="currentColor" fillOpacity="0.55" />
      <circle cx="370" cy="90" r="90" fill="currentColor" fillOpacity="0.55" />
    </svg>
  );
}

/**
 * IMDb: the wordmark in a rounded rectangle. Drawn as an outline rather than a
 * solid fill — a filled box is the heaviest element in the header at this size,
 * heavier than the title's stroke, and hairline containers are already the
 * system's idiom (see Pill's `ghost` variant).
 */
function ImdbMark() {
  return (
    <svg viewBox="0 0 64 32" className={MARK_HEIGHT} aria-hidden="true" focusable="false">
      <rect
        x="1.2"
        y="1.2"
        width="61.6"
        height="29.6"
        rx="5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
      />
      <text
        x="32"
        y="23.5"
        textAnchor="middle"
        fill="currentColor"
        fontSize="18"
        fontWeight="800"
        fontFamily="Helvetica Neue, Helvetica, Arial, sans-serif"
      >
        IMDb
      </text>
    </svg>
  );
}

function Mark({ source }: { source: FilmLinkTarget['source'] }) {
  return source === 'letterboxd' ? <LetterboxdMark /> : <ImdbMark />;
}

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
    // `items-center` rather than baseline: the two marks have different visual
    // centres (dots are round, the IMDb box is rectangular) and baseline
    // alignment leaves them visibly off from each other.
    <p
      className={cn('text-ink-gray mt-3 flex flex-wrap items-center gap-x-4', className)}
    >
      {links.map((link) => (
        <a
          key={link.source}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          // The mark is aria-hidden, so this label is the link's entire
          // accessible name. Without it the link announces as its bare URL.
          aria-label={link.ariaLabel}
          className={cn(
            'hover:text-carmine inline-flex items-center transition-colors',
            focusRing,
          )}
        >
          <Mark source={link.source} />
        </a>
      ))}
    </p>
  );
}
