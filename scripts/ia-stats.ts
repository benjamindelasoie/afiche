/**
 * READ-ONLY cartelera shape analytics. Decision-support for design/IA work.
 *
 * Answers, over 7-day / 14-day / all-upcoming windows: how many films screen at
 * >1 venue / >1 time, venues-per-film and showtimes-per-film distributions,
 * within-day repetition, and ÚNICA-FUNCIÓN tag coverage. Pure SELECTs — no writes.
 *
 * Run:
 *   npm run db:ia-stats         # local DB (.env.local)
 *   npm run db:ia-stats:prod    # prod DB (.env.prod)
 *
 * First measured 2026-06-06 to ground the homepage redesign (group-by-film);
 * keep it around and re-run whenever a design question turns on the real data
 * shape (e.g. after onboarding a venue that changes the multiplicity mix).
 */
import { createClient } from '@libsql/client';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL not set');
const authToken = process.env.DATABASE_AUTH_TOKEN;
const client = createClient({ url, authToken });

const host = url.replace(/^[a-z]+:\/\//, '').split(/[/?]/)[0];
console.log(`DB: ${host}\n`);

const nowSec = Math.floor(Date.now() / 1000);
const DAY = 86400;

function baDay(sec: number): string {
  // America/Argentina/Buenos_Aires = UTC-3, no DST.
  const d = new Date((sec - 3 * 3600) * 1000);
  return d.toISOString().slice(0, 10);
}
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function pct(n: number, d: number): string {
  return d ? `${((100 * n) / d).toFixed(1)}%` : '—';
}

async function windowReport(label: string, lo: number, hi: number) {
  const rs = await client.execute({
    sql: `SELECT film_id, cinema_id, starts_at_utc, tags
          FROM screenings
          WHERE starts_at_utc >= ? AND starts_at_utc < ?`,
    args: [lo, hi],
  });
  const rows = rs.rows as unknown as {
    film_id: number;
    cinema_id: string;
    starts_at_utc: number;
    tags: string;
  }[];

  const totalScreenings = rows.length;
  const films = new Map<number, { venues: Set<string>; showtimes: number; days: Set<string> }>();
  const venuesAll = new Set<string>();
  const fcDay = new Map<string, number>(); // film|cinema|day -> showtimes that day
  let uniqueTagged = 0;

  for (const r of rows) {
    venuesAll.add(r.cinema_id);
    let f = films.get(r.film_id);
    if (!f) { f = { venues: new Set(), showtimes: 0, days: new Set() }; films.set(r.film_id, f); }
    const day = baDay(r.starts_at_utc);
    f.venues.add(r.cinema_id);
    f.showtimes += 1;
    f.days.add(day);
    const k = `${r.film_id}|${r.cinema_id}|${day}`;
    fcDay.set(k, (fcDay.get(k) ?? 0) + 1);
    if (typeof r.tags === 'string' && r.tags.includes('unique')) uniqueTagged += 1;
  }

  const F = films.size;
  const showtimeCounts = [...films.values()].map((f) => f.showtimes);
  const venueCounts = [...films.values()].map((f) => f.venues.size);

  const films1Venue = venueCounts.filter((v) => v === 1).length;
  const filmsMultiVenue = F - films1Venue;
  const films1Showtime = showtimeCounts.filter((s) => s === 1).length;
  const filmsMultiShowtime = F - films1Showtime;

  // venue histogram
  const venueHist = new Map<number, number>();
  for (const v of venueCounts) venueHist.set(v, (venueHist.get(v) ?? 0) + 1);
  // showtime buckets
  const buckets: Record<string, number> = { '1': 0, '2-3': 0, '4-6': 0, '7-10': 0, '11+': 0 };
  for (const s of showtimeCounts) {
    if (s === 1) buckets['1']++;
    else if (s <= 3) buckets['2-3']++;
    else if (s <= 6) buckets['4-6']++;
    else if (s <= 10) buckets['7-10']++;
    else buckets['11+']++;
  }
  // within-day repetition
  const fcDayVals = [...fcDay.values()];
  const fcDaySingle = fcDayVals.filter((n) => n === 1).length;
  const fcDayMulti = fcDayVals.length - fcDaySingle;

  console.log(`════════ ${label} ════════`);
  console.log(`window: ${new Date(lo * 1000).toISOString().slice(0, 16)}Z → ${new Date(hi * 1000).toISOString().slice(0, 16)}Z`);
  console.log(`screenings: ${totalScreenings}   distinct films: ${F}   distinct venues with content: ${venuesAll.size}`);
  console.log('');
  console.log(`Films at a SINGLE venue:   ${films1Venue}/${F}  (${pct(films1Venue, F)})`);
  console.log(`Films at 2+ venues:        ${filmsMultiVenue}/${F}  (${pct(filmsMultiVenue, F)})`);
  console.log(`Films with a SINGLE showtime (1 function all week): ${films1Showtime}/${F}  (${pct(films1Showtime, F)})`);
  console.log(`Films with 2+ showtimes:   ${filmsMultiShowtime}/${F}  (${pct(filmsMultiShowtime, F)})`);
  console.log(`avg showtimes/film: ${(showtimeCounts.reduce((a, b) => a + b, 0) / (F || 1)).toFixed(2)}   median: ${median(showtimeCounts)}   max: ${Math.max(0, ...showtimeCounts)}`);
  console.log(`avg venues/film:    ${(venueCounts.reduce((a, b) => a + b, 0) / (F || 1)).toFixed(2)}   median: ${median(venueCounts)}   max: ${Math.max(0, ...venueCounts)}`);
  console.log('');
  console.log('venues-per-film histogram:');
  [...venueHist.entries()].sort((a, b) => a[0] - b[0]).forEach(([v, n]) => console.log(`   ${v} venue${v > 1 ? 's' : ' '}: ${n} films  (${pct(n, F)})`));
  console.log('showtimes-per-film buckets:');
  Object.entries(buckets).forEach(([b, n]) => console.log(`   ${b.padStart(4)} showtimes: ${n} films  (${pct(n, F)})`));
  console.log('');
  console.log(`(film,venue,day) cells: ${fcDayVals.length}`);
  console.log(`   same film+venue plays ONCE that day:  ${fcDaySingle}  (${pct(fcDaySingle, fcDayVals.length)})`);
  console.log(`   same film+venue plays 2+ times a day: ${fcDayMulti}  (${pct(fcDayMulti, fcDayVals.length)})  ← variant-D within-day dedup payoff`);
  console.log(`screenings tagged ÚNICA FUNCIÓN ('unique'): ${uniqueTagged}  (${pct(uniqueTagged, totalScreenings)} of screenings)`);
  console.log('');
}

(async () => {
  const startToday = Math.floor((nowSec - ((nowSec - 3 * 3600) % DAY)) ); // today 00:00 BA in UTC secs
  await windowReport('NEXT 7 DAYS', nowSec, nowSec + 7 * DAY);
  await windowReport('NEXT 14 DAYS (homepage Tier-1 window)', startToday, startToday + 14 * DAY);
  await windowReport('ALL UPCOMING (now → ∞)', nowSec, nowSec + 365 * DAY);
  process.exit(0);
})();
