#!/usr/bin/env bash
# Ignite desktop na NixOS — electron z nixpkgs (nie AppImage; na Nixie .run nie działa).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ -f data/mp-public-endpoint.env ]]; then
	# shellcheck disable=SC1091
	source data/mp-public-endpoint.env
	export IGNITE_MP_SERVER VITE_IGNITE_MP_SERVER
	# Zaktualizuj endpoint w buildzie (gracze nie ustawiają env)
	if [[ -n "${IGNITE_MP_SERVER:-}" ]]; then
		printf '%s\n' "{\"server\":\"${IGNITE_MP_SERVER}\"}" >public/mp-endpoint.json
		[[ -f dist/mp-endpoint.json ]] && cp public/mp-endpoint.json dist/mp-endpoint.json
	fi
fi

MP_PID=""
MP_STARTED_HERE=0

cleanup() {
	if [[ "${MP_STARTED_HERE}" == "1" && -n "${MP_PID}" ]]; then
		kill "${MP_PID}" 2>/dev/null || true
	fi
}
trap cleanup EXIT

needs_desktop_build() {
	[[ ! -f dist/index.html ]] && return 0
	# Vite bez ELECTRON_BUILD=1 zostawia src="/assets/..." — file:// nie ładuje JS/CSS.
	grep -qE 'src="/assets/|href="/assets/' dist/index.html 2>/dev/null
}

needs_mp_server_build() {
	[[ ! -f electron/mp-server.cjs ]] && return 0
	[[ electron/mp-server.cjs -ot server/roomServer.ts ]] && return 0
	return 1
}

build_desktop_dist() {
	echo "== Build desktop (ELECTRON_BUILD=1) =="
	nix develop -c npm run build:web:desktop
}

build_mp_server() {
	echo "== Build serwera multiplayer =="
	nix develop -c npm run build:mp-server
}

mp_server_ready() {
	curl -sf "http://127.0.0.1:8765/status" >/dev/null 2>&1
}

start_mp_server_dev() {
	if mp_server_ready; then
		return 0
	fi
	# Gdy port zajęty przez inną instancję — OK.
	if lsof -ti:8765 >/dev/null 2>&1; then
		return 0
	fi
	nix develop -c npm run mp:server &
	MP_PID=$!
	MP_STARTED_HERE=1
	for _ in $(seq 1 40); do
		if mp_server_ready; then
			return 0
		fi
		sleep 0.15
	done
	echo "Uwaga: serwer MP nie odpowiada — online może nie działać." >&2
}

# Electron sam uruchamia mp-server.cjs; fallback tylko gdy brak bundla.
if [[ "${1:-}" == "--fresh" ]]; then
	shift
	build_desktop_dist
elif needs_desktop_build; then
	echo "dist/ nie jest buildem Electron — przebudowuję…" >&2
	build_desktop_dist
fi

if needs_mp_server_build; then
	build_mp_server
fi

if [[ ! -f dist/index.html ]]; then
	echo "Brak dist/ — uruchom: $0 --fresh" >&2
	exit 1
fi

# STEAM_DECK=1 tylko na żądanie: ./run-desktop.sh --deck
if [[ "${1:-}" == "--deck" ]]; then
	export STEAM_DECK=1
	shift
fi

# Electron uruchamia mp-server.cjs sam; gdy brak bundla — vite-node w tle.
if [[ ! -f electron/mp-server.cjs ]]; then
	start_mp_server_dev
fi

exec bash "$ROOT/scripts/run-electron.sh" "$@"
