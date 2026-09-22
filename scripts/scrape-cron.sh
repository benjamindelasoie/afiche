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
#   - preflights DNS before doing anything that needs the network, because a
#     dead resolver is the one failure that makes every other error message lie,
#   - logs to .scrape-cron.log,
#   - pings on FAILURE *and on ABSENCE*: a macOS notification AND (if configured)
#     a Telegram message, so a silent stale-out becomes a visible one even when
#     you're away. The Telegram path deliberately does not depend on the system
#     resolver — see notify().
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
    # --doh-url resolves api.telegram.org itself, over HTTPS, addressed by IP
    # literal (1.1.1.1) — it never touches the system resolver. Deliberate:
    # the 2026-09-15 outage was the system resolver dying, so a notify() that
    # also depends on it can't be trusted to report the failure it exists to
    # report. Falls back to the system resolver if this curl is too old for
    # --doh-url (harmless — that's just today's behavior).
    curl -fsS --max-time 15 --doh-url https://1.1.1.1/dns-query \
      "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=$1" >/dev/null 2>&1 ||
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
# Homebrew's bin dirs are ALWAYS added, not just as a node fallback: launchd's
# bare env means gh (needed by actor2:fix:prod) is invisible otherwise even
# when nvm already supplied node — this was `spawn gh ENOENT` on every run.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  log "node not found on PATH; cannot scrape"
  notify "⚠️ afiche scrape couldn't start: node not found"
  exit 1
fi

# --- DNS preflight -----------------------------------------------------------
# A dead system resolver makes every subsequent step fail with a different,
# misleading error (git fetch "origin unreachable", 12 separate scraper
# "fetch failed" stack traces, self-heal, actor2) instead of one clear one.
# Root-caused 2026-09-21: this box's resolver #1 (100.100.100.100, Tailscale
# MagicDNS) stopped answering on 2026-09-15; every DB/network call failed
# with ENOTFOUND for a week before anyone noticed (see notify() above for
# why the alert itself didn't fire). Check once, up front, and bail loud.
if command -v dig >/dev/null 2>&1; then
  DNS_PROBE_HOST="${AFICHE_DNS_PROBE_HOST:-github.com}"
  if ! dig +short +time=3 +tries=1 "$DNS_PROBE_HOST" 2>/dev/null | grep -q .; then
    log "DNS PREFLIGHT FAILED: system resolver can't resolve $DNS_PROBE_HOST — aborting before scrape (avoids a wall of misleading 'fetch failed' errors downstream)"
    notify "⚠️ afiche: DNS is broken on the scrape box (can't resolve $DNS_PROBE_HOST). Scrape aborted before it started — check the Tailscale MagicDNS resolver / networksetup -getdnsservers."
    exit 1
  fi
else
  log "dig not found; skipping DNS preflight"
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
#
# GIT_BIN: /usr/bin/git is Apple's shim — if Xcode's license was never
# accepted (this box, since 2026-09-15) it refuses to run at all and every
# call below silently looks like "origin unreachable", masking the real
# cause. The Command Line Tools ship a real git for the same reason; prefer
# it when the shim is blocked.
GIT_BIN="git"
if ! git --version >/dev/null 2>&1; then
  if [ -x /Library/Developer/CommandLineTools/usr/bin/git ] &&
     /Library/Developer/CommandLineTools/usr/bin/git --version >/dev/null 2>&1; then
    GIT_BIN="/Library/Developer/CommandLineTools/usr/bin/git"
    log "system git blocked (Xcode license not accepted?) — using CommandLineTools git instead"
  else
    log "git unusable (system git blocked and no working CommandLineTools git found)"
  fi
fi

if command -v "$GIT_BIN" >/dev/null 2>&1 && [ -d "$REPO_DIR/.git" ]; then
  before=$("$GIT_BIN" rev-parse HEAD 2>/dev/null || echo unknown)
  if "$GIT_BIN" fetch --quiet origin main 2>>"$LOG" &&
     "$GIT_BIN" merge --ff-only --quiet origin/main 2>>"$LOG"; then
    after=$("$GIT_BIN" rev-parse HEAD 2>/dev/null || echo unknown)
    if [ "$before" != "$after" ]; then
      log "pulled main: ${before:0:8} → ${after:0:8}"

      # New/changed deps — node_modules must match the lockfile or the
      # scrape fails on a missing import. Only when the lockfile moved.
      if ! "$GIT_BIN" diff --quiet "$before" "$after" -- package-lock.json 2>/dev/null; then
        log "package-lock.json changed; running npm ci"
        npm ci >>"$LOG" 2>&1 ||
          { log "npm ci FAILED"; notify "⚠️ afiche: npm ci failed after pull"; }
      fi

      # Pending schema migrations — apply BEFORE scraping. Code that expects
      # a column prod doesn't have crashes mid-run; drizzle's journal makes
      # this a no-op when there's nothing new.
      if ! "$GIT_BIN" diff --quiet "$before" "$after" -- drizzle 2>/dev/null; then
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
  scrape_rc=0
  log "scrape OK"
else
  scrape_rc=$?
  log "scrape FAILED (exit $scrape_rc)"
  notify "⚠️ afiche scrape failed (exit $scrape_rc) — data may be going stale. tail $LOG"
fi

# scrape:prod exits non-zero on ANY provider failure, even when most of them
# succeeded — right for the exit code (a partial run deserves the FAILED log
# line and the notify above) but wrong for the staleness guard, which only
# cares whether fresh screenings actually landed. Without this the guard was
# dead from 2026-07-31 onward: most runs before the 09-15 outage landed
# 10/12 providers but still exited non-zero, so STAMP never advanced.
providers_ok=$(grep -o 'Done\. [0-9]\+/[0-9]\+ providers ok\.' "$LOG" | tail -1 | grep -o '^Done\. [0-9]\+' | grep -o '[0-9]\+$')
if [ -n "${providers_ok:-}" ] && [ "$providers_ok" -gt 0 ] 2>/dev/null; then
  date +%s >"$STAMP"
  [ "$scrape_rc" -eq 0 ] || log "partial success ($providers_ok providers ok) — staleness stamp updated despite exit $scrape_rc"
fi

# --- self-heal -------------------------------------------------------------
# Runs after EVERY scrape, pass OR fail — a failed/empty run is exactly what
# the audit needs to see. Best-effort: it judges the unmatched tail, auto-applies
# the corroborated matches, and Telegrams a digest, but it NEVER changes the
# scrape's exit code (a broken heal must not mask or fail the scrape).
log "starting self-heal"
if npm run db:self-heal:prod -- --write >>"$LOG" 2>&1; then
  log "self-heal OK"
else
  log "self-heal FAILED (exit $?) — non-fatal, scrape result stands"
fi

# --- Actor 2 (open a fix PR) -----------------------------------------------
# After self-heal files matcher-pattern issues, prepare the fix for the first
# ready-for-agent (mechanical container) one as a PR for a HUMAN to review and
# merge — Actor 2 never merges, and is idempotent (skips if a PR already exists).
# Runs in a throwaway worktree, so it never disturbs THIS checkout's branch.
# Best-effort and never changes the scrape's exit code.
log "starting actor2 (open fix PR)"
if npm run actor2:fix:prod >>"$LOG" 2>&1; then
  log "actor2 OK"
else
  log "actor2 FAILED (exit $?) — non-fatal, scrape result stands"
fi

exit "$scrape_rc"
