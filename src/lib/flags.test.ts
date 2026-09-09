import { describe, it, expect, afterEach } from 'vitest';
import { flagEnabled } from './flags';

const KEY = 'TEST_FLAG_XYZ';
afterEach(() => {
  delete process.env[KEY];
});

describe('flagEnabled', () => {
  it('defaults to on when unset or empty', () => {
    expect(flagEnabled(KEY)).toBe(true);
    process.env[KEY] = '';
    expect(flagEnabled(KEY)).toBe(true);
  });

  it('honors an explicit default', () => {
    expect(flagEnabled(KEY, false)).toBe(false);
  });

  it('is off only for a falsy word (case/space tolerant)', () => {
    for (const v of ['0', 'false', 'FALSE', 'off', 'No', ' false ']) {
      process.env[KEY] = v;
      expect(flagEnabled(KEY)).toBe(false);
    }
  });

  it('is on for any other value', () => {
    for (const v of ['1', 'true', 'yes', 'on', 'anything']) {
      process.env[KEY] = v;
      expect(flagEnabled(KEY)).toBe(true);
    }
  });
});
