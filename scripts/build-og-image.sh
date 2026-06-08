#!/usr/bin/env bash
# Renders scripts/og-image.html → src/app/opengraph-image.png at 1200×630
# using headless Chrome. Run on demand if the masthead/wordmark changes.
#
# Why a generator script and not a hand-edited PNG: the design lives in
# scripts/og-image.html as text, so it stays in version control and
# anyone can regenerate it. Why static and not next/og's ImageResponse:
# the OG image only needs to reflect brand identity, not the dynamic
# edition number — keeping it static avoids per-request rendering and
# the runtime font/asset plumbing ImageResponse needs.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
html="$repo_root/scripts/og-image.html"
out="$repo_root/src/app/opengraph-image.png"

if [[ ! -f "$html" ]]; then
  echo "missing $html" >&2
  exit 1
fi

chrome=""
for c in google-chrome chromium chromium-browser; do
  if command -v "$c" >/dev/null 2>&1; then
    chrome="$c"
    break
  fi
done
# Fallback: macOS ships Chrome as an app bundle, not on PATH under those names.
if [[ -z "$chrome" ]]; then
  for p in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
    if [[ -x "$p" ]]; then
      chrome="$p"
      break
    fi
  done
fi
if [[ -z "$chrome" ]]; then
  echo "no chrome/chromium binary found (PATH or macOS app bundle)" >&2
  exit 1
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

"$chrome" \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --hide-scrollbars \
  --window-size=1200,630 \
  --virtual-time-budget=10000 \
  --user-data-dir="$tmpdir" \
  --screenshot="$out" \
  "file://$html" >/dev/null 2>&1

if [[ ! -f "$out" ]]; then
  echo "screenshot failed; no file at $out" >&2
  exit 1
fi

echo "wrote $out ($(wc -c <"$out") bytes)"
