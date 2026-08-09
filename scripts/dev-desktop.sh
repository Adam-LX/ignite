#!/usr/bin/env bash
# Ignite — pełnoekranowa aplikacja Electron (nie karta przeglądarki).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export IGNITE_DEV=1
export IGNITE_VITE_URL="${IGNITE_VITE_URL:-http://127.0.0.1:5173}"

cleanup() {
	[[ -n "${VITE_PID:-}" ]] && kill "$VITE_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Ignite desktop — Vite @ ${IGNITE_VITE_URL}"

free_stale_dev_port() {
	local holder=""
	holder="$(
		ss -tlnp 'sport = :5173' 2>/dev/null |
			sed -n 's/.*pid=\([0-9]*\).*/\1/p' |
			head -1
	)"
	[[ -n "$holder" ]] || return 0
	# Zostaw tylko vite uruchomiony przez ten skrypt (VITE_PID).
	if [[ -n "${VITE_PID:-}" && "$holder" == "$VITE_PID" ]]; then
		return 0
	fi
	echo "Zwalniam stary Vite na :5173 (pid=$holder)…"
	kill "$holder" 2>/dev/null || true
	for _ in $(seq 1 15); do
		if ! ss -tlnp 'sport = :5173' 2>/dev/null | grep -q .; then
			return 0
		fi
		sleep 0.2
	done
	kill -9 "$holder" 2>/dev/null || true
}

free_stale_dev_port

if ! curl -sf "${IGNITE_VITE_URL}" >/dev/null 2>&1; then
	echo "Start Vite dev server…"
	npm run dev &
	VITE_PID=$!
	for _ in $(seq 1 90); do
		if curl -sf "${IGNITE_VITE_URL}" >/dev/null 2>&1; then
			break
		fi
		sleep 0.25
	done
	if ! curl -sf "${IGNITE_VITE_URL}" >/dev/null 2>&1; then
		echo "Vite nie wystartował na ${IGNITE_VITE_URL}" >&2
		exit 1
	fi
else
	echo "Vite już działa @ ${IGNITE_VITE_URL}"
fi

exec bash "$ROOT/scripts/run-electron.sh"
