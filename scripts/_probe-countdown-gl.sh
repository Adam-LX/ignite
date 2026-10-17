#!/usr/bin/env bash
# Start windowed Electron + force-render GL probe during countdown.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
LOG=/tmp/ignite-electron-cdp.log
: >"$LOG"

# Don't kill unrelated electrons aggressively — only our port if held
if curl -sf http://127.0.0.1:9333/json/version >/dev/null 2>&1; then
  echo "CDP 9333 already in use — abort" >&2
  exit 2
fi

IGNITE_DEV=1 IGNITE_WINDOWED=1 \
IGNITE_VITE_URL="http://127.0.0.1:5173/?skipIntro=1&ignite=$(date +%s)" \
  nix shell nixpkgs#electron -c electron . --no-sandbox --class=Ignite --remote-debugging-port=9333 \
  >>"$LOG" 2>&1 &
EPID=$!
cleanup() { kill "$EPID" 2>/dev/null || true; }
trap cleanup EXIT

for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:9333/json/list 2>/dev/null | grep -q webSocketDebuggerUrl; then
    break
  fi
  sleep 0.4
done

node "$ROOT/scripts/_probe-countdown-gl-inner.mjs"
