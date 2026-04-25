/**
 * Edition number + full dateline composition for the Afiche masthead.
 *
 * The visible masthead shows abbreviated dateline ("Edición Nº 1 · Semana
 * del 27 abr al 3 may"). Screen readers get the full sentence via an
 * sr-only element. Both derive from the same computation so they never
 * drift — that's this module's job.
 *
 * Edition number is a launch-anchored counter, NOT the ISO week of the
 * year. Edition Nº 1 = the week of Monday 2026-04-27 (Afiche's launch
 * week). Nº 2 = the week starting 2026-05-04, and so on. Pre-launch
 * weeks (the cartelera was visible while Afiche was still in dev) clamp
 * to Nº 1 so the masthead doesn't display 0 or negatives.
 */

/**
 * Launch anchor: Monday 2026-04-27 at 00:00 BA local = 2026-04-27 03:00 UTC.
 * This is the Date that getIsoWeekStartBA returns for any date in the
 * week of 2026-04-27, so subtracting it from `weekStart` gives a clean
 * multiple of 7 * 86_400_000 ms (no DST in BA).
 */
const EDITION_EPOCH = new Date(Date.UTC(2026, 3, 27, 3, 0, 0));
const WEEK_MS = 7 * 86_400_000;

/**
 * Edition number for the week containing `weekStart`. Pass the result of
 * `getIsoWeekStartBA(now)` so this routine doesn't have to repeat the
 * Monday-anchor computation. Pre-launch dates clamp to Nº 1.
 */
export function getEditionNumber(weekStart: Date): number {
  const offsetWeeks = Math.round(
    (weekStart.getTime() - EDITION_EPOCH.getTime()) / WEEK_MS,
  );
  return Math.max(1, offsetWeeks + 1);
}

export interface EditionDatelineParams {
  editionNumber: number;
  /** Already-formatted by `formatWeekRange` — e.g., "23 al 30 de abril". */
  weekRangeLabel: string;
  totalScreenings: number;
  distinctCinemas: number;
  /**
   * When true, the range fits in a calendar week and the sentence uses
   * "Semana del …". When false (e.g. a Lugones 30-day cycle dragging the
   * range out), we drop the weekly framing: "Próximas funciones del X al Y."
   * Labelling a 34-day span "Semana" is the kind of small dishonesty a
   * careful editorial voice doesn't allow.
   */
  isWeekSpan: boolean;
}

/**
 * Build the full editorial dateline as a single Spanish sentence for
 * screen readers. The visible masthead's abbreviated version is a subset
 * of this — both are composed from the same params, which ensures the
 * two versions can never silently fall out of sync.
 *
 * Example (week span):
 *   "Edición número 17. Semana del 23 al 30 de abril. 81 funciones en 5 salas."
 * Example (wider span):
 *   "Edición número 17. Próximas funciones del 23 de abril al 27 de mayo. 81 funciones en 5 salas."
 */
export function editionFullSentence(params: EditionDatelineParams): string {
  const funciones = params.totalScreenings === 1 ? 'función' : 'funciones';
  const salas = params.distinctCinemas === 1 ? 'sala' : 'salas';
  const rangeSentence = params.isWeekSpan
    ? `Semana del ${params.weekRangeLabel}.`
    : `Próximas funciones del ${params.weekRangeLabel}.`;
  return (
    `Edición número ${params.editionNumber}. ` +
    `${rangeSentence} ` +
    `${params.totalScreenings} ${funciones} en ${params.distinctCinemas} ${salas}.`
  );
}
