#!/usr/bin/env bash
# Test kickoff v0.0.2 — Electron autostart 1v1, zrzut stanu po ~12s.
set -euo pipefail
cd "$(dirname "$0")/.."

[[ -f dist/index.html ]] || { echo "Brak dist/ — uruchom: ./run-desktop.sh --fresh" >&2; exit 1; }

export IGNITE_AUTOSTART=1v1
export IGNITE_BOOT_DEBUG=1
export ELECTRON_ENABLE_LOGGING=1

LOG=$(mktemp /tmp/ignite-kickoff-XXXX.log)
echo "Log: $LOG"

nix shell nixpkgs#electron -c electron . --no-sandbox >"$LOG" 2>&1 &
EPID=$!

cleanup() {
	kill "$EPID" 2>/dev/null || true
	wait "$EPID" 2>/dev/null || true
}
trap cleanup EXIT

echo "Czekam 14s na kickoff (3…2…1 → IGNITE → JAZDA)…"
sleep 14

if ! kill -0 "$EPID" 2>/dev/null; then
	echo "FAIL — Electron umarł przed końcem testu"
	echo "--- ostatnie 40 linii logu ---"
	tail -40 "$LOG"
	exit 1
fi

if rg -a 'useProgram: program not valid|WebGL.*error' "$LOG" >/dev/null 2>&1; then
	echo "FAIL — błędy WebGL w logu"
	rg -a 'useProgram|WebGL.*error' "$LOG" | head -5
	exit 1
fi

echo "OK — Electron żyje po 14s, brak błędów WebGL shader"
echo "--- [Boot]/[Match]/[renderer] ---"
rg '\[Boot\]|\[Match\]|\[renderer\]|\[Ignite\]|error|WebGL|crash' "$LOG" || true

echo ""
echo "Zamykam…"
exit 0
