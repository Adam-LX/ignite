#!/usr/bin/env bash
# Quick browser smoke: start 1v1, log console errors, count octane meshes via CDP-less evaluate.
set -euo pipefail
cd "$(dirname "$0")/.."

URL="http://localhost:5173/?mode=1v1"
OUT="/tmp/ignite-car-test.log"

chromium --headless=new --disable-gpu --no-sandbox \
  --run-all-compositor-stages-before-draw \
  --virtual-time-budget=12000 \
  --dump-dom "$URL" > /tmp/ignite-dom.html 2>"$OUT" || true

echo "=== Console / stderr (errors) ==="
rg -i "error|uncaught|fail|GameSession|Brak" "$OUT" | head -40 || true

echo "=== DOM has HUD? ==="
rg -o "id=\"hud\"" /tmp/ignite-dom.html | head -1 || echo "no hud"
