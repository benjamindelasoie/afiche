#!/usr/bin/env bash
#
# seed-cinemas-prod.sh — upsert the cinemas seed against the production Turso
# DB. Idempotent (INSERT ... ON CONFLICT DO NOTHING), so safe to re-run.
#
# Why this exists: src/db/seed-cinemas.ts reads DATABASE_URL from .env.local,
# which points at the local SQLite file in dev. To seed prod, we override
# DATABASE_URL to the Turso URL — same pattern as scrape-prod.sh.
#
# Run this any time a new cinema gets added to seed-cinemas.ts. Without it,
# the next prod scrape will fail with a FOREIGN KEY constraint when it tries
# to insert a scrape_runs / providers row referencing the new cinema id.

set -euo pipefail

TURSO_URL='libsql://afiche-benjamindelasoie.aws-us-east-1.turso.io'

ENV_FILE="$(dirname "$0")/../.env.local"
if [ ! -f "$ENV_FILE" ]; then
  echo "error: .env.local not found at $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

export DATABASE_URL="$TURSO_URL"

if [ -z "${DATABASE_AUTH_TOKEN:-}" ]; then
  echo "error: DATABASE_AUTH_TOKEN is empty or unset in .env.local" >&2
  exit 1
fi

echo "🌱 Seeding cinemas against Turso prod..."
echo
npx tsx src/db/seed-cinemas.ts
