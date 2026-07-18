#!/usr/bin/env bash
# Audyt chase w Electron (CDP) — start → sample → kill.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
OUT="$ROOT/test-results/chase-camera"
mkdir -p "$OUT"
LOG=/tmp/ignite-electron-audit.log
: >"$LOG"

if ! curl -sf "http://127.0.0.1:5173/" >/dev/null; then
	echo "Vite nie działa na :5173" >&2
	exit 2
fi

# IGNITE_WINDOWED=1 → 1600×900 (stabilny audyt)
# IGNITE_WINDOWED=0 → maximize (domyślny desktop, bez exclusive FS)
# IGNITE_FULLSCREEN=1 → exclusive FS (Wayland: często psuje WebGL)
IGNITE_DEV=1 \
IGNITE_WINDOWED="${IGNITE_WINDOWED:-1}" \
IGNITE_VITE_URL='http://127.0.0.1:5173/?autostart=1v1' \
	nix shell nixpkgs#electron -c electron . --no-sandbox --remote-debugging-port=9222 \
	>>"$LOG" 2>&1 &
EPID=$!
cleanup() { kill "$EPID" 2>/dev/null || true; }
trap cleanup EXIT

echo "[electron-audit] waiting for match live (pid=$EPID, windowed=${IGNITE_WINDOWED:-1}, fs=${IGNITE_FULLSCREEN:-0})…"
ok=0
for i in $(seq 1 90); do
	if grep -q 'match live' "$LOG" 2>/dev/null; then
		ok=1
		break
	fi
	if ! kill -0 "$EPID" 2>/dev/null; then
		echo "[electron-audit] Electron zmarł przed match live" >&2
		tail -30 "$LOG" >&2
		exit 2
	fi
	sleep 0.5
done
if [[ "$ok" -ne 1 ]]; then
	echo "[electron-audit] timeout" >&2
	tail -30 "$LOG" >&2
	exit 2
fi

sleep 2
node scripts/audit-chase-camera.mjs --target=electron --path=autostart
code=$?
exit "$code"
