import Link from 'next/link';
import { NotFoundShell, Caps } from '@/app/_components/ui';

/**
 * Root 404 — any URL that doesn't match a route.
 *
 * Until 1.0 this file didn't exist, so a mistyped or stale URL fell through to
 * Next's built-in page: "This page could not be found", in English, on an
 * es-AR site that already had an editorial 404 on /sala and /pelicula. This
 * closes the last surface still showing framework default chrome.
 *
 * Copy is deliberately broader than the two route-local 404s: at this level we
 * don't know what the visitor was after, only that the address doesn't exist.
 * Same grammar as its siblings — serif-italic recovery line, no error chrome —
 * plus a small recovery map. That map is also the machine-readable escape
 * hatch: an agent that hit a dead path (and reads the raw HTML) gets links to
 * the cartelera, the about page, the sitemap, and llms.txt instead of a wall.
 * (Agents that send `Accept: text/markdown` get an equivalent markdown 404 body
 * from the negotiation route — see src/app/api/md/route.ts.)
 */

// Recovery targets. `/cartelera` + `/acerca` are app pages (client-routed via
// <Link>); `/sitemap.xml` + `/llms.txt` are non-page machine files, so they use
// a plain <a> to avoid the router trying to resolve them as routes.
const RECOVERY = [
  { href: '/cartelera', label: 'Cartelera completa', page: true },
  { href: '/acerca', label: 'Sobre afiche', page: true },
  { href: '/sitemap.xml', label: 'Mapa del sitio', page: false },
  { href: '/llms.txt', label: 'Guía para agentes', page: false },
];

export default function NotFound() {
  return (
    <NotFoundShell
      title="Esta página no existe."
      links={
        <nav aria-label="Dónde seguir" className="pt-2">
          <ul className="flex flex-wrap justify-center gap-x-5 gap-y-2">
            {RECOVERY.map((r) => (
              <li key={r.href}>
                {r.page ? (
                  <Caps
                    as={Link}
                    href={r.href}
                    className="text-ink-gray hover:text-carmine border-b border-black/10"
                  >
                    {r.label}
                  </Caps>
                ) : (
                  <Caps
                    as="a"
                    href={r.href}
                    className="text-ink-gray hover:text-carmine border-b border-black/10"
                  >
                    {r.label}
                  </Caps>
                )}
              </li>
            ))}
          </ul>
        </nav>
      }
    >
      Puede que el link esté viejo o mal escrito. Volvé a la cartelera para ver qué se
      está dando.
    </NotFoundShell>
  );
}
