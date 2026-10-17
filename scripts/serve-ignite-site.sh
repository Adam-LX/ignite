#!/usr/bin/env bash
# Lokalny serwer strony Ignite + publiczny Cloudflare quick tunnel.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE="${ROOT}/site"
PORT="${IGNITE_SITE_PORT:-8788}"
PID_FILE="${ROOT}/data/ignite-site.pid"
TUNNEL_PID_FILE="${ROOT}/data/ignite-site-tunnel.pid"
TUNNEL_LOG="${ROOT}/data/ignite-site-tunnel.log"
URL_FILE="${ROOT}/data/ignite-site.url"

mkdir -p "${ROOT}/data"

cloudflared_bin() {
	if command -v cloudflared >/dev/null 2>&1; then
		command -v cloudflared
		return
	fi
	nix shell nixpkgs#cloudflared -c bash -lc 'command -v cloudflared' 2>/dev/null || true
}

stop_all() {
	if [[ -f "${TUNNEL_PID_FILE}" ]]; then
		kill "$(cat "${TUNNEL_PID_FILE}")" 2>/dev/null || true
		rm -f "${TUNNEL_PID_FILE}"
	fi
	if [[ -f "${PID_FILE}" ]]; then
		kill "$(cat "${PID_FILE}")" 2>/dev/null || true
		rm -f "${PID_FILE}"
	fi
	# leftover python http.server on our port
	for pid in $(ss -ltnp 2>/dev/null | awk -v p=":${PORT}" '$4 ~ p {print}' | grep -oP 'pid=\K[0-9]+' || true); do
		kill "$pid" 2>/dev/null || true
	done
	rm -f "${URL_FILE}"
	echo "Stopped Ignite site + tunnel."
}

if [[ "${1:-}" == "stop" ]]; then
	stop_all
	exit 0
fi

stop_all >/dev/null 2>&1 || true

cd "${SITE}"
python3 -m http.server "${PORT}" --bind 127.0.0.1 >/dev/null 2>&1 &
echo $! >"${PID_FILE}"
sleep 0.4

if ! curl -sf "http://127.0.0.1:${PORT}/" >/dev/null; then
	echo "Local server failed on :${PORT}" >&2
	exit 1
fi

CF="$(cloudflared_bin)"
if [[ -z "${CF}" ]]; then
	echo "Brak cloudflared — lokalnie: http://127.0.0.1:${PORT}/" >&2
	echo "http://127.0.0.1:${PORT}/" >"${URL_FILE}"
	exit 0
fi

: >"${TUNNEL_LOG}"
"${CF}" tunnel --url "http://127.0.0.1:${PORT}" --no-autoupdate >"${TUNNEL_LOG}" 2>&1 &
echo $! >"${TUNNEL_PID_FILE}"

URL=""
for _ in $(seq 1 40); do
	URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "${TUNNEL_LOG}" | head -1 || true)"
	if [[ -n "${URL}" ]]; then
		break
	fi
	sleep 0.5
done

if [[ -z "${URL}" ]]; then
	echo "Tunnel nie oddał URL — lokalnie: http://127.0.0.1:${PORT}/" >&2
	echo "Log: ${TUNNEL_LOG}" >&2
	echo "http://127.0.0.1:${PORT}/" >"${URL_FILE}"
	exit 1
fi

echo "${URL}" >"${URL_FILE}"
echo "Lokalnie:  http://127.0.0.1:${PORT}/"
echo "Publicznie: ${URL}"
echo "(stop: bash scripts/serve-ignite-site.sh stop)"
