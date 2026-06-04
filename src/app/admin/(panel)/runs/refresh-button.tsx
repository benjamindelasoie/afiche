'use client';

import { refreshEnrichmentAction } from './actions';

/**
 * Confirm-guarded submit button for the Refresh action. Client component
 * only so window.confirm gates submission — the rest of /admin/runs stays
 * server-rendered.
 */
export function RefreshButton() {
  return (
    <form action={refreshEnrichmentAction}>
      <button
        type="submit"
        className="rounded border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
        onClick={(e) => {
          if (
            !window.confirm(
              'Refresh enrichment re-fetches TMDB for every matched film (one call per row at 100ms throttle, ~1-2 minutes on the full catalog). Continue?',
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        Refresh enrichment
      </button>
    </form>
  );
}
