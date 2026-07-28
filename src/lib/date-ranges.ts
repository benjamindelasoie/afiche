/**
 * BA-timezone date range helpers for the cartelera view.
 *
 * The page splits screenings into two chronological buckets:
 *
 *   - 14-day rolling window = today 00:00 BA .. today+14 00:00 BA
 *                             (always 14 days, independent of weekday;
 *                              navigated by the date strip)
 *   - "Próximamente"        = today+14 00:00 BA .. infinity
 *                             (week-grouped text index)
 *
 * The `getNextIsoMondayBA` / `getStartOfWeekAfterNextBA` helpers below
 * predate the consolidation and are no longer used by the cartelera page;
 * they remain because `getIsoWeekStartBA` / `getIsoWeekEndBA` are still
 * used by the masthead's "Edición Nº · Semana del X al Y" tagline (which
 * is *flavor*, anchored to ISO week, decoupled from cartelera content).
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

/**
 * Canonical IANA timezone identifier for Buenos Aires. Used by every
 * BA-local Intl.DateTimeFormat call across the codebase. Imported by
 * src/db/queries.ts and src/lib/json-ld.ts; the literal string should
 * NOT appear anywhere else in the source — grep for the literal as a
 * cleanliness check.
 */
export const BA_TZ = 'America/Argentina/Buenos_Aires';

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
    timeZone: BA_TZ,
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
 * Monday-after-next at 00:00 BA. Used by the legacy 3-tier "próxima
 * semana" / "más adelante" boundary; no longer referenced by the
 * cartelera page after the 2026-05 nav refactor (consolidated to a
 * 14-day rolling window). Kept because external callers may still
 * use it; safe to delete once `git grep getStartOfWeekAfterNextBA`
 * comes up empty.
 */
export function getStartOfWeekAfterNextBA(now: Date): Date {
  return new Date(getNextIsoMondayBA(now).getTime() + 7 * 86_400_000);
}

/**
 * "Este finde" bounds (BA tz): the coming Friday 00:00 → the following
 * Monday 00:00 (exclusive). The weekend window the homepage `?ventana=finde`
 * view scopes to.
 *
 * If today is Mon–Thu, the lower bound is the COMING Friday. If today is
 * already Fri/Sat/Sun, the weekend is underway, so the lower bound clamps
 * to today's BA-midnight — a Sunday user shouldn't see the now-dead Friday
 * (eng-review correction: `finde` lower = max(todayStart, comingFri)). The
 * upper bound is always the next Monday 00:00 BA (`getNextIsoMondayBA`),
 * which lands correctly for every weekday:
 *   Mon→+7, Thu→+4, Fri→+3, Sat→+2, Sun→+1.
 */
export function getWeekendBoundsBA(now: Date): { lower: Date; upper: Date } {
  const p = baParts(now);
  const todayStart = baMidnightToUtc(p.year, p.month, p.day);
  // Mon(1)–Thu(4): coming Friday is (5 - weekday) days ahead.
  // Fri(5)–Sun(7): weekend already started — clamp lower to today.
  const lower =
    p.weekday <= 4
      ? new Date(todayStart.getTime() + (5 - p.weekday) * 86_400_000)
      : todayStart;
  return { lower, upper: getNextIsoMondayBA(now) };
}

/**
 * Grace window applied to "has this screening already started?" checks.
 * A user arriving 0–15 min after a posted start time can typically still
 * walk into a BA indie cinema; treating those screenings as expired and
 * hiding them would feel harsh. After 15 min they're gone.
 *
 * Pure instant comparison — no BA-tz math needed because both Date
 * inputs are UTC instants.
 */
export const SCREENING_GRACE_MS = 15 * 60 * 1000;

export function isScreeningExpired(startsAtUtc: Date, now: Date): boolean {
  return startsAtUtc.getTime() + SCREENING_GRACE_MS < now.getTime();
}

/**
 * 14 days from today at 00:00 BA — exclusive upper bound of the
 * 14-day rolling cartelera window (the date-strip horizon) and
 * inclusive lower bound of "Próximamente" (the awareness layer).
 *
 * Always exactly 14 days regardless of which day `now` falls on:
 * a Wednesday user sees Wed → Wed+13, a Saturday user sees Sat → Sat+13.
 * The window is "today-rolling," not "edition-bounded," because the
 * dominant cartelera intent is exploratory ("what's on next-Wednesday?")
 * and a 14-day strip always answers that with one tap. The Edición
 * label in the masthead (anchored to ISO week) is editorial flavor,
 * decoupled from this content bound — see DESIGN.md Decisions Log
 * 2026-05-02.
 */
export function getEndOfTwoWeeksBA(now: Date): Date {
  return new Date(getTodayStartBA(now).getTime() + 14 * 86_400_000);
}

/**
 * "20:15" 24h showtime label in BA local time.
 *
 * Lives here, not in `@/db/queries`, on purpose. It is a pure Intl call with
 * no database dependency, and `@/lib/edition` needs it for the footer's
 * last-scrape line. `edition.ts` is reachable from the `_components/ui`
 * barrel, which `app/error.tsx` ('use client') imports — so any module
 * `edition.ts` touches gets pulled into the *client* bundle. Importing it
 * from `@/db/queries` dragged `@/db/client` into the browser, where the
 * missing DATABASE_URL threw at module evaluation and took the whole site
 * down behind the global error boundary. Keep pure formatters out of the
 * DB module graph.
 */
export function formatTimeBA(d: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: BA_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}
