/**
 * BA-timezone date range helpers for the three-tier cartelera view.
 *
 * The page splits screenings into three chronological buckets:
 *
 *   - "Esta semana"   = today 00:00 BA .. next ISO Monday 00:00 BA
 *                       (1-7 days, depending on which day of the week now is)
 *   - "Próxima semana" = next ISO Monday 00:00 BA .. Monday-after-next 00:00 BA
 *                       (always 7 days)
 *   - "Más adelante"   = Monday-after-next 00:00 BA .. infinity
 *
 * All bounds are computed against Buenos Aires local time. Argentina does not
 * observe daylight saving, so BA is fixed at UTC-3 year-round — this lets us
 * compute BA-local midnight as `Date.UTC(y, m-1, d, 3)` without consulting a
 * full tz database.
 *
 * "Today" uses BA local clock, so a user on Sunday at 23:00 BA still sees
 * Sunday's screenings (even the ones that already happened at 18:00). That
 * matches the product call: the cartelera anchors you in *today*, not in
 * *right now*.
 */

// BA is UTC-3 year-round. When the BA wall clock says 00:00, UTC says 03:00.
const BA_OFFSET_HOURS = 3;

interface BAParts {
  year: number;
  month: number; // 1-indexed (January = 1)
  day: number;
  /** ISO-8601 day of week: Monday = 1, Sunday = 7. */
  weekday: number;
}

/**
 * Decompose a UTC instant into BA-local calendar parts. Uses Intl instead of
 * hardcoded offset arithmetic so the weekday string is the authoritative
 * source — less error-prone than hand-rolling modular arithmetic.
 */
function baParts(instant: Date): BAParts {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = fmt.formatToParts(instant);
  const year = parseInt(parts.find((p) => p.type === 'year')!.value, 10);
  const month = parseInt(parts.find((p) => p.type === 'month')!.value, 10);
  const day = parseInt(parts.find((p) => p.type === 'day')!.value, 10);
  const weekdayStr = parts.find((p) => p.type === 'weekday')!.value;
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return { year, month, day, weekday: weekdayMap[weekdayStr] };
}

/**
 * Build the UTC instant for BA-local midnight on a given (year, month, day).
 * Argentina's fixed -03:00 offset makes this a straight shift: BA 00:00 =
 * UTC 03:00 same calendar day.
 */
function baMidnightToUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, BA_OFFSET_HOURS));
}

/**
 * Today at 00:00 BA, as a UTC Date. Used as the inclusive lower bound of
 * the "this week" query — screenings earlier today that already started
 * still show up, so Sunday-evening users see Sunday's programming.
 */
export function getTodayStartBA(now: Date): Date {
  const p = baParts(now);
  return baMidnightToUtc(p.year, p.month, p.day);
}

/**
 * The next Monday at 00:00 BA — exclusive upper bound of the "this week"
 * query, and the lower bound of "this month". If today is a Monday, this
 * returns a week from now (not today), because today belongs to *this*
 * ISO week, not the next one.
 */
export function getNextIsoMondayBA(now: Date): Date {
  const p = baParts(now);
  // If today is Monday (weekday=1), next Monday is 7 days away.
  // Otherwise it's (8 - weekday) days away: Tue→6, Wed→5, ..., Sun→1.
  const daysUntilNextMonday = p.weekday === 1 ? 7 : 8 - p.weekday;
  const todayStart = baMidnightToUtc(p.year, p.month, p.day);
  return new Date(todayStart.getTime() + daysUntilNextMonday * 86_400_000);
}

/**
 * Monday 00:00 BA of the ISO week `now` belongs to. Used for the masthead
 * dateline ("Semana del 20 al 26 de abril") which reflects the *edition*
 * week bounds regardless of which day the user opens Afiche.
 */
export function getIsoWeekStartBA(now: Date): Date {
  const p = baParts(now);
  // Monday → 0 days back, Tuesday → 1 day back, ..., Sunday → 6 days back.
  const daysBackToMonday = p.weekday - 1;
  const todayStart = baMidnightToUtc(p.year, p.month, p.day);
  return new Date(todayStart.getTime() - daysBackToMonday * 86_400_000);
}

/**
 * Sunday 23:59:59 BA of the ISO week `now` belongs to — the visible end
 * date of the current edition for the masthead label. Paired with
 * getIsoWeekStartBA to format "Semana del X al Y".
 *
 * (Returns the last *instant* of Sunday in BA, not a date-only value,
 * so formatters treat it as "Sunday" rather than rolling over to Monday.)
 */
export function getIsoWeekEndBA(now: Date): Date {
  const monday = getIsoWeekStartBA(now);
  // +7 days = next Monday 00:00 BA; minus 1ms = Sunday 23:59:59.999 BA.
  return new Date(monday.getTime() + 7 * 86_400_000 - 1);
}

/**
 * Monday-after-next at 00:00 BA — exclusive upper bound of "próxima
 * semana" (Tier 2) and inclusive lower bound of "más adelante"
 * (Tier 3). Always exactly 7 days after `getNextIsoMondayBA(now)`,
 * regardless of which day of the week `now` falls on.
 *
 * This replaces the prior calendar-month-anchored Tier 2/3 boundary
 * (getNextMonthStartBA), which created an end-of-month edge case
 * where a screening one day in the future could land in Tier 3
 * "Próximamente" instead of Tier 2 — counterintuitive for users
 * (April 30 → May 1 screening shouldn't read as "más adelante").
 */
export function getStartOfWeekAfterNextBA(now: Date): Date {
  return new Date(getNextIsoMondayBA(now).getTime() + 7 * 86_400_000);
}
