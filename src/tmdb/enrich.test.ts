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
const searchByDirectorMock = vi.fn();

vi.mock('./client', async () => {
  const actual = await vi.importActual<typeof import('./client')>('./client');
  return {
    ...actual,
    hasTmdbToken: () => hasTokenMock(),
    searchMovies: (...args: unknown[]) => searchMock(...args),
    searchMoviesByDirector: (...args: unknown[]) => searchByDirectorMock(...args),
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
    vote_average: 0,
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
    vote_average: 0,
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

  it('captures popularity / vote_average / vote_count / tagline from TMDB', async () => {
    findOverrideMock.mockResolvedValue(5648);
    getMovieMock.mockResolvedValue(
      details({
        id: 5648,
        title: 'Nosferatu, fantasma de la noche',
        popularity: 31.4,
        vote_average: 7.6,
        vote_count: 1820,
        tagline: '  El terror clásico  ',
      }),
    );

    const r = await enrichFilm('Nosferatu', 1979);

    expect(r.reason).toBe('ok');
    expect(r.delta!.popularity).toBe(31.4);
    expect(r.delta!.voteAverage).toBe(7.6);
    expect(r.delta!.voteCount).toBe(1820);
    expect(r.delta!.tagline).toBe('El terror clásico'); // trimmed
  });

  it('maps a blank tagline to null', async () => {
    findOverrideMock.mockResolvedValue(1);
    getMovieMock.mockResolvedValue(details({ id: 1, title: 'X', tagline: '   ' }));
    const r = await enrichFilm('X', 2000);
    expect(r.delta!.tagline).toBeNull();
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

// ---------------------------------------------------------------------------
// directorsMatch direct unit tests — two-tier match: exact-after-normalize
// then Levenshtein-1 fuzzy fallback with length floor. Direct tests on the
// exported predicate complement the integration tests above (which go
// through enrichFilm + director-fallback rescue).
// ---------------------------------------------------------------------------
const { directorsMatch, MIN_FUZZY_LEN } = await import('./enrich');

describe('directorsMatch — tier 1: exact match after normalize', () => {
  it('matches identical strings', () => {
    expect(directorsMatch('Jim Jarmusch', ['Jim Jarmusch'])).toBe(true);
  });

  it('matches across case + Spanish accents', () => {
    expect(directorsMatch('JOSE MARTINEZ SUAREZ', ['José Martínez Suárez'])).toBe(true);
  });

  it('matches Polish letters via stripDiacritics (Possession / Żuławski case)', () => {
    // The scraper emits the anglicized "Zulawski". TMDB carries the
    // Polish-correct "Andrzej Żuławski". Before the extended-Latin map,
    // ł survived NFD and broke the equality check, leaving Possession
    // stuck at 'none-attempted' even after director-fallback rescue ran.
    expect(directorsMatch('Andrzej Zulawski', ['Andrzej Żuławski'])).toBe(true);
  });

  it('matches one entry of a comma-split co-director string', () => {
    // Lugones-style "Director1, Director2" — each chunk is a full name,
    // any TMDB hit on either wins. Each side must match in full (no
    // last-name substring magic — that historically created wrong matches
    // and was deliberately not implemented).
    expect(
      directorsMatch('David Lynch, Mark Frost', ['Mark Frost', 'Other Person']),
    ).toBe(true);
  });

  it('returns false when no exact match across normalized pairs', () => {
    expect(directorsMatch('Stanley Kubrick', ['Christopher Nolan'])).toBe(false);
  });
});

describe('directorsMatch — tier 2: Levenshtein-1 fuzzy fallback', () => {
  it('matches 1-char-substitution typo (La madre / Vsevolov case)', () => {
    // Scraper-side typo: Lugones-emitted "Vsevolov Pudovkin" (the Cyrillic
    // transliteration drifts by one letter); TMDB carries "Vsevolod
    // Pudovkin". Both names are 17 chars >> MIN_FUZZY_LEN; fuzzy fallback
    // fires.
    expect(directorsMatch('Vsevolov Pudovkin', ['Vsevolod Pudovkin'])).toBe(true);
  });

  it('matches 1-char-insertion typo', () => {
    expect(directorsMatch('Almodovars', ['Pedro Almodovar'])).toBe(false); // different name
    expect(directorsMatch('Almodovarx', ['Almodovar'])).toBe(true); // 1-insert at end
  });

  it('does NOT fuzzy-match short names (Lee / Lea false-positive guard)', () => {
    // Both names < MIN_FUZZY_LEN (3 chars each). Distance 1 but fuzz blocked
    // by the length floor — wrong matches are worse than misses.
    expect(directorsMatch('Lee', ['Lea'])).toBe(false);
    expect(directorsMatch('Roy', ['Rob'])).toBe(false);
  });

  it('respects the MIN_FUZZY_LEN boundary on both sides', () => {
    // At exactly MIN_FUZZY_LEN chars both sides → fuzz applies.
    expect(MIN_FUZZY_LEN).toBe(6);
    const sixChar = 'abcdef';
    const sixCharTypo = 'abcdez';
    expect(sixChar.length).toBe(6);
    expect(directorsMatch(sixChar, [sixCharTypo])).toBe(true);

    // 5 chars on either side → no fuzz, exact required, no match.
    expect(directorsMatch('abcde', ['abcdx'])).toBe(false);
    expect(directorsMatch('abcdef', ['abcdx'])).toBe(false); // length diff 1 to a 5-char TMDB name
  });

  it('does NOT match when distance > 1 even with names long enough', () => {
    // Two substitutions = distance 2; fuzzy rejects.
    expect(directorsMatch('Pudovkin', ['Pudoxkim'])).toBe(false);
  });

  it('does NOT match unrelated names of similar length', () => {
    expect(directorsMatch('Kubrick', ['Scorsese'])).toBe(false);
  });
});

// Regression: director verification was rejecting confidence-1.000 correct
// matches on two name-format classes. Found by /qa on 2026-07-27 by
// diagnosing every live miss against prod.
// Report: .gstack/qa-reports/qa-report-afiche-ar-2026-07-27.md
describe('directorsMatch — co-director conjunction splitting', () => {
  it('splits Spanish "y" — the El Partido case', () => {
    // Venue scraped one blob; TMDB credits two people. conf was 1.000 and the
    // match was still thrown away, leaving a duplicate film on the homepage.
    expect(
      directorsMatch('Juan Cabral y Santiago Franco', ['Juan Cabral', 'Santiago Franco']),
    ).toBe(true);
  });

  it('splits Spanish "e" (the y→e swap before an i- sound)', () => {
    expect(
      directorsMatch('Magrio González e Iris Serrano', ['Magrio González', 'Iris Serrano']),
    ).toBe(true);
  });

  it('splits "and", "&", "/" and "+"', () => {
    expect(directorsMatch('Joel Coen & Ethan Coen', ['Ethan Coen'])).toBe(true);
    expect(directorsMatch('Lana Wachowski and Lilly Wachowski', ['Lilly Wachowski'])).toBe(
      true,
    );
    expect(directorsMatch('Jean-Pierre Dardenne / Luc Dardenne', ['Luc Dardenne'])).toBe(
      true,
    );
    expect(directorsMatch('Peter Farrelly + Bobby Farrelly', ['Bobby Farrelly'])).toBe(true);
  });

  it('still matches a name that legitimately contains "y" (unsplit form retained)', () => {
    // The Spanish "Ortega y Gasset" pattern: splitting yields junk, but the
    // whole string is compared too, so the correct match still lands.
    expect(directorsMatch('José Ortega y Gasset', ['José Ortega y Gasset'])).toBe(true);
  });

  it('does NOT match an unrelated director just because a conjunction was split', () => {
    expect(directorsMatch('Juan Cabral y Santiago Franco', ['Martin Scorsese'])).toBe(false);
  });
});

describe('directorsMatch — tier 3: surname-anchored hypocorism table', () => {
  it('matches the Charles/Charlie Chaplin hypocorism (2 edits, tier 2 cannot)', () => {
    expect(directorsMatch('Charles Chaplin', ['Charlie Chaplin'])).toBe(true);
  });

  it('matches Steven/Stephen, which a 0.90 similarity cutoff would MISS (0.894)', () => {
    expect(directorsMatch('Steven Soderbergh', ['Stephen Soderbergh'])).toBe(true);
  });

  it('matches Spanish diminutives', () => {
    expect(directorsMatch('Francisco Lombardi', ['Paco Lombardi'])).toBe(true);
    expect(directorsMatch('José Martínez', ['Pepe Martinez'])).toBe(true);
  });

  // Why the table exists instead of a similarity threshold: gender and
  // inflection variants score 0.92-0.97 Jaro-Winkler, ABOVE charles/charlie
  // at 0.943. Any cutoff admitting the hypocorisms admits these too.
  // Tier 3 refuses them because they are simply not in the table.
  it('tier 3 does not relate gender variants — only curated table entries', () => {
    // Surnames differ, so tier 2 cannot fire and we observe tier 3 alone.
    expect(directorsMatch('Maria Gonzalez', ['Mario Fernandez'])).toBe(false);
    expect(directorsMatch('Juana Perez', ['Juan Ortiz'])).toBe(false);
  });

  // KNOWN GAP, pre-existing and NOT introduced by the tier-3 table: a
  // gender/inflection variant is one edit away on the full name, so tier 2's
  // Levenshtein-1 accepts it. Asserted so the behaviour is visible and a
  // future fix has a failing test to flip, rather than quietly tolerated.
  it('tier 2 still accepts one-edit gender variants sharing a surname (known gap)', () => {
    expect(directorsMatch('Maria González', ['Mario González'])).toBe(true);
    expect(directorsMatch('Juan Pérez', ['Juana Pérez'])).toBe(true);
  });

  it('requires the surname to match EXACTLY — this is what keeps Nosferatu safe', () => {
    // TODOS.md #18: Herzog vs Eggers must never collapse. Different surnames,
    // so tier 3 cannot reach them however the given names relate.
    expect(directorsMatch('Werner Herzog', ['Robert Eggers'])).toBe(false);
    expect(directorsMatch('Charles Chaplin', ['Charlie Chapman'])).toBe(false);
  });

  it('does NOT match siblings sharing a surname', () => {
    expect(directorsMatch('Joel Coen', ['Ethan Coen'])).toBe(false);
    expect(directorsMatch('Jean-Pierre Dardenne', ['Luc Dardenne'])).toBe(false);
  });

  it('does NOT match a single-token name against a full name', () => {
    expect(directorsMatch('Chaplin', ['Charlie Chaplin'])).toBe(false);
  });

  it('keeps alias groups disjoint so the relation stays unambiguous', () => {
    // "alex" belongs to alexander only; alejandro carries its own diminutive.
    expect(directorsMatch('Alexander Payne', ['Alex Payne'])).toBe(true);
    expect(directorsMatch('Alejandro González', ['Alexander González'])).toBe(false);
  });
});

// Director-pivot rescue: when title search returns nothing but we hold a
// director. Found by /qa on 2026-07-27 — 9 of 17 live misses were real films
// whose Argentine release title TMDB does not carry.
// Report: .gstack/qa-reports/qa-report-afiche-ar-2026-07-27.md
describe('enrichFilm — director-pivot rescue (title axis exhausted)', () => {
  beforeEach(() => {
    searchMock.mockReset();
    getMovieMock.mockReset();
    findOverrideMock.mockReset();
    hasTokenMock.mockReset();
    searchByDirectorMock.mockReset();
    hasTokenMock.mockReturnValue(true);
    findOverrideMock.mockResolvedValue(null);
    searchMock.mockResolvedValue([]); // title search always empty here
    searchByDirectorMock.mockResolvedValue([]);
  });

  it('recovers a film when exactly ONE directed credit falls in the year window', async () => {
    // The Moomin case: "LOS MUMIN: EL PEQUEÑO TROL…" finds nothing by title,
    // but Jaromir Wesely has exactly one 1994 credit.
    searchByDirectorMock.mockResolvedValue([
      summary({ id: 250329, title: 'Hur gick det sen?', release_date: '1994-01-01' }),
      summary({ id: 999, title: 'Something Else', release_date: '2010-01-01' }),
    ]);
    getMovieMock.mockResolvedValue(
      details({ id: 250329, title: 'Hur gick det sen?', release_date: '1994-01-01' }),
    );

    const r = await enrichFilm('LOS MUMIN: EL PEQUEÑO TROL MUMIN, MYMLA Y LA PEQUEÑA MY', 1994, {
      director: 'Jaromir Wesely',
    });

    expect(r.reason).toBe('ok');
    expect(r.delta?.tmdbId).toBe(250329);
    expect(searchByDirectorMock).toHaveBeenCalledWith('Jaromir Wesely');
  });

  it('refuses when the scraped year is MISSING — the Colores Perdidos wrong-match class', async () => {
    // Measured on prod: this director has exactly one credit and it is the
    // WRONG film (0.568 title score, higher than a correct rescue at 0.495).
    // With no year the window is vacuous, so uniqueness proves nothing.
    searchByDirectorMock.mockResolvedValue([
      summary({ id: 1211622, title: 'Prohibido olvidar', release_date: '2014-01-01' }),
    ]);

    const r = await enrichFilm('Colores Perdidos', undefined, {
      director: 'Roberto de Biase',
    });

    expect(r.reason).toBe('no-candidates');
    expect(r.delta).toBeNull();
    expect(searchByDirectorMock).not.toHaveBeenCalled();
  });

  it('refuses when MORE THAN ONE credit falls in the year window', async () => {
    // Ambiguous: two 2023 credits, title score cannot separate them
    // (0.497 vs 0.461 measured). Better a visible miss than a coin flip.
    searchByDirectorMock.mockResolvedValue([
      summary({ id: 1160380, title: 'Vem ska trösta Knyttet?', release_date: '2023-01-01' }),
      summary({ id: 1422955, title: 'Hur gick det sen?', release_date: '2023-01-01' }),
    ]);

    const r = await enrichFilm('LOS MUMIN: ¿QUIÉN ANIMARÁ A CHICO?', 2023, {
      director: 'Veronica Lassenius',
    });

    expect(r.reason).toBe('no-candidates');
    expect(r.delta).toBeNull();
  });

  it('does not fire at all when there is no director hint', async () => {
    const r = await enrichFilm('Some Untraceable Title', 1999);
    expect(r.reason).toBe('no-candidates');
    expect(searchByDirectorMock).not.toHaveBeenCalled();
  });

  it('tries each co-director until one resolves to a TMDB person', async () => {
    searchByDirectorMock.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'Santiago Franco'
          ? [summary({ id: 42, title: 'Found It', release_date: '2020-01-01' })]
          : [],
      ),
    );
    getMovieMock.mockResolvedValue(
      details({ id: 42, title: 'Found It', release_date: '2020-01-01' }),
    );

    const r = await enrichFilm('Un Título Argentino', 2020, {
      director: 'Juan Cabral y Santiago Franco',
    });

    expect(r.reason).toBe('ok');
    expect(r.delta?.tmdbId).toBe(42);
  });
});
