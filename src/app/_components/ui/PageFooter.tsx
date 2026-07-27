import Link from 'next/link';
import { formatLastScrape } from '@/lib/edition';
import { cn } from '@/lib/cn';
import { Caps } from './Caps';
import { focusRing } from './recipes';

// PageFooter — the editorial freshness stamp + a quiet "sobre afiche" link,
// shared by / and /cartelera. The double-rule (border-t-8 border-double) is
// chrome, so it spans the PageShell width, not the (possibly narrower) content
// column. The "sobre afiche" link is the site's only entry point to /acerca
// (the about page, which also houses the read-only MCP endpoint) — deliberately
// a plain about link, no signal of what's inside. The freshness stamp is
// null-guarded (nothing until the first successful scrape); the about link is
// independent of freshness and always renders.
export function PageFooter({ lastScrape }: { lastScrape: Date | null }) {
  return (
    <footer className="mt-20 border-t-8 border-double border-black pt-8 text-center">
      {lastScrape ? (
        <Caps as="p" className="text-ink-gray">
          Actualizado el {formatLastScrape(lastScrape)}
        </Caps>
      ) : null}
      <Caps
        as={Link}
        href="/acerca"
        className={cn(
          'text-ink-gray hover:text-carmine inline-block transition-colors',
          focusRing,
          lastScrape ? 'mt-2' : '',
        )}
      >
        sobre afiche
      </Caps>
    </footer>
  );
}
