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
  const films = new Map<
    number,
    { venues: Set<string>; showtimes: number; days: Set<string> }
  >();
  const venuesAll = new Set<string>();
  const fcDay = new Map<string, number>(); // film|cinema|day -> showtimes that day
  let uniqueTagged = 0;

  for (const r of rows) {
    venuesAll.add(r.cinema_id);
    let f = films.get(r.film_id);
    if (!f) {
      f = { venues: new Set(), showtimes: 0, days: new Set() };
      films.set(r.film_id, f);
    }
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
  const buckets: Record<string, number> = {
    '1': 0,
    '2-3': 0,
    '4-6': 0,
    '7-10': 0,
    '11+': 0,
  };
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
  console.log(
    `window: ${new Date(lo * 1000).toISOString().slice(0, 16)}Z → ${new Date(hi * 1000).toISOString().slice(0, 16)}Z`,
  );
  console.log(
    `screenings: ${totalScreenings}   distinct films: ${F}   distinct venues with content: ${venuesAll.size}`,
  );
  console.log('');
  console.log(`Films at a SINGLE venue:   ${films1Venue}/${F}  (${pct(films1Venue, F)})`);
  console.log(
    `Films at 2+ venues:        ${filmsMultiVenue}/${F}  (${pct(filmsMultiVenue, F)})`,
  );
  console.log(
    `Films with a SINGLE showtime (1 function all week): ${films1Showtime}/${F}  (${pct(films1Showtime, F)})`,
  );
  console.log(
    `Films with 2+ showtimes:   ${filmsMultiShowtime}/${F}  (${pct(filmsMultiShowtime, F)})`,
  );
  console.log(
    `avg showtimes/film: ${(showtimeCounts.reduce((a, b) => a + b, 0) / (F || 1)).toFixed(2)}   median: ${median(showtimeCounts)}   max: ${Math.max(0, ...showtimeCounts)}`,
  );
  console.log(
    `avg venues/film:    ${(venueCounts.reduce((a, b) => a + b, 0) / (F || 1)).toFixed(2)}   median: ${median(venueCounts)}   max: ${Math.max(0, ...venueCounts)}`,
  );
  console.log('');
  console.log('venues-per-film histogram:');
  [...venueHist.entries()]
    .sort((a, b) => a[0] - b[0])
    .forEach(([v, n]) =>
      console.log(`   ${v} venue${v > 1 ? 's' : ' '}: ${n} films  (${pct(n, F)})`),
    );
  console.log('showtimes-per-film buckets:');
  Object.entries(buckets).forEach(([b, n]) =>
    console.log(`   ${b.padStart(4)} showtimes: ${n} films  (${pct(n, F)})`),
  );
  console.log('');
  console.log(`(film,venue,day) cells: ${fcDayVals.length}`);
  console.log(
    `   same film+venue plays ONCE that day:  ${fcDaySingle}  (${pct(fcDaySingle, fcDayVals.length)})`,
  );
  console.log(
    `   same film+venue plays 2+ times a day: ${fcDayMulti}  (${pct(fcDayMulti, fcDayVals.length)})  ← variant-D within-day dedup payoff`,
  );
  console.log(
    `screenings tagged ÚNICA FUNCIÓN ('unique'): ${uniqueTagged}  (${pct(uniqueTagged, totalScreenings)} of screenings)`,
  );
  console.log('');
}

// ---------------------------------------------------------------------------
// PER-VENUE cut (TODO #34b). The /sala/<id> agenda is per-showtime within each
// day, so a film that runs daily for two weeks becomes a wall of repeated rows
// — the exact scroll-wall the homepage group-by-film redesign killed. Whether
// that actually bites depends on per-venue multiplicity we hadn't measured.
// This answers, per venue, over the agenda's 14-day window: distinct films vs
// screenings (the redundancy ratio), the worst single-film repeat (rows AND
// distinct days — days≈14 means "plays daily all fortnight"), and how many
// films run on 3+ days. High ratio / high maxDays ⇒ a film-first toggle earns
// its keep; low everywhere ⇒ leave the chronological agenda as-is and close #34b.
// ---------------------------------------------------------------------------
async function perVenueReport(label: string, lo: number, hi: number) {
  const rs = await client.execute({
    sql: `SELECT s.film_id, s.cinema_id, s.starts_at_utc,
                 c.name AS cinema_name, f.title AS film_title
          FROM screenings s
          JOIN cinemas c ON c.id = s.cinema_id
          JOIN films f ON f.id = s.film_id
          WHERE s.starts_at_utc >= ? AND s.starts_at_utc < ?`,
    args: [lo, hi],
  });
  const rows = rs.rows as unknown as {
    film_id: number;
    cinema_id: string;
    starts_at_utc: number;
    cinema_name: string;
    film_title: string;
  }[];

  type FilmStat = { title: string; showtimes: number; days: Set<string> };
  type VenueStat = { name: string; screenings: number; films: Map<number, FilmStat> };
  const venues = new Map<string, VenueStat>();

  for (const r of rows) {
    let v = venues.get(r.cinema_id);
    if (!v) {
      v = { name: r.cinema_name, screenings: 0, films: new Map() };
      venues.set(r.cinema_id, v);
    }
    v.screenings += 1;
    let f = v.films.get(r.film_id);
    if (!f) {
      f = { title: r.film_title, showtimes: 0, days: new Set() };
      v.films.set(r.film_id, f);
    }
    f.showtimes += 1;
    f.days.add(baDay(r.starts_at_utc));
  }

  console.log(`════════ PER-VENUE — ${label} ════════`);
  console.log(
    `window: ${new Date(lo * 1000).toISOString().slice(0, 16)}Z → ${new Date(hi * 1000).toISOString().slice(0, 16)}Z\n`,
  );
  console.log(
    `${'venue'.padEnd(22)} ${'scr'.padStart(4)} ${'films'.padStart(5)} ${'ratio'.padStart(5)} ${'maxRows'.padStart(7)} ${'maxDays'.padStart(7)} ${'≥3days'.padStart(6)}   worst-repeated film`,
  );
  const summary = [...venues.entries()].map(([id, v]) => {
    const fs = [...v.films.values()];
    const ratio = v.screenings / (fs.length || 1);
    const worst = fs.reduce((a, b) => (b.showtimes > a.showtimes ? b : a), fs[0]);
    const maxDays = Math.max(0, ...fs.map((f) => f.days.size));
    const films3plus = fs.filter((f) => f.days.size >= 3).length;
    return {
      id,
      name: v.name,
      screenings: v.screenings,
      films: fs.length,
      ratio,
      worstRows: worst.showtimes,
      worstTitle: worst.title,
      maxDays,
      films3plus,
    };
  });
  // sort by redundancy ratio descending — the venues most likely to bite first.
  summary.sort((a, b) => b.ratio - a.ratio);
  for (const s of summary) {
    console.log(
      `${s.id.padEnd(22)} ${String(s.screenings).padStart(4)} ${String(s.films).padStart(5)} ${s.ratio.toFixed(2).padStart(5)} ${String(s.worstRows).padStart(7)} ${String(s.maxDays).padStart(7)} ${String(s.films3plus).padStart(6)}   ${s.worstTitle} (${s.worstRows}× / ${summary.find((x) => x.id === s.id)!.maxDays}d)`,
    );
  }
  console.log('');
  console.log(
    'legend: ratio = screenings/distinct-films (1.0 = zero repeats; high = scroll-wall risk).',
  );
  console.log(
    '        maxRows/maxDays = the single most-repeated film at that venue (rows in the agenda / distinct days it runs).',
  );
  console.log(
    '        ≥3days = films that screen on 3+ distinct days (the "daily run" pattern group-by-film would collapse).',
  );
  console.log('');
}

(async () => {
  const startToday = Math.floor(nowSec - ((nowSec - 3 * 3600) % DAY)); // today 00:00 BA in UTC secs
  await windowReport('NEXT 7 DAYS', nowSec, nowSec + 7 * DAY);
  await windowReport(
    'NEXT 14 DAYS (homepage Tier-1 window)',
    startToday,
    startToday + 14 * DAY,
  );
  await windowReport('ALL UPCOMING (now → ∞)', nowSec, nowSec + 365 * DAY);
  await perVenueReport(
    'NEXT 14 DAYS (the /sala agenda window)',
    startToday,
    startToday + 14 * DAY,
  );
  process.exit(0);
})();
