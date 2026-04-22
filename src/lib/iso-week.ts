/**
 * Edition number + full dateline composition for the Afiche masthead.
 *
 * The visible masthead shows abbreviated dateline ("Edición Nº 17 · Semana
 * del 23 al 30 de abril · 81 funciones · 5 salas"). Screen readers get the
 * full sentence below via an sr-only element. Both must derive from the
 * same computation so they never drift — that's this module's job.
 *
 * Edition number = ISO-8601 week of the year via date-fns. Year-resettable
 * (first week of January = Nº 1). Edge cases like Dec 31 and Jan 1 behave
 * per ISO-8601 spec — see iso-week.test.ts for documented behavior.
 */

import { getISOWeek } from 'date-fns';

export function getEditionNumber(date: Date): number {
  return getISOWeek(date);
}

export interface EditionDatelineParams {
  editionNumber: number;
  /** Already-formatted by `formatWeekRange` — e.g., "23 al 30 de abril". */
  weekRangeLabel: string;
  totalScreenings: number;
  distinctCinemas: number;
}

/**
 * Build the full editorial dateline as a single Spanish sentence for
 * screen readers. The visible masthead's abbreviated version is a subset
 * of this — both are composed from the same params, which ensures the
 * two versions can never silently fall out of sync.
 *
 * Example:
 *   "Edición número 17. Semana del 23 al 30 de abril. 81 funciones en 5 salas."
 */
export function editionFullSentence(params: EditionDatelineParams): string {
  const funciones = params.totalScreenings === 1 ? 'función' : 'funciones';
  const salas = params.distinctCinemas === 1 ? 'sala' : 'salas';
  return (
    `Edición número ${params.editionNumber}. ` +
    `Semana del ${params.weekRangeLabel}. ` +
    `${params.totalScreenings} ${funciones} en ${params.distinctCinemas} ${salas}.`
  );
}
