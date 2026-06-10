/**
 * Tests for the film metadata line builder — guards the react-zero-and-render
 * trap (runtimeMin = 0 must never print "0 min", regression ISSUE-001) and the
 * no-leading-separator contract.
 */

import { describe, it, expect } from 'vitest';
import { filmMetaLine } from './film-meta';

describe('filmMetaLine', () => {
  it('joins all present fields with " · "', () => {
    expect(
      filmMetaLine({
        director: 'Lila Avilés',
        year: 2023,
        country: 'México',
        runtimeMin: 95,
      }),
    ).toBe('Lila Avilés · 2023 · México · 95 min');
  });

  it('drops a 0 runtime (no "0 min", no trailing separator)', () => {
    expect(
      filmMetaLine({
        director: 'Luis Ortega',
        year: 2024,
        country: 'Argentina',
        runtimeMin: 0,
      }),
    ).toBe('Luis Ortega · 2024 · Argentina');
  });

  it('drops null runtime too', () => {
    expect(
      filmMetaLine({
        director: 'Wim Wenders',
        year: 2023,
        country: 'Japón',
        runtimeMin: null,
      }),
    ).toBe('Wim Wenders · 2023 · Japón');
  });

  it('no leading separator when director is null', () => {
    expect(
      filmMetaLine({ director: null, year: 2023, country: 'Italia', runtimeMin: 130 }),
    ).toBe('2023 · Italia · 130 min');
  });

  it('returns empty string when every field is null', () => {
    expect(
      filmMetaLine({ director: null, year: null, country: null, runtimeMin: null }),
    ).toBe('');
  });
});
