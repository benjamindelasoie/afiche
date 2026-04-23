#!/usr/bin/env bash
#
# scrape-prod.sh — run the Afiche scraper from this (residential-IP) machine
# against the production Turso DB, then revalidate the Vercel deployment so
# fresh data lands on afiche.vercel.app.
#
# Why this exists: lumiton.ar and complejoteatral.gob.ar block GitHub Actions
# runner IPs (datacenter reputation). Scraping from a residential IP sidesteps
# that. Until we set up a proper proxy (CF Worker, etc.), this is the reliable
# way to refresh prod data.
#
# Reads DATABASE_AUTH_TOKEN, TMDB_API_TOKEN, REVALIDATE_SECRET from .env.local
# (gitignored). DATABASE_URL is overridden to the Turso URL because
# .env.local's DATABASE_URL points at the local SQLite file for dev.
#
# Invoke via `npm run scrape:prod` (preferred) so Node version + PATH match
# what the rest of the repo expects.

set -euo pipefail

# ---------------------------------------------------------------------------
# Prod endpoints — public, safe to hardcode
# ---------------------------------------------------------------------------
TURSO_URL='libsql://afiche-benjamindelasoie.aws-us-east-1.turso.io'
SITE_URL='https://afiche.vercel.app'

# ---------------------------------------------------------------------------
# Load secrets from .env.local (same file the dev workflow uses)
# ---------------------------------------------------------------------------
ENV_FILE="$(dirname "$0")/../.env.local"
if [ ! -f "$ENV_FILE" ]; then
  echo "error: .env.local not found at $ENV_FILE" >&2
  exit 1
fi

# set -a auto-exports every variable assignment that follows. set +a turns it
# off again so we don't pollute the rest of the shell.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# Point at prod Turso, not the local SQLite file from .env.local.
export DATABASE_URL="$TURSO_URL"

# ---------------------------------------------------------------------------
# Sanity check — fail loudly if any secret is missing rather than running with
# a broken auth token and getting a cryptic error 45 seconds in.
# ---------------------------------------------------------------------------
for var in DATABASE_AUTH_TOKEN TMDB_API_TOKEN REVALIDATE_SECRET; do
  if [ -z "${!var:-}" ]; then
    echo "error: $var is empty or unset in .env.local" >&2
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# Step 1 — run the scraper
# ---------------------------------------------------------------------------
echo "🎞  Scraping against Turso prod..."
echo
npx tsx src/scrapers/run.ts
SCRAPE_EXIT=$?

# npx tsx exits non-zero if ANY provider failed. With the current datacenter-IP
# block on GitHub Actions, expect 5/5 ok from residential but be defensive.
if [ "$SCRAPE_EXIT" -ne 0 ]; then
  echo
  echo "⚠  Scraper exited non-zero. Revalidating anyway so partial updates"
  echo "   land on the site — some providers may have succeeded."
fi

# ---------------------------------------------------------------------------
# Step 2 — revalidate the Vercel cache so fresh data is visible immediately
# ---------------------------------------------------------------------------
echo
echo "🔄 Revalidating $SITE_URL..."
if curl -fsS -X POST \
  -H "X-Revalidate-Secret: $REVALIDATE_SECRET" \
  "$SITE_URL/api/revalidate"; then
  echo
  echo "✓ Cache revalidated."
else
  echo
  echo "⚠  Revalidate call failed. The scrape may have landed in Turso but"
  echo "   visitors will see the old cached page until next natural eviction."
  exit 1
fi

echo
echo "Done. Check https://afiche.vercel.app to verify."
