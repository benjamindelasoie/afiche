import { describe, it, expect } from 'vitest';
import { venueCity } from './venue-city';

describe('venueCity', () => {
  it('treats a BA barrio, or no neighborhood, as Buenos Aires', () => {
    expect(venueCity('Palermo')).toBe('Buenos Aires');
    expect(venueCity('Munro')).toBe('Buenos Aires');
    expect(venueCity(null)).toBe('Buenos Aires');
  });

  it('returns the city itself for a sala outside Buenos Aires', () => {
    // Without this the Maps link searched "Santa Fe 1120 … Buenos Aires".
    expect(venueCity('Rosario')).toBe('Rosario');
  });
});
