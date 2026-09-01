/**
 * Database barrel — re-exports everything you need from `@/db`.
 *
 *   import { db, cinemas, films, screenings, providers, TAG_LABELS_ES } from '@/db';
 */

export { db } from './client';
export type { Database } from './client';
export {
  cinemas,
  films,
  screenings,
  providers,
  scrapeRuns,
  tmdbOverrides,
  TAG_LABELS_ES,
  GENRE_LABELS_ES,
} from './schema';
export type {
  Cinema,
  CinemaInsert,
  Film,
  FilmInsert,
  Screening,
  ScreeningInsert,
  Provider,
  ProviderInsert,
  ScrapeRun,
  ScrapeRunInsert,
  ScreeningTag,
  TmdbOverride,
  TmdbOverrideInsert,
} from './schema';
