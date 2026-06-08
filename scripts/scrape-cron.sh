#!/usr/bin/env bash
#
# scrape-cron.sh — launchd-friendly wrapper around `npm run scrape:prod`.
#
# Runs the prod scrape on a schedule (install via scripts/install-scrape-launchd.sh),
# built to survive a laptop that sleeps:
#   - resolves node via nvm ITSELF — launchd runs with a bare environment, so we
#     can't rely on the shell profile having put node on PATH,
#   - staleness guard: skips if a scrape already succeeded in the last STALE_HOURS,
#     so frequent wake-ups don't re-scrape and a just-woken Mac still catches up,
#   - logs to .scrape-cron.log,
#   - pings on FAILURE: a macOS notification AND (if configured) a Telegram
#     message, so a silent stale-out becomes a visible one even when you're away.
#
# PUBLIC-REPO SAFE: there are no secrets in this file. The Telegram bot token +
# chat id are read from .env.prod (gitignored) as TELEGRAM_BOT_TOKEN /
# TELEGRAM_CHAT_ID; if they're absent, the Telegram step is skipped silently.
# Every path is derived at runtime from $HOME and the repo location.

set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR" || exit 1

STALE_HOURS="${AFICHE_SCRAPE_STALE_HOURS:-12}"
STAMP="$REPO_DIR/.scrape-last-success"   # gitignored; updated on success
LOG="$REPO_DIR/.scrape-cron.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >>"$LOG" 2>/dev/null; }

# --- optional env (Telegram creds) from .env.prod --------------------------
if [ -f "$REPO_DIR/.env.prod" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$REPO_DIR/.env.prod"
  set +a
fi

notify() { # notify "<message>"
  command -v osascript >/dev/null 2>&1 &&
    osascript -e "display notification \"$1\" with title \"afiche scrape\"" >/dev/null 2>&1 || true
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    curl -fsS --max-time 15 \
      "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=$1" >/dev/null 2>&1 || true
  fi
}

# --- staleness guard -------------------------------------------------------
if [ -f "$STAMP" ]; then
  age=$(( $(date +%s) - $(stat -f %m "$STAMP" 2>/dev/null || echo 0) ))
  if [ "$age" -lt $(( STALE_HOURS * 3600 )) ]; then
    log "skip: last success ${age}s ago (< ${STALE_HOURS}h)"
    exit 0
  fi
fi

# --- resolve node via nvm (launchd env is bare; don't trust the profile) ---
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
  nvm use >/dev/null 2>&1 || true   # reads the repo's .nvmrc (Node 22)
fi
command -v node >/dev/null 2>&1 || export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  log "node not found on PATH; cannot scrape"
  notify "⚠️ afiche scrape couldn't start: node not found"
  exit 1
fi

# --- run -------------------------------------------------------------------
log "starting scrape:prod (node $(node --version))"
if npm run scrape:prod >>"$LOG" 2>&1; then
  date +%s >"$STAMP"
  log "scrape OK"
else
  rc=$?
  log "scrape FAILED (exit $rc)"
  notify "⚠️ afiche scrape failed (exit $rc) — data may be going stale. tail $LOG"
  exit "$rc"
fi
