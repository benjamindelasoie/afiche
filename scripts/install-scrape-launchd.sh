#!/usr/bin/env bash
#
# install-scrape-launchd.sh — install/reload a macOS LaunchAgent that runs
# scrape-cron.sh on a schedule (09:00 + 18:00 local time), catching up on wake.
# Idempotent: re-run any time to update. Uninstall command printed at the end.
#
# Why launchd and not cron: launchd reruns a missed StartCalendarInterval when
# the Mac WAKES — cron just skips any job that was scheduled while the laptop
# was asleep. (A full *shutdown's* missed run isn't replayed; boot the Mac and
# the wrapper's staleness guard makes the next run scrape. An always-on machine,
# e.g. a Mac mini, closes that last gap with zero changes to these files.)
#
# PUBLIC-REPO SAFE: no secrets; all paths derived from $HOME + the repo at runtime.

set -euo pipefail

[ "$(uname)" = "Darwin" ] || { echo "macOS only (uses launchd)."; exit 1; }

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRAPPER="$REPO_DIR/scripts/scrape-cron.sh"
chmod +x "$WRAPPER" "$REPO_DIR/scripts/install-scrape-launchd.sh" 2>/dev/null || true

LABEL="ar.afiche.scrape"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
OUT_LOG="$REPO_DIR/.scrape-cron.out.log"
UID_NUM="$(id -u)"

mkdir -p "$HOME/Library/LaunchAgents"

cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$WRAPPER</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>18</integer><key>Minute</key><integer>0</integer></dict>
  </array>
  <key>StandardOutPath</key><string>$OUT_LOG</string>
  <key>StandardErrorPath</key><string>$OUT_LOG</string>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
</dict>
</plist>
PLIST

# bootout the old one first so this is idempotent, then bootstrap + enable.
launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$PLIST"
launchctl enable "gui/$UID_NUM/$LABEL" 2>/dev/null || true

echo "✓ Installed LaunchAgent '$LABEL'"
echo "  schedule : 09:00 + 18:00 local, catches up on wake"
echo "  wrapper  : $WRAPPER"
echo "  plist    : $PLIST"
echo "  logs     : $REPO_DIR/.scrape-cron.log   (launchd stdout/err: $OUT_LOG)"
echo
echo "Run once now : launchctl kickstart -k gui/$UID_NUM/$LABEL"
echo "Status       : launchctl print gui/$UID_NUM/$LABEL | grep -iE 'state|last exit'"
echo "Uninstall    : launchctl bootout gui/$UID_NUM/$LABEL && rm \"$PLIST\""
