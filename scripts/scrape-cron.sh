#!/usr/bin/env bash
#
# scrape-cron.sh — launchd-friendly wrapper around `npm run scrape:prod`.
#
# Runs the prod scrape on a schedule (install via scripts/install-scrape-launchd.sh),
# built to survive a laptop that sleeps:
#   - resolves node via nvm ITSELF — launchd runs with a bare environment, so we
#     can't rely on the shell profile having put node on PATH,
#   - pulls main before every run (plus `npm ci` / `db:migrate:prod` when the
#     lockfile or migrations moved), so the box can't drift behind shipped
#     scraper fixes the way it did through July 2026,
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

# Must be SHORTER than the gap between scheduled runs, or the later run is
# dead code. The plist fires at 09:00 and 18:00 — a 9h gap — so the old
# default of 12 made the 18:00 run skip every single day while the schedule
# advertised twice-daily. 8 lets both fire (9h and 15h both clear it) while
# still coalescing incidental wake-ups, which is what the guard is for.
STALE_HOURS="${AFICHE_SCRAPE_STALE_HOURS:-8}"
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

# --- sync source -----------------------------------------------------------
# Pull main before scraping so the box always runs the shipped scraper.
#
# Why this exists: on 2026-07-27 this checkout was found pinned at v0.3.7.3
# while main was v0.3.9.0 — two releases of provider/matcher fixes that only
# ever execute HERE (Vercel renders, it doesn't scrape) had never run. The
# deploy story covered the website and quietly skipped the box doing the work.
#
# Failure posture: a pull failure NOTIFIES but does not abort. Scraping with
# last-known-good code beats not scraping at all — stale data is the worse
# outcome (see the 7-day silent gap in the same investigation). The one thing
# we refuse to do is fail silently, which is what got us here.
if command -v git >/dev/null 2>&1 && [ -d "$REPO_DIR/.git" ]; then
  before=$(git rev-parse HEAD 2>/dev/null || echo unknown)
  if git fetch --quiet origin main 2>>"$LOG" &&
     git merge --ff-only --quiet origin/main 2>>"$LOG"; then
    after=$(git rev-parse HEAD 2>/dev/null || echo unknown)
    if [ "$before" != "$after" ]; then
      log "pulled main: ${before:0:8} → ${after:0:8}"

      # New/changed deps — node_modules must match the lockfile or the
      # scrape fails on a missing import. Only when the lockfile moved.
      if ! git diff --quiet "$before" "$after" -- package-lock.json 2>/dev/null; then
        log "package-lock.json changed; running npm ci"
        npm ci >>"$LOG" 2>&1 ||
          { log "npm ci FAILED"; notify "⚠️ afiche: npm ci failed after pull"; }
      fi

      # Pending schema migrations — apply BEFORE scraping. Code that expects
      # a column prod doesn't have crashes mid-run; drizzle's journal makes
      # this a no-op when there's nothing new.
      if ! git diff --quiet "$before" "$after" -- drizzle 2>/dev/null; then
        log "drizzle migrations changed; applying to prod"
        if npm run db:migrate:prod >>"$LOG" 2>&1; then
          log "migrations applied"
        else
          log "MIGRATION FAILED — aborting scrape (schema/code mismatch)"
          notify "⚠️ afiche: prod migration failed. Scrape aborted to avoid a schema/code mismatch. tail $LOG"
          exit 1
        fi
      fi
    else
      log "already up to date (${after:0:8})"
    fi
  else
    log "git pull FAILED (local edits, or origin unreachable) — scraping with existing code"
    notify "⚠️ afiche: couldn't pull main on the scrape box; running possibly-stale scraper code"
  fi
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
