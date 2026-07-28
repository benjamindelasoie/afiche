import { NotFoundShell } from '@/app/_components/ui';

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
 * Same grammar as its siblings — serif-italic recovery line, no error chrome,
 * one clear path back to the cartelera.
 */
export default function NotFound() {
  return (
    <NotFoundShell title="Esta página no existe.">
      Puede que el link esté viejo o mal escrito. Volvé a la cartelera para ver qué se
      está dando.
    </NotFoundShell>
  );
}
