#!/usr/bin/env bash
# Renders scripts/app-icon.html (carmine field + cream Instrument Serif "a")
# via headless Chrome, then downscales with sharp to the app-icon set:
#   src/app/apple-icon.png   180×180  → <link rel="apple-touch-icon"> (iOS home screen)
#   public/icon-192.png      192×192  → web manifest icon (Android / PWA)
#   public/icon-512.png      512×512  → web manifest icon + maskable
# Run on demand if the wordmark/brand changes. Sibling of build-og-image.sh.
#
# Why Chrome and not the SVG favicon: SVG favicons can't reliably load web
# fonts, so src/app/icon.svg falls back to Times. A rasterized PNG can use
# the real Instrument Serif, so the home-screen glyph matches the masthead
# wordmark exactly. Why render once at 1024 then downscale: a single
# high-res master gives crisp antialiasing at every emitted size.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
html="$repo_root/scripts/app-icon.html"

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
master="$tmpdir/master.png"

"$chrome" \
  --headless=new \
  --no-sandbox \
  --disable-gpu \
  --hide-scrollbars \
  --window-size=1024,1024 \
  --virtual-time-budget=10000 \
  --user-data-dir="$tmpdir" \
  --screenshot="$master" \
  "file://$html" >/dev/null 2>&1

if [[ ! -f "$master" ]]; then
  echo "screenshot failed; no master at $master" >&2
  exit 1
fi

node - "$master" "$repo_root" <<'NODE'
const sharp = require('sharp');
const [master, root] = process.argv.slice(2);
const targets = [
  [180, `${root}/src/app/apple-icon.png`],
  [192, `${root}/public/icon-192.png`],
  [512, `${root}/public/icon-512.png`],
];
Promise.all(
  targets.map(([size, out]) =>
    sharp(master)
      .resize(size, size)
      .png()
      .toFile(out)
      .then(() => console.log(`wrote ${out} (${size}×${size})`)),
  ),
).catch((e) => {
  console.error(e);
  process.exit(1);
});
NODE
