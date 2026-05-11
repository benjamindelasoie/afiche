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
  MATCH_CONFIDENCE_THRESHOLD,
  TITLE_AMBIGUITY_EPSILON,
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
    const eggers = candidate({
      id: 426063,
      title: 'Nosferatu',
      original_title: 'Nosferatu',
      release_date: '2024-12-25',
      popularity: 500.0,
    });
    const murnau = candidate({
      id: 653,
      title: 'Nosferatu',
      original_title: 'Nosferatu, eine Symphonie des Grauens',
      release_date: '1922-03-04',
      popularity: 30.0,
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
