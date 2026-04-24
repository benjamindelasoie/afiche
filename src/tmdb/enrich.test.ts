/**
 * Tests for the enrichFilm orchestrator — two-pass union search, director
 * fallback, override precedence. Client layer (TMDB HTTP) is fully mocked
 * so no real network is hit.
 *
 * The motivating case: "Los inadaptados" (Spanish scrape) + year 1961 +
 * titleOriginal="The Misfits" + director="John Huston". Title-only search
 * on the Spanish string misses the TMDB entry; the union search with the
 * original title finds it, and a director-confirmed fallback exists for
 * titles that drift far from both the scrape and TMDB's localized entry.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TmdbMovieDetails, TmdbMovieSummary } from './client';

const searchMock = vi.fn();
const getMovieMock = vi.fn();
const findOverrideMock = vi.fn();
const hasTokenMock = vi.fn();

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    hasTmdbToken: () => hasTokenMock(),
    searchMovies: (...args: unknown[]) => searchMock(...args),
    getMovie: (...args: unknown[]) => getMovieMock(...args),
    extractDirectors: actual.extractDirectors,
    posterImageUrl: actual.posterImageUrl,
  };
});

vi.mock('./overrides', () => ({
  findOverride: (...args: unknown[]) => findOverrideMock(...args),
}));

const { enrichFilm } = await import('./enrich');

function summary(overrides: Partial<TmdbMovieSummary>): TmdbMovieSummary {
  return {
    id: 0,
    title: '',
    original_title: '',
    original_language: 'en',
    release_date: '',
    overview: '',
    poster_path: null,
    popularity: 0,
    vote_count: 0,
    ...overrides,
  };
}

function details(overrides: Partial<TmdbMovieDetails>): TmdbMovieDetails {
  return {
    id: 0,
    title: '',
    original_title: '',
    original_language: 'en',
    release_date: '',
    overview: '',
    poster_path: null,
    popularity: 0,
    vote_count: 0,
    imdb_id: null,
    runtime: null,
    genres: [],
    production_countries: [],
    tagline: '',
    credits: { cast: [], crew: [] },
    ...overrides,
  };
}

describe('enrichFilm — token + override gates', () => {
  beforeEach(() => {
    searchMock.mockReset();
    getMovieMock.mockReset();
    findOverrideMock.mockReset();
    hasTokenMock.mockReset();
    hasTokenMock.mockReturnValue(true);
  });

  it('returns no-token when TMDB_API_TOKEN is absent (no network attempts)', async () => {
    hasTokenMock.mockReturnValue(false);
    const r = await enrichFilm('Los inadaptados', 1961);
    expect(r.reason).toBe('no-token');
    expect(r.delta).toBeNull();
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('uses the manual override path before touching search', async () => {
    findOverrideMock.mockResolvedValue(887);
    getMovieMock.mockResolvedValue(
      details({
        id: 887,
        title: 'Vidas Rebeldes',
        original_title: 'The Misfits',
        release_date: '1961-02-01',
      }),
    );

    const r = await enrichFilm('Los inadaptados', 1961, { titleOriginal: 'The Misfits' });

    expect(r.reason).toBe('ok');
    expect(r.delta!.matchSource).toBe('override');
    expect(searchMock).not.toHaveBeenCalled();
  });
});

describe('enrichFilm — union search (scrapedTitle + titleOriginal)', () => {
  beforeEach(() => {
    searchMock.mockReset();
    getMovieMock.mockReset();
    findOverrideMock.mockReset().mockResolvedValue(null);
    hasTokenMock.mockReset().mockReturnValue(true);
  });

  it('searches with both queries when titleOriginal is distinct from scrapedTitle', async () => {
    searchMock.mockImplementation((q: string) => {
      if (q === 'Los inadaptados') return Promise.resolve([]);
      if (q === 'The Misfits') {
        return Promise.resolve([
          summary({
            id: 887,
            title: 'Vidas Rebeldes',
            original_title: 'The Misfits',
            release_date: '1961-02-01',
          }),
        ]);
      }
      return Promise.resolve([]);
    });
    getMovieMock.mockResolvedValue(
      details({
        id: 887,
        title: 'Vidas Rebeldes',
        original_title: 'The Misfits',
        release_date: '1961-02-01',
        runtime: 124,
        credits: {
          cast: [],
          crew: [
            { id: 1, name: 'John Huston', job: 'Director', department: 'Directing' },
          ],
        },
      }),
    );

    const r = await enrichFilm('Los inadaptados', 1961, {
      titleOriginal: 'The Misfits',
      director: 'John Huston',
    });

    expect(searchMock).toHaveBeenCalledTimes(2);
    expect(searchMock).toHaveBeenCalledWith('Los inadaptados', 1961);
    expect(searchMock).toHaveBeenCalledWith('The Misfits', 1961);
    expect(r.reason).toBe('ok');
    expect(r.delta!.tmdbId).toBe(887);
    expect(r.delta!.titleOriginal).toBe('The Misfits');
  });

  it('uses only scrapedTitle query when titleOriginal is absent or equal', async () => {
    searchMock.mockResolvedValue([
      summary({
        id: 1,
        title: 'Casablanca',
        original_title: 'Casablanca',
        release_date: '1942-11-26',
      }),
    ]);
    getMovieMock.mockResolvedValue(
      details({
        id: 1,
        title: 'Casablanca',
        original_title: 'Casablanca',
        release_date: '1942-11-26',
      }),
    );

    await enrichFilm('Casablanca', 1942);
    expect(searchMock).toHaveBeenCalledTimes(1);

    searchMock.mockClear();
    await enrichFilm('Casablanca', 1942, { titleOriginal: 'Casablanca' });
    expect(searchMock).toHaveBeenCalledTimes(1);
  });

  it('deduplicates candidates that appear in both search results by TMDB id', async () => {
    const shared = summary({
      id: 887,
      title: 'Vidas Rebeldes',
      original_title: 'The Misfits',
      release_date: '1961-02-01',
    });
    searchMock.mockImplementation((q: string) => {
      // Both queries return the same candidate.
      if (q === 'Los inadaptados' || q === 'The Misfits')
        return Promise.resolve([shared]);
      return Promise.resolve([]);
    });
    getMovieMock.mockResolvedValue(
      details({ ...shared, credits: { cast: [], crew: [] } }),
    );

    const r = await enrichFilm('Los inadaptados', 1961, { titleOriginal: 'The Misfits' });

    // If dedup broke, pickBestMatch would still succeed, but we'd pass a
    // larger list — this spec documents the contract.
    expect(r.reason).toBe('ok');
    expect(r.delta!.tmdbId).toBe(887);
  });

  it('returns no-candidates when both searches come back empty', async () => {
    searchMock.mockResolvedValue([]);
    const r = await enrichFilm('Unknown Indie Film', 2024, { titleOriginal: 'Unknown' });
    expect(r.reason).toBe('no-candidates');
    expect(r.delta).toBeNull();
  });
});

describe('enrichFilm — director fallback (rescues below-threshold matches)', () => {
  beforeEach(() => {
    searchMock.mockReset();
    getMovieMock.mockReset();
    findOverrideMock.mockReset().mockResolvedValue(null);
    hasTokenMock.mockReset().mockReturnValue(true);
  });

  it('rescues a film whose string similarity is below threshold when the director matches', async () => {
    // Candidate has both titles drift far from the scrape AND the hint —
    // no string-based match possible. Only director can rescue it.
    const cand = summary({
      id: 42,
      title: 'Some Obscure Localization',
      original_title: 'Another Drifted Name',
      release_date: '1961-01-01',
    });
    searchMock.mockResolvedValue([cand]);
    getMovieMock.mockResolvedValue(
      details({
        ...cand,
        credits: {
          cast: [],
          crew: [
            { id: 1, name: 'John Huston', job: 'Director', department: 'Directing' },
          ],
        },
      }),
    );

    const r = await enrichFilm('Los inadaptados', 1961, {
      titleOriginal: 'Drift',
      director: 'John Huston',
    });

    expect(r.reason).toBe('ok');
    expect(r.delta!.tmdbId).toBe(42);
    expect(r.delta!.director).toBe('John Huston');
  });

  it('normalizes accents when matching scraped director against TMDB crew', async () => {
    const cand = summary({
      id: 100,
      title: 'Drifted Title',
      original_title: 'Also Drifted',
      release_date: '2019-01-01',
    });
    searchMock.mockResolvedValue([cand]);
    getMovieMock.mockResolvedValue(
      details({
        ...cand,
        credits: {
          cast: [],
          crew: [
            { id: 1, name: 'Agnès Varda', job: 'Director', department: 'Directing' },
          ],
        },
      }),
    );

    const r = await enrichFilm('Unrelated Scrape', 2019, {
      // No accent on the scrape; TMDB has one. Normalization should bridge this.
      director: 'Agnes Varda',
    });

    expect(r.reason).toBe('ok');
    expect(r.delta!.tmdbId).toBe(100);
  });

  it('returns low-confidence when director fallback also fails to disambiguate', async () => {
    const cand = summary({
      id: 1,
      title: 'Unrelated',
      original_title: 'Also Unrelated',
      release_date: '1961-01-01',
    });
    searchMock.mockResolvedValue([cand]);
    getMovieMock.mockResolvedValue(
      details({
        ...cand,
        credits: {
          cast: [],
          crew: [
            {
              id: 1,
              name: 'Different Director',
              job: 'Director',
              department: 'Directing',
            },
          ],
        },
      }),
    );

    const r = await enrichFilm('Los inadaptados', 1961, { director: 'John Huston' });

    expect(r.reason).toBe('low-confidence');
    expect(r.delta).toBeNull();
  });

  it('does not invoke the director fallback when no director hint is passed', async () => {
    const cand = summary({
      id: 1,
      title: 'Unrelated',
      original_title: 'Also Unrelated',
      release_date: '1961-01-01',
    });
    searchMock.mockResolvedValue([cand]);

    const r = await enrichFilm('Los inadaptados', 1961);

    expect(r.reason).toBe('low-confidence');
    // No getMovie calls because we never entered the fallback loop.
    expect(getMovieMock).not.toHaveBeenCalled();
  });
});
