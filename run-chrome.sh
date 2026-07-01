#!/usr/bin/env bash
# Ignite w Chromium (google-chrome / chromium) — stabilniejszy WebGL niż Vivaldi.
set -euo pipefail
cd "$(dirname "$0")"

PORT=5173
URL="http://localhost:${PORT}/"

CHROME=""
for bin in google-chrome-stable google-chrome chromium-browser chromium chrome; do
	if command -v "${bin}" >/dev/null 2>&1; then
		CHROME="${bin}"
		break
	fi
done

if [ -z "${CHROME}" ]; then
	echo "Brak Google Chrome / Chromium w PATH."
	echo "NixOS: nix-shell -p google-chrome  lub  programs.google-chrome.enable = true"
	exit 1
fi

server_ready() {
	curl -sf -o /dev/null "${URL}" 2>/dev/null
}

if ! server_ready; then
	echo "Dev server nie działa — uruchamiam ./run.sh w tle…"
	./run.sh &
	SERVER_PID=$!
	trap 'kill "${SERVER_PID}" 2>/dev/null || true' EXIT

	for _ in $(seq 1 90); do
		if server_ready; then
			echo "Serwer gotowy: ${URL}"
			break
		fi
		sleep 1
	done

	if ! server_ready; then
		echo "Timeout: serwer nie wystartował w 90s."
		exit 1
	fi
else
	echo "Serwer już działa: ${URL}"
	trap - EXIT
fi

echo "Otwieram: ${CHROME} → ${URL}"
exec "${CHROME}" \
	--new-window \
	--start-fullscreen \
	--disable-features=TranslateUI \
	"${URL}"
