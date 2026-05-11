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
    backdrop_path: null,
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
    backdrop_path: null,
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

describe('enrichFilm — wrong confident top match rescued by director-verification (Nosferatu / Eggers vs Herzog)', () => {
  beforeEach(() => {
    searchMock.mockReset();
    getMovieMock.mockReset();
    findOverrideMock.mockReset().mockResolvedValue(null);
    hasTokenMock.mockReset().mockReturnValue(true);
  });

  it('rescues the right film via director-verification when the top title-match has wrong director (TODOS.md #18)', async () => {
    // The exact shape of the production bug. MALBA's Cineclub Nocturna 5
    // page renders Werner Herzog's Nosferatu (1979) as just "Nosferatu".
    // TMDB search returns Eggers 2024 (title "Nosferatu", score 1.0)
    // and Herzog 1979 (title "Nosferatu, fantasma de la noche",
    // score ~0.87). Pre-fix: pickBestMatch picked Eggers on title score
    // alone, director-fallback never ran. Post-fix: pickBestMatch still
    // picks Eggers, but director-verification rejects him on hint
    // mismatch and falls through to director-fallback, which walks
    // top-3 and accepts Herzog (whose director matches the hint).
    const herzog = summary({
      id: 5648,
      title: 'Nosferatu, fantasma de la noche',
      original_title: 'Nosferatu: Phantom der Nacht',
      release_date: '1979-01-17',
      popularity: 20.0,
    });
    const eggers = summary({
      id: 426063,
      title: 'Nosferatu',
      original_title: 'Nosferatu',
      release_date: '2024-12-25',
      popularity: 500.0,
    });
    searchMock.mockResolvedValue([eggers, herzog]);
    getMovieMock.mockImplementation((id: number) => {
      if (id === 426063)
        return Promise.resolve(
          details({
            ...eggers,
            credits: {
              cast: [],
              crew: [
                {
                  id: 1,
                  name: 'Robert Eggers',
                  job: 'Director',
                  department: 'Directing',
                },
              ],
            },
          }),
        );
      if (id === 5648)
        return Promise.resolve(
          details({
            ...herzog,
            credits: {
              cast: [],
              crew: [
                {
                  id: 2,
                  name: 'Werner Herzog',
                  job: 'Director',
                  department: 'Directing',
                },
              ],
            },
          }),
        );
      throw new Error(`unexpected getMovie call: id=${id}`);
    });

    const r = await enrichFilm('Nosferatu', undefined, { director: 'Werner Herzog' });

    expect(r.reason).toBe('ok');
    expect(r.delta!.tmdbId).toBe(5648);
    expect(r.delta!.director).toBe('Werner Herzog');
    // Confidence is the candidate's original score boosted to at least
    // MATCH_CONFIDENCE_THRESHOLD (director match is a strong signal).
    expect(r.delta!.matchConfidence).toBeGreaterThanOrEqual(0.85);
  });

  it('the top-details fetch is reused — no duplicate getMovie when verification fails and rescue revisits the top', async () => {
    // Verifies the topDetails cache: when director-verification on the
    // top match fails AND the fallback walks scoreCandidates' top-3,
    // the top candidate's details are reused (already fetched). For
    // the Nosferatu shape, Eggers is fetched exactly once: during the
    // verification probe. The fallback's first iteration reuses that;
    // its second iteration fetches Herzog (1 new call). Total: 2.
    const herzog = summary({
      id: 5648,
      title: 'Nosferatu, fantasma de la noche',
      original_title: 'Nosferatu: Phantom der Nacht',
      release_date: '1979-01-17',
      popularity: 20.0,
    });
    const eggers = summary({
      id: 426063,
      title: 'Nosferatu',
      original_title: 'Nosferatu',
      release_date: '2024-12-25',
      popularity: 500.0,
    });
    searchMock.mockResolvedValue([eggers, herzog]);
    getMovieMock.mockImplementation((id: number) => {
      if (id === 426063)
        return Promise.resolve(
          details({
            ...eggers,
            overview: 'A 24-year-old apprentice estate agent...',
            credits: {
              cast: [],
              crew: [
                {
                  id: 1,
                  name: 'Robert Eggers',
                  job: 'Director',
                  department: 'Directing',
                },
              ],
            },
          }),
        );
      // Non-empty overview so resolveSpanishSynopsis doesn't trigger an
      // es-AR → es fallback fetch — that's a separate concern from the
      // dedup invariant under test.
      return Promise.resolve(
        details({
          ...herzog,
          overview: 'Después de un siglo, el conde Drácula viaja...',
          credits: {
            cast: [],
            crew: [
              { id: 2, name: 'Werner Herzog', job: 'Director', department: 'Directing' },
            ],
          },
        }),
      );
    });

    await enrichFilm('Nosferatu', undefined, { director: 'Werner Herzog' });

    // Eggers fetched once (verification probe), reused by fallback.
    // Herzog fetched once (fallback step 2). Total = 2.
    expect(getMovieMock).toHaveBeenCalledTimes(2);
    expect(getMovieMock.mock.calls.filter((c) => c[0] === 426063)).toHaveLength(1);
    expect(getMovieMock.mock.calls.filter((c) => c[0] === 5648)).toHaveLength(1);
  });

  it('returns low-confidence when title is genuinely ambiguous AND no director hint is available (operator-actionable miss)', async () => {
    // Different shape: TMDB has two entries with the SAME localized
    // title (e.g. Eggers 2024 + Murnau 1922 both stored as just
    // "Nosferatu" in es-AR — a real TMDB pattern for classic remakes).
    // Both score 1.0; ambiguity guard fires; no director hint to
    // disambiguate; surfaces as low-confidence so the operator can
    // patch via override or manual tmdb_id.
    const eggers = summary({
      id: 426063,
      title: 'Nosferatu',
      original_title: 'Nosferatu',
      release_date: '2024-12-25',
      popularity: 500.0,
    });
    const murnau = summary({
      id: 653,
      title: 'Nosferatu',
      original_title: 'Nosferatu, eine Symphonie des Grauens',
      release_date: '1922-03-04',
      popularity: 30.0,
    });
    searchMock.mockResolvedValue([eggers, murnau]);

    const r = await enrichFilm('Nosferatu', undefined);

    expect(r.reason).toBe('low-confidence');
    expect(r.delta).toBeNull();
    // No getMovie calls — ambiguity guard returns null in step 3 and
    // step 4 is skipped because no director hint was provided.
    expect(getMovieMock).not.toHaveBeenCalled();
  });

  it('a year hint resolves ambiguity at the candidate-filter layer (Nosferatu + year=1979 → Herzog wins on title alone)', async () => {
    // Year=1979 filters Eggers 2024 out via yearAcceptable (±1 window),
    // leaving Herzog 1979 as the sole high-confidence candidate. No
    // ambiguity, no director-fallback needed.
    const herzog = summary({
      id: 5648,
      title: 'Nosferatu, fantasma de la noche',
      original_title: 'Nosferatu: Phantom der Nacht',
      release_date: '1979-01-17',
      popularity: 20.0,
    });
    const eggers = summary({
      id: 426063,
      title: 'Nosferatu',
      original_title: 'Nosferatu',
      release_date: '2024-12-25',
      popularity: 500.0,
    });
    searchMock.mockResolvedValue([eggers, herzog]);
    getMovieMock.mockResolvedValue(
      details({
        ...herzog,
        credits: {
          cast: [],
          crew: [
            { id: 2, name: 'Werner Herzog', job: 'Director', department: 'Directing' },
          ],
        },
      }),
    );

    const r = await enrichFilm('Nosferatu', 1979);

    expect(r.reason).toBe('ok');
    expect(r.delta!.tmdbId).toBe(5648);
  });
});
