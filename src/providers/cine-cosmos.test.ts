/**
 * Tests for the Cine Cosmos provider.
 *
 * Fixtures captured 2026-04-25 from cinecosmos.uba.ar:
 *   - listing.html                          7 cards (full week's cartelera)
 *   - detalle-stop-making-sense-356.html    single-time-per-day case
 *   - detalle-catadoras-347.html            two-times-per-day case
 *
 * Cine Cosmos doesn't render calendar dates anywhere — only DOW
 * abbreviations (Ju Vi Sá Do Lu Ma Mi). Tests anchor on a fixed
 * Thursday so date-math assertions are deterministic.
 */

import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as cosmos from './cine-cosmos';

function fixture(name: string): string {
  return readFileSync(
    resolve(__dirname, '../../test/fixtures/cine-cosmos', name),
    'utf8',
  );
}

const ANCHOR_THURSDAY = new Date(Date.UTC(2026, 3, 30)); // Thu 2026-04-30 BA-local

describe('extractPrograms', () => {
  const html = fixture('listing.html');

  it('finds all 7 cartelera cards on the homepage', () => {
    const programs = cosmos.extractPrograms(html);
    expect(programs).toHaveLength(7);
  });

  it('captures idPelicula, title, and absolute detail URL for each card', () => {
    const programs = cosmos.extractPrograms(html);
    expect(programs[0]).toEqual({
      idPelicula: '356',
      title: 'Stop making sense',
      detailUrl: 'https://www.cinecosmos.uba.ar/?c=main&a=Detalle&idPelicula=356',
    });
    // Spot-check a different slot to make sure the iteration isn't picking
    // up the same card twice.
    expect(programs.find((p) => p.idPelicula === '347')).toMatchObject({
      title: 'Las catadoras del Führer',
      detailUrl: 'https://www.cinecosmos.uba.ar/?c=main&a=Detalle&idPelicula=347',
    });
  });

  it('dedupes when the same idPelicula appears multiple times', () => {
    // The carousel and the cards section both link to the same idPelicula
    // values. extractPrograms must not double-count.
    const programs = cosmos.extractPrograms(html);
    const ids = programs.map((p) => p.idPelicula);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('parseSynopsis', () => {
  it('keeps the prose before the first <br> and drops the trailing showtime', () => {
    const html = fixture('detalle-stop-making-sense-356.html');
    const $ = cheerio.load(html);
    const synopsis = cosmos.parseSynopsis($);
    expect(synopsis).toBe(
      'Aclamadísimo documental musical sobre los Talking Heads en concierto, rodado en 3 noches y con 7 cámaras por Jonathan Demme.',
    );
    expect(synopsis).not.toContain('21:30');
    expect(synopsis).not.toContain('SALA');
  });

  it('drops both showtimes for two-times-per-day pages (split on <br> still works)', () => {
    const html = fixture('detalle-catadoras-347.html');
    const $ = cheerio.load(html);
    const synopsis = cosmos.parseSynopsis($);
    expect(synopsis).toBeDefined();
    expect(synopsis!.startsWith('Otoño de 1943')).toBe(true);
    expect(synopsis!.endsWith('envenenar.')).toBe(true);
    expect(synopsis).not.toContain('16:55');
    expect(synopsis).not.toContain('19:10');
  });

  it('returns undefined when no <p class="peliculaDescpTexto"> is present', () => {
    const $ = cheerio.load('<html><body><p>Nothing here</p></body></html>');
    expect(cosmos.parseSynopsis($)).toBeUndefined();
  });
});

describe('parseScheduleString', () => {
  it('parses the detail-page format with hyphen-separated days and comma times', () => {
    const r = cosmos.parseScheduleString('Ju - Vi - Sá - Do - Lu - Ma - Mi | 16:55, 19:10');
    expect(r.days.map((d) => d.offset)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(r.times).toEqual([
      { hour: 16, minute: 55 },
      { hour: 19, minute: 10 },
    ]);
  });

  it('parses the homepage card-footer format with bare-space days and dashed times', () => {
    const r = cosmos.parseScheduleString('Ju Vi Sá Do Lu Ma Mi | 16:55 - 19:10');
    expect(r.days).toHaveLength(7);
    expect(r.times).toEqual([
      { hour: 16, minute: 55 },
      { hour: 19, minute: 10 },
    ]);
  });

  it('parses a single-time line', () => {
    const r = cosmos.parseScheduleString('Ju Vi Sá Do Lu Ma Mi | 21:30');
    expect(r.times).toEqual([{ hour: 21, minute: 30 }]);
  });

  it('parses a partial-week pattern (only some days)', () => {
    // If a film ever screens only on weekends, the pattern will be shorter.
    // The parser must just fan out over the matched days.
    const r = cosmos.parseScheduleString('Vi Sá Do | 18:00');
    expect(r.days.map((d) => d.code)).toEqual(['vi', 'sá', 'do']);
    expect(r.days.map((d) => d.offset)).toEqual([1, 2, 3]);
  });

  it('accepts both "Sá" and "Sa" without losing Saturday', () => {
    const accented = cosmos.parseScheduleString('Sá | 18:00');
    const plain = cosmos.parseScheduleString('Sa | 18:00');
    expect(accented.days[0].offset).toBe(2);
    expect(plain.days[0].offset).toBe(2);
  });

  it('returns empty when the "|" separator is missing', () => {
    expect(cosmos.parseScheduleString('Ju Vi Sá Do Lu Ma Mi 16:55')).toEqual({
      days: [],
      times: [],
    });
  });

  it('skips junk tokens but keeps valid days/times', () => {
    const r = cosmos.parseScheduleString('Ju xyz Vi | 16:55, 9999, 19:10');
    expect(r.days.map((d) => d.code)).toEqual(['ju', 'vi']);
    expect(r.times).toEqual([
      { hour: 16, minute: 55 },
      { hour: 19, minute: 10 },
    ]);
  });
});

describe('mostRecentThursdayBaLocal', () => {
  it('returns today when scraping on a Thursday afternoon BA time', () => {
    // 2026-04-30 was a Thursday. 18:00 BA = 21:00 UTC.
    const now = new Date('2026-04-30T21:00:00Z');
    const anchor = cosmos.mostRecentThursdayBaLocal(now);
    expect(anchor.toISOString()).toBe('2026-04-30T00:00:00.000Z');
  });

  it('rolls back to the previous Thursday when scraping mid-week', () => {
    // Wed 2026-05-06 14:00 BA = 17:00 UTC. Most-recent Thursday is Apr 30.
    const now = new Date('2026-05-06T17:00:00Z');
    const anchor = cosmos.mostRecentThursdayBaLocal(now);
    expect(anchor.toISOString()).toBe('2026-04-30T00:00:00.000Z');
  });

  it('rolls forward across midnight UTC: late Wed UTC, still Wed BA', () => {
    // Wed 2026-05-06 23:00 BA = Thu 2026-05-07 02:00 UTC.
    // Most-recent Thursday in BA is still Apr 30, NOT May 7.
    const now = new Date('2026-05-07T02:00:00Z');
    const anchor = cosmos.mostRecentThursdayBaLocal(now);
    expect(anchor.toISOString()).toBe('2026-04-30T00:00:00.000Z');
  });

  it('flips on Thursday morning BA — the new cycle anchor is today', () => {
    // Thu 2026-05-07 09:00 BA = 12:00 UTC.
    const now = new Date('2026-05-07T12:00:00Z');
    const anchor = cosmos.mostRecentThursdayBaLocal(now);
    expect(anchor.toISOString()).toBe('2026-05-07T00:00:00.000Z');
  });
});

describe('parseDetailPage (single-time-per-day fixture)', () => {
  const html = fixture('detalle-stop-making-sense-356.html');
  const program: cosmos.ProgramLink = {
    idPelicula: '356',
    title: 'Stop making sense',
    detailUrl: 'https://www.cinecosmos.uba.ar/?c=main&a=Detalle&idPelicula=356',
  };

  it('emits 7 screenings (one per day of the week)', () => {
    const warnings: string[] = [];
    const out = cosmos.parseDetailPage(html, program, ANCHOR_THURSDAY, warnings);
    expect(warnings).toEqual([]);
    expect(out).toHaveLength(7);
    for (const s of out) {
      expect(s.cinemaId).toBe('cine-cosmos');
      expect(s.filmTitle).toBe('Stop making sense');
      expect(s.tags).toEqual(['cycle']);
    }
  });

  it('extracts director, year, country, runtime, and synopsis', () => {
    const out = cosmos.parseDetailPage(html, program, ANCHOR_THURSDAY, []);
    expect(out[0]).toMatchObject({
      director: 'Jonathan Demme',
      year: 1984,
      country: 'EE.UU.',
      runtimeMin: 88,
    });
    expect(out[0].synopsisEs).toBeDefined();
    expect(out[0].synopsisEs!.startsWith('Aclamadísimo documental')).toBe(true);
  });

  it('places the Thursday 21:30 BA screening at 00:30 UTC on Friday May 1', () => {
    const out = cosmos.parseDetailPage(html, program, ANCHOR_THURSDAY, []);
    // Thursday is offset 0 from anchor. 21:30 BA = 00:30 UTC next day.
    const thuScreening = out.find(
      (s) =>
        s.startsAtUtc.getUTCFullYear() === 2026 &&
        s.startsAtUtc.getUTCMonth() === 4 && // May
        s.startsAtUtc.getUTCDate() === 1 &&
        s.startsAtUtc.getUTCHours() === 0 &&
        s.startsAtUtc.getUTCMinutes() === 30,
    );
    expect(thuScreening).toBeDefined();
  });

  it('places the Wednesday 21:30 BA screening on Thu May 7 00:30 UTC (cycle end)', () => {
    const out = cosmos.parseDetailPage(html, program, ANCHOR_THURSDAY, []);
    // Wed = offset 6 from anchor Thu Apr 30 → Wed May 6 BA → Thu May 7 00:30 UTC.
    const wedScreening = out.find(
      (s) =>
        s.startsAtUtc.getUTCMonth() === 4 &&
        s.startsAtUtc.getUTCDate() === 7 &&
        s.startsAtUtc.getUTCHours() === 0 &&
        s.startsAtUtc.getUTCMinutes() === 30,
    );
    expect(wedScreening).toBeDefined();
  });
});

describe('parseDetailPage (two-times-per-day fixture)', () => {
  const html = fixture('detalle-catadoras-347.html');
  const program: cosmos.ProgramLink = {
    idPelicula: '347',
    title: 'Las catadoras del Führer',
    detailUrl: 'https://www.cinecosmos.uba.ar/?c=main&a=Detalle&idPelicula=347',
  };

  it('emits 14 screenings (7 days × 2 times)', () => {
    const warnings: string[] = [];
    const out = cosmos.parseDetailPage(html, program, ANCHOR_THURSDAY, warnings);
    expect(warnings).toEqual([]);
    expect(out).toHaveLength(14);
  });

  it('places both 16:55 and 19:10 BA showtimes on each day', () => {
    const out = cosmos.parseDetailPage(html, program, ANCHOR_THURSDAY, []);
    // Group by BA-local date and assert each has exactly two showtimes.
    const byDate = new Map<string, number[]>();
    for (const s of out) {
      const baLocal = new Date(s.startsAtUtc.getTime() - 3 * 3600 * 1000);
      const key = baLocal.toISOString().slice(0, 10);
      const hm = baLocal.getUTCHours() * 100 + baLocal.getUTCMinutes();
      byDate.set(key, [...(byDate.get(key) ?? []), hm]);
    }
    expect(byDate.size).toBe(7);
    for (const times of byDate.values()) {
      expect(times.sort()).toEqual([1655, 1910]);
    }
  });

  it('extracts the 2025/Italian metadata and full synopsis', () => {
    const s = cosmos.parseDetailPage(html, program, ANCHOR_THURSDAY, [])[0];
    expect(s).toMatchObject({
      director: 'Silvio Soldini',
      year: 2025,
      country: 'Italia',
      runtimeMin: 123,
    });
    expect(s.synopsisEs).toBeDefined();
    expect(s.synopsisEs!.endsWith('envenenar.')).toBe(true);
  });
});
