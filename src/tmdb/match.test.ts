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
import { pickBestMatch, scoreCandidates, MATCH_CONFIDENCE_THRESHOLD } from './match';
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

describe('pickBestMatch — popularity tiebreaker', () => {
  it('prefers the more popular candidate when string scores tie', () => {
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
    const m = pickBestMatch([less, more], 'The Misfits', 1961);
    expect(m!.candidate.id).toBe(2);
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
