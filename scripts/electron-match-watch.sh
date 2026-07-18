#!/usr/bin/env bash
# Uruchom Electron z autostartem i zrzucaj stan kickoff co 2s (diagnoza IGNITE crash).
set -euo pipefail
cd "$(dirname "$0")/.."

export IGNITE_BOOT_DEBUG=1
export IGNITE_AUTOSTART="${IGNITE_AUTOSTART:-1v1}"

nix shell nixpkgs#electron -c electron . --no-sandbox &
EPID=$!
sleep 8

for i in $(seq 1 20); do
	sleep 2
	if ! kill -0 "$EPID" 2>/dev/null; then
		echo "[$i] Electron zakończył się (PID $EPID)"
		break
	fi
	echo "--- poll $i ---"
done

kill "$EPID" 2>/dev/null || true
wait "$EPID" 2>/dev/null || true
