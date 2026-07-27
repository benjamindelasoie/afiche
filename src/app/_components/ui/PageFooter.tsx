import { formatLastScrape } from '@/lib/edition';
import { Caps } from './Caps';

// PageFooter — the editorial freshness stamp shared by / and /cartelera.
// Owns the null-guard: renders nothing until there's a successful scrape, so
// callers just drop `<PageFooter lastScrape={lastScrape} />` with no wrapping
// conditional. The double-rule (border-t-8 border-double) is chrome, so it
// spans the PageShell width, not the (possibly narrower) content column.
export function PageFooter({ lastScrape }: { lastScrape: Date | null }) {
  if (!lastScrape) return null;
  return (
    <footer className="mt-20 border-t-8 border-double border-black pt-8 text-center">
      <Caps as="p" className="text-ink-gray">
        Actualizado el {formatLastScrape(lastScrape)}
      </Caps>
    </footer>
  );
}
