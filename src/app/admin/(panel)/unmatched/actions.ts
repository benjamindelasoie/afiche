'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db, films } from '@/db';
import { verifySession } from '@/lib/admin-dal';

/**
 * Hide / unhide a film from the public cartelera.
 *
 * The clutter these exist for is rows that are not films and never will be:
 * festival umbrella programs ("SMOF, festival de cine de animación", the
 * "CUADRO A CUADRO" series) and "PELÍCULA SORPRESA" mystery screenings. No
 * matcher improvement can resolve them — they need to stop occupying a card.
 *
 * Semantics (both directions symmetric, so the toggle is genuinely a toggle):
 *   hide   → hidden_at = now,  skip_tmdb = true
 *   unhide → hidden_at = null, skip_tmdb = false
 *
 * skip_tmdb rides along because a row not worth showing isn't worth spending
 * TMDB calls on, and dropping it from the unenriched report keeps that number
 * meaningful. Unhiding restores enrichment eligibility rather than leaving the
 * row silently excluded — a hidden-then-shown film should behave like any
 * other film.
 *
 * Nothing is deleted. Screenings stay, scrapes keep updating the row, and the
 * operation is reversible by construction. Visibility is enforced centrally in
 * src/db/queries.ts (fetchRows + the four queries that bypass it), so hiding
 * covers the cartelera, /sala agendas, /pelicula detail, search, the .ics
 * route, JSON-LD, and the MCP tools in one move.
 */
export async function hideFilmAction(formData: FormData): Promise<void> {
  await verifySession();
  const filmId = parsePositiveInt(formData.get('filmId'));
  if (filmId === null) return;

  await db
    .update(films)
    .set({ hiddenAt: new Date(), skipTmdb: true })
    .where(eq(films.id, filmId));

  revalidatePublicSurfaces();
}

export async function unhideFilmAction(formData: FormData): Promise<void> {
  await verifySession();
  const filmId = parsePositiveInt(formData.get('filmId'));
  if (filmId === null) return;

  await db
    .update(films)
    .set({ hiddenAt: null, skipTmdb: false })
    .where(eq(films.id, filmId));

  revalidatePublicSurfaces();
}

/**
 * A hidden film can appear on any listing surface, and its slug page needs to
 * flip to 404 (or back). Page-mode on the dynamic film route covers every
 * slug without enumerating them.
 */
function revalidatePublicSurfaces(): void {
  revalidatePath('/');
  revalidatePath('/cartelera');
  revalidatePath('/pelicula/[slug]', 'page');
  revalidatePath('/sala/[id]', 'page');
  revalidatePath('/admin/unmatched');
}

function parsePositiveInt(v: FormDataEntryValue | null): number | null {
  if (typeof v !== 'string') return null;
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}
