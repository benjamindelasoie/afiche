/**
 * Provider interface — each cinema implements one Provider.
 *
 * A Provider fetches its cinema's current programming and returns a flat list
 * of scraped screenings. It does NOT touch the DB; that's the ingest layer's
 * job. The provider is pure: (network) -> ScrapedScreening[].
 */

import type { ScreeningTag } from '@/db';

export interface ScrapedScreening {
  /** Matches cinemas.id in the DB (e.g. 'lugones', 'malba'). */
  cinemaId: string;
  /** Raw title as it appeared on the source page. Preserved verbatim. */
  filmTitle: string;
  /** Original-language title when available (e.g. "Son of Frankenstein"). */
  filmTitleOriginal?: string;
  director?: string;
  year?: number;
  country?: string;
  runtimeMin?: number;
  /** Always UTC. Provider converts local BA time to UTC before emitting. */
  startsAtUtc: Date;
  tags: ScreeningTag[];
  /** Optional synopsis — for indie-featured rendering. */
  synopsisEs?: string;
  /** Back-link to the cinema page where this screening is described. */
  sourceUrl: string;
  /**
   * Optional per-film URL distinct from sourceUrl. Set when sourceUrl points
   * at a parent context (e.g. a MALBA cycle page) but the film also has a
   * dedicated page worth fetching for richer metadata. Used by enrichers
   * that want a film-level synopsis without disturbing the cycle-anchored
   * sourceUrl that the UI links to.
   */
  filmDetailUrl?: string;
}

export interface ProviderRunResult {
  cinemaId: string;
  screenings: ScrapedScreening[];
  /** True if the fetch/parse completed with no fatal errors. */
  success: boolean;
  /** Non-fatal issues (e.g. a day with unparseable times). */
  warnings: string[];
  /** Fatal error if the whole run failed. */
  error?: string;
}

export interface Provider {
  /** Matches cinemas.id in the DB. */
  readonly id: string;
  /** Human-readable name for logs. */
  readonly name: string;
  /** Fetch programming and return the scraped list. Must not throw; errors go in the result. */
  fetch(): Promise<ProviderRunResult>;
}
