/**
 * Which city a sala is in. There is no `cinemas.city` column: every venue was
 * in Buenos Aires until El Cairo (Rosario), whose city rides in
 * `neighborhood` until the product decides how a non-BA sala is presented.
 * A neighborhood listed here IS the city; anything else is a BA barrio.
 */

const BA_CITY = 'Buenos Aires';

const CITIES_OUTSIDE_BA = new Set(['Rosario']);

export function venueCity(neighborhood: string | null | undefined): string {
  return neighborhood && CITIES_OUTSIDE_BA.has(neighborhood) ? neighborhood : BA_CITY;
}
