import { describe, it, expect } from 'vitest';
import { WEEKLY_RUN_CINEMAS, isWeeklyRunVenue } from './venue-agenda-style';

describe('venue agenda style', () => {
  it('marks exactly the fixed-weekly commercial venues', () => {
    expect([...WEEKLY_RUN_CINEMAS].sort()).toEqual(['cine-cosmos', 'lorca']);
  });

  it('isWeeklyRunVenue is true for the set, false otherwise', () => {
    expect(isWeeklyRunVenue('lorca')).toBe(true);
    expect(isWeeklyRunVenue('cine-cosmos')).toBe(true);
    expect(isWeeklyRunVenue('malba')).toBe(false);
    expect(isWeeklyRunVenue('lugones')).toBe(false);
    expect(isWeeklyRunVenue('')).toBe(false);
  });
});
