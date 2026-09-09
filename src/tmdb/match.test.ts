/**
 * Tests for the pure fuzzy-matching layer.
 *
 * No network — all candidates are plain objects. Covers:
 *   - Baseline: scrapedTitle-only scoring (current behavior).
 *   - titleOriginal hint: rescues films whose Spanish scrape differs from
 *     BOTH the TMDB localized title and the original_title
 *     (e.g. "Los inadaptados" + hint "The Misfits" → matches via hint).
 *   - Year tolerance / rejection.
 *   - Popularity tiebreaker.
 *   - scoreCandidates returns sorted list (used by enrich's director fallback).
 */

import { describe, it, expect } from 'vitest';
import {
  pickBestMatch,
  scoreCandidates,
  dominantByVotes,
  MATCH_CONFIDENCE_THRESHOLD,
  TITLE_AMBIGUITY_EPSILON,
  TITLE_MIN_VOTE_COUNT,
  titleForms,
  type MatchResult,
} from './match';
import type { TmdbMovieSummary } from './client';

function candidate(overrides: Partial<TmdbMovieSummary>): TmdbMovieSummary {
  return {
    id: 0,
    title: '',
    original_title: '',
    original_language: 'en',
    release_date: '',
    overview: '',
    poster_path: null,
    backdrop_path: null,
    popularity: 0,
    vote_count: 0,
    vote_average: 0,
    ...overrides,
  };
}

describe('pickBestMatch — baseline (no hints)', () => {
  it('returns null on empty candidate list', () => {
    expect(pickBestMatch([], 'Los inadaptados', 1961)).toBeNull();
  });

  it('matches when scrapedTitle matches candidate.title closely', () => {
    const c = candidate({
      id: 887,
      title: 'Los inadaptados',
      original_title: 'The Misfits',
      release_date: '1961-02-01',
    });
    const m = pickBestMatch([c], 'Los inadaptados', 1961);
    expect(m).not.toBeNull();
    expect(m!.candidate.id).toBe(887);
    expect(m!.confidence).toBeGreaterThanOrEqual(MATCH_CONFIDENCE_THRESHOLD);
    expect(m!.matchedAgainst).toBe('title');
  });

  it('matches against original_title when the scrape is in the same language as TMDB stores', () => {
    // Scraper emitted the English title; TMDB has Spanish as .title.
    const c = candidate({
      id: 887,
      title: 'Vidas rebeldes',
      original_title: 'The Misfits',
      release_date: '1961-02-01',
    });
    const m = pickBestMatch([c], 'The Misfits', 1961);
    expect(m).not.toBeNull();
    expect(m!.matchedAgainst).toBe('original_title');
  });

  it('returns null when no candidate clears the confidence threshold', () => {
    const c = candidate({
      id: 1,
      title: 'Completely Unrelated Film',
      original_title: 'Also Unrelated',
      release_date: '1961-02-01',
    });
    expect(pickBestMatch([c], 'Los inadaptados', 1961)).toBeNull();
  });
});

describe('pickBestMatch — titleOriginal hint rescues Spanish-only scrapes', () => {
  it('matches "Los inadaptados" → "The Misfits" when TMDB localizes to "Vidas Rebeldes"', () => {
    // The failure case the hint is designed for: scraped Spanish title
    // matches neither candidate.title (a different Spanish translation)
    // nor candidate.original_title.
    const c = candidate({
      id: 887,
      title: 'Vidas Rebeldes',
      original_title: 'The Misfits',
      release_date: '1961-02-01',
    });

    const withoutHint = pickBestMatch([c], 'Los inadaptados', 1961);
    expect(withoutHint).toBeNull();

    const withHint = pickBestMatch([c], 'Los inadaptados', 1961, {
      titleOriginal: 'The Misfits',
    });
    expect(withHint).not.toBeNull();
    expect(withHint!.candidate.id).toBe(887);
    expect(withHint!.matchedAgainst).toBe('original_title');
    expect(withHint!.confidence).toBeGreaterThanOrEqual(MATCH_CONFIDENCE_THRESHOLD);
  });

  it('still matches when hint equals scrapedTitle (no-op hint)', () => {
    const c = candidate({
      id: 100,
      title: 'The Misfits',
      original_title: 'The Misfits',
      release_date: '1961-02-01',
    });
    const m = pickBestMatch([c], 'The Misfits', 1961, { titleOriginal: 'The Misfits' });
    expect(m).not.toBeNull();
    expect(m!.confidence).toBeCloseTo(1.0, 2);
  });

  it('ignores undefined hint without crashing', () => {
    const c = candidate({
      id: 1,
      title: 'Los inadaptados',
      original_title: 'The Misfits',
      release_date: '1961-02-01',
    });
    const m = pickBestMatch([c], 'Los inadaptados', 1961, { titleOriginal: undefined });
    expect(m).not.toBeNull();
    expect(m!.candidate.id).toBe(1);
  });
});

describe('pickBestMatch — year filter', () => {
  it('rejects a perfect title match when the year is far off', () => {
    const c = candidate({
      id: 1,
      title: 'The Misfits',
      original_title: 'The Misfits',
      release_date: '2020-01-01',
    });
    expect(pickBestMatch([c], 'The Misfits', 1961)).toBeNull();
  });

  it('accepts ±1 year drift (Argentinian release differs from TMDB)', () => {
    const c = candidate({
      id: 1,
      title: 'The Misfits',
      original_title: 'The Misfits',
      release_date: '1960-12-31',
    });
    expect(pickBestMatch([c], 'The Misfits', 1961)).not.toBeNull();
  });

  it('accepts any candidate when scraped year is undefined', () => {
    const c = candidate({
      id: 1,
      title: 'The Misfits',
      original_title: 'The Misfits',
      release_date: '1961-02-01',
    });
    expect(pickBestMatch([c], 'The Misfits', undefined)).not.toBeNull();
  });
});

describe('pickBestMatch — title ambiguity guard', () => {
  // Bug class adjacent to TODOS.md #18: when TMDB returns multiple
  // candidates with the SAME localized title (e.g. Eggers 2024 and
  // Murnau 1922 both stored under "Nosferatu" in TMDB's es-AR
  // localization), pickBestMatch would previously break the tie by
  // popularity — silently picking the most-popular wrong film. With
  // the ambiguity guard, identical-title candidates above threshold
  // force a null return so the caller disambiguates via director or
  // surfaces as 'low-confidence' (operator-actionable miss).
  it('returns null when top-2 candidates tie at high confidence (identical localized titles)', () => {
    // Vote counts are the real ones (TMDB, 2026-09-08). They matter: the tie
    // must hold on genuine ambiguity, not merely because the fixtures are
    // vote-less. 3944 / 2523 = 1.6x, far under TITLE_DOMINANCE_RATIO.
    const eggers = candidate({
      id: 426063,
      title: 'Nosferatu',
      original_title: 'Nosferatu',
      release_date: '2024-12-25',
      popularity: 500.0,
      vote_count: 3944,
    });
    const murnau = candidate({
      id: 653,
      title: 'Nosferatu',
      original_title: 'Nosferatu, eine Symphonie des Grauens',
      release_date: '1922-03-04',
      popularity: 30.0,
      vote_count: 2523,
    });
    const m = pickBestMatch([eggers, murnau], 'Nosferatu', undefined);
    expect(m).toBeNull();
  });

  it('still returns null on ambiguous high-confidence ties even with a year hint that filters nothing', () => {
    // Three candidates all in 1979 ±1 — year filter passes all, ambiguity remains.
    const a = candidate({
      id: 1,
      title: 'Test Movie',
      original_title: 'Test Movie',
      release_date: '1979-01-01',
      popularity: 1.0,
    });
    const b = candidate({
      id: 2,
      title: 'Test Movie',
      original_title: 'Test Movie',
      release_date: '1979-01-01',
      popularity: 99.0,
    });
    expect(pickBestMatch([a, b], 'Test Movie', 1979)).toBeNull();
  });

  it('still picks the top when the runner-up is below threshold', () => {
    const top = candidate({
      id: 1,
      title: 'The Misfits',
      original_title: 'The Misfits',
      release_date: '1961-01-01',
      popularity: 10.0,
    });
    const weak = candidate({
      id: 2,
      title: 'Something Else Entirely',
      original_title: 'Different Title',
      release_date: '1961-01-01',
      popularity: 100.0,
    });
    const m = pickBestMatch([top, weak], 'The Misfits', 1961);
    expect(m).not.toBeNull();
    expect(m!.candidate.id).toBe(1);
  });

  it('still picks the top when the runner-up is above threshold but outside the epsilon band', () => {
    // Top scores ~1.0; runner-up scores ~0.90 — both clear 0.85, but the
    // gap (~0.10) is well outside TITLE_AMBIGUITY_EPSILON (0.01). The
    // matcher should be confident enough to pick the top without forcing
    // a director-fallback.
    const top = candidate({
      id: 1,
      title: 'Persona',
      original_title: 'Persona',
      release_date: '1966-01-01',
      popularity: 10.0,
    });
    const runnerUp = candidate({
      id: 2,
      title: 'Personae',
      original_title: 'Personae',
      release_date: '1966-01-01',
      popularity: 1.0,
    });
    const m = pickBestMatch([top, runnerUp], 'Persona', 1966);
    expect(m).not.toBeNull();
    expect(m!.candidate.id).toBe(1);
    // Sanity-check the gap is in fact outside epsilon (otherwise this
    // test would be encoding the wrong intent).
    const sorted = scoreCandidates([top, runnerUp], 'Persona', 1966);
    expect(sorted[0].confidence - sorted[1].confidence).toBeGreaterThan(
      TITLE_AMBIGUITY_EPSILON,
    );
  });
});

describe('pickBestMatch — vote dominance breaks a tie no director can', () => {
  // A source that publishes neither a year nor a director (Passline, which
  // backs CINTA) leaves the ambiguity guard nothing to hand off to, so every
  // film with a namesake used to die as a permanent 'none-attempted' miss.
  // Vote-count dominance resolves the ones that are not really ambiguous.
  //
  // All vote counts below are the real TMDB figures, read 2026-09-08.

  const midnightAllen = candidate({
    id: 59436,
    title: 'Midnight in Paris',
    original_title: 'Midnight in Paris',
    release_date: '2011-05-11',
    popularity: 8,
    vote_count: 7870,
  });
  const midnightNamesake = candidate({
    id: 580576,
    title: 'Midnight in Paris',
    original_title: 'Midnight in Paris',
    release_date: '2019-06-19',
    popularity: 0,
    vote_count: 0,
  });

  it('picks the canonical film over a vote-less namesake', () => {
    const m = pickBestMatch(
      [midnightNamesake, midnightAllen],
      'Midnight in Paris',
      undefined,
    );
    expect(m?.candidate.id).toBe(59436);
  });

  it('picks the famous remake over the older film of the same name', () => {
    // Both are real releases TMDB knows; 8460 / 142 = 60x is decisive.
    const stiller = candidate({
      id: 116745,
      title: 'La vida secreta de Walter Mitty',
      original_title: 'The Secret Life of Walter Mitty',
      release_date: '2013-12-18',
      vote_count: 8460,
    });
    const mcleod = candidate({
      id: 27723,
      title: 'La vida secreta de Walter Mitty',
      original_title: 'The Secret Life of Walter Mitty',
      release_date: '1947-08-14',
      vote_count: 142,
    });
    const m = pickBestMatch([mcleod, stiller], 'The Secret Life of Walter Mitty');
    expect(m?.candidate.id).toBe(116745);
  });

  it('ranks by votes, not by the popularity the incoming sort used', () => {
    // The namesake is the more POPULAR of the two (popularity is a buzz score
    // that decays with age, which is exactly why it is the wrong signal here).
    // Dominance must still return the film the audience actually voted on.
    const classic = candidate({
      id: 1,
      title: 'Metropolis',
      original_title: 'Metropolis',
      release_date: '1927-01-10',
      popularity: 3,
      vote_count: 3187,
    });
    const buzzy = candidate({
      id: 2,
      title: 'Metropolis',
      original_title: 'Metropolis',
      release_date: '2024-01-01',
      popularity: 900,
      vote_count: 40,
    });
    const sorted = scoreCandidates([classic, buzzy], 'Metropolis');
    expect(sorted[0].candidate.id).toBe(2); // popularity won the sort…
    expect(pickBestMatch([classic, buzzy], 'Metropolis')?.candidate.id).toBe(1); // …votes won the pick
  });

  it('stands down for the director rescue whenever a director hint exists', () => {
    // The hint is better evidence than any vote count, and it is what lets a
    // venue screening the 1947 Walter Mitty get the 1947 Walter Mitty. Same
    // candidates as the decisive case above — only the hint changes.
    const stiller = candidate({
      id: 116745,
      title: 'The Secret Life of Walter Mitty',
      original_title: 'The Secret Life of Walter Mitty',
      release_date: '2013-12-18',
      vote_count: 8460,
    });
    const mcleod = candidate({
      id: 27723,
      title: 'The Secret Life of Walter Mitty',
      original_title: 'The Secret Life of Walter Mitty',
      release_date: '1947-08-14',
      vote_count: 142,
    });
    const hinted = pickBestMatch(
      [mcleod, stiller],
      'The Secret Life of Walter Mitty',
      undefined,
      { director: 'Norman Z. McLeod' },
    );
    expect(hinted).toBeNull();
  });

  it('holds when two tied films are comparably notable', () => {
    const a = candidate({
      id: 1,
      title: 'Solaris',
      original_title: 'Solaris',
      release_date: '1972-01-01',
      vote_count: 2000,
    });
    const b = candidate({
      id: 2,
      title: 'Solaris',
      original_title: 'Solaris',
      release_date: '2002-01-01',
      vote_count: 1000, // 2x — under TITLE_DOMINANCE_RATIO
    });
    expect(pickBestMatch([a, b], 'Solaris')).toBeNull();
  });

  it('holds when the whole tied band is long-tail, however lopsided', () => {
    // 30x, but on 30 votes against 1: a runaway ratio between two unknowns
    // says nothing about which is "the" film.
    const a = candidate({
      id: 1,
      title: 'Cortometraje',
      original_title: 'Cortometraje',
      release_date: '2015-01-01',
      vote_count: 30,
    });
    const b = candidate({
      id: 2,
      title: 'Cortometraje',
      original_title: 'Cortometraje',
      release_date: '2019-01-01',
      vote_count: 1,
    });
    expect(pickBestMatch([a, b], 'Cortometraje')).toBeNull();
  });
});

describe('dominantByVotes', () => {
  const withVotes = (id: number, vote_count: number): MatchResult => ({
    candidate: candidate({ id, vote_count }),
    confidence: 1,
    matchedAgainst: 'title',
  });

  it('returns null for an empty band', () => {
    expect(dominantByVotes([])).toBeNull();
  });

  it('accepts a lone notable candidate (no rival to outweigh)', () => {
    expect(dominantByVotes([withVotes(1, 500)])?.candidate.id).toBe(1);
  });

  it('rejects a lone candidate under the vote floor', () => {
    expect(dominantByVotes([withVotes(1, TITLE_MIN_VOTE_COUNT - 1)])).toBeNull();
  });

  it('treats the ratio as inclusive at exactly TITLE_DOMINANCE_RATIO', () => {
    const band = [withVotes(1, 400), withVotes(2, 100)]; // exactly 4x
    expect(dominantByVotes(band)?.candidate.id).toBe(1);
  });

  it('rejects just under the ratio', () => {
    const band = [withVotes(1, 399), withVotes(2, 100)];
    expect(dominantByVotes(band)).toBeNull();
  });

  it('measures against the strongest rival, not the first one listed', () => {
    // 1000 dominates the 10, but not the 900 further down the band.
    const band = [withVotes(1, 1000), withVotes(2, 10), withVotes(3, 900)];
    expect(dominantByVotes(band)).toBeNull();
  });
});

describe('scoreCandidates — popularity still tiebreaks the sort order', () => {
  // Ambiguity guard only affects pickBestMatch's final decision —
  // scoreCandidates still sorts more-popular first when title scores tie.
  // This matters for director-fallback in enrich.ts, which walks the
  // sorted top-3: popularity-first order means the most likely candidate
  // is checked first, minimizing wasted TMDB credit fetches.
  it('orders tied-title candidates by popularity, more-popular first', () => {
    const less = candidate({
      id: 1,
      title: 'The Misfits',
      original_title: 'The Misfits',
      release_date: '1961-01-01',
      popularity: 2.0,
    });
    const more = candidate({
      id: 2,
      title: 'The Misfits',
      original_title: 'The Misfits',
      release_date: '1961-01-01',
      popularity: 50.0,
    });
    const sorted = scoreCandidates([less, more], 'The Misfits', 1961);
    expect(sorted[0].candidate.id).toBe(2);
    expect(sorted[1].candidate.id).toBe(1);
  });
});

describe('scoreCandidates — sorted list for director fallback', () => {
  it('returns candidates best-first by score', () => {
    const weak = candidate({
      id: 1,
      title: 'Unrelated Thing',
      original_title: 'Also Unrelated',
      release_date: '1961-01-01',
    });
    const strong = candidate({
      id: 2,
      title: 'Los inadaptados',
      original_title: 'The Misfits',
      release_date: '1961-01-01',
    });
    const sorted = scoreCandidates([weak, strong], 'Los inadaptados', 1961);
    expect(sorted[0].candidate.id).toBe(2);
    expect(sorted[1].candidate.id).toBe(1);
    expect(sorted[0].confidence).toBeGreaterThan(sorted[1].confidence);
  });

  it('drops candidates outside the year window', () => {
    const tooOld = candidate({
      id: 1,
      title: 'The Misfits',
      original_title: 'The Misfits',
      release_date: '1920-01-01',
    });
    const ok = candidate({
      id: 2,
      title: 'The Misfits',
      original_title: 'The Misfits',
      release_date: '1961-01-01',
    });
    const sorted = scoreCandidates([tooOld, ok], 'The Misfits', 1961);
    expect(sorted).toHaveLength(1);
    expect(sorted[0].candidate.id).toBe(2);
  });

  it('uses both scrapedTitle and titleOriginal when hint is provided', () => {
    const spanishOnly = candidate({
      id: 1,
      title: 'Los inadaptados',
      original_title: 'Los inadaptados',
      release_date: '1961-01-01',
    });
    const englishOnly = candidate({
      id: 2,
      title: 'Vidas Rebeldes',
      original_title: 'The Misfits',
      release_date: '1961-01-01',
    });
    const sorted = scoreCandidates([spanishOnly, englishOnly], 'Los inadaptados', 1961, {
      titleOriginal: 'The Misfits',
    });
    // Both should clear threshold with the hint — spanishOnly on scrapedTitle,
    // englishOnly on titleOriginal.
    expect(sorted).toHaveLength(2);
    expect(sorted[0].confidence).toBeGreaterThanOrEqual(MATCH_CONFIDENCE_THRESHOLD);
    expect(sorted[1].confidence).toBeGreaterThanOrEqual(MATCH_CONFIDENCE_THRESHOLD);
  });
});

describe('titleForms — Spanish release subtitles', () => {
  it('exposes the pre-subtitle form for comma / colon / spaced-dash', () => {
    expect(titleForms('Paprika, detective de los sueños')).toEqual([
      'Paprika, detective de los sueños',
      'Paprika',
    ]);
    expect(titleForms('Alien: el octavo pasajero')).toEqual([
      'Alien: el octavo pasajero',
      'Alien',
    ]);
    expect(titleForms('Rocky - Lo mejor de mí')).toEqual([
      'Rocky - Lo mejor de mí',
      'Rocky',
    ]);
  });

  it('never truncates on a bare space — that would eat real titles', () => {
    // The containment that MUST stay a miss: a different Buñuel film.
    expect(titleForms('El ángel exterminador')).toEqual(['El ángel exterminador']);
    expect(titleForms('100 metros lisos')).toEqual(['100 metros lisos']);
    expect(titleForms('Blade Runner')).toEqual(['Blade Runner']);
  });

  it('handles empty / separator-only input without producing an empty form', () => {
    expect(titleForms(undefined)).toEqual(['']);
    expect(titleForms('')).toEqual(['']);
    expect(titleForms(', solo subtitulo')).toEqual([', solo subtitulo']);
  });
});

describe('pickBestMatch — subtitled Spanish release titles (the PAPRIKA case)', () => {
  // Measured against live TMDB 2026-08-06: searching PAPRIKA/2006 returns the
  // WRONG film scoring 0.893 and the right one 0.845, under a 0.85 threshold.
  const wrong = candidate({
    id: 1330686,
    title: 'Paprika Western',
    original_title: 'Paprika Western',
    release_date: '2006-10-01',
    popularity: 1,
  });
  const right = candidate({
    id: 4977,
    title: 'Paprika, detective de los sueños',
    original_title: 'パプリカ',
    release_date: '2006-10-01',
    popularity: 20,
  });

  it('promotes the subtitled correct film over a shorter wrong one', () => {
    const sorted = scoreCandidates([wrong, right], 'PAPRIKA', 2006);
    expect(sorted[0].candidate.id).toBe(4977);
    expect(sorted[0].confidence).toBeCloseTo(1, 5);
    const picked = pickBestMatch([wrong, right], 'PAPRIKA', 2006);
    expect(picked?.candidate.id).toBe(4977);
  });

  it('still refuses to pick when truncation creates a genuine tie', () => {
    // Herzog's Spanish title truncates to exactly Eggers' title. Both reach
    // ~1.0, so the ambiguity guard must fire and hand off to director rescue
    // rather than letting popularity decide (TODOS.md #18).
    // Real vote counts again (3944 / 1120 = 3.5x): the pair sits just under
    // the dominance ratio, so the guard holds on notability alone even before
    // the director hint gets involved.
    const eggers = candidate({
      id: 426063,
      title: 'Nosferatu',
      original_title: 'Nosferatu',
      release_date: '2024-12-25',
      popularity: 500,
      vote_count: 3944,
    });
    const herzog = candidate({
      id: 24173,
      title: 'Nosferatu, fantasma de la noche',
      original_title: 'Nosferatu: Phantom der Nacht',
      release_date: '1979-01-17',
      popularity: 12,
      vote_count: 1120,
    });
    expect(pickBestMatch([eggers, herzog], 'Nosferatu', undefined)).toBeNull();
  });
});
