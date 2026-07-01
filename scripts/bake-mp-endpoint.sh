#!/usr/bin/env bash
# Uruchamia relay MP (lokalny serwer + Cloudflare quick tunnel) i zapisuje endpoint do buildu.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

MP_PORT="${IGNITE_MP_PORT:-8765}"
MP_PID_FILE="${ROOT}/data/mp-relay-server.pid"
TUNNEL_PID_FILE="${ROOT}/data/mp-relay-tunnel.pid"
TUNNEL_LOG="${ROOT}/data/mp-tunnel.log"
ENV_FILE="${ROOT}/data/mp-public-endpoint.env"
ENDPOINT_JSON="${ROOT}/public/mp-endpoint.json"

usage() {
	cat <<EOF
Użycie: $(basename "$0") [--stop] [--skip-tunnel]

  Domyślnie: uruchom serwer MP + cloudflared quick tunnel, zapisz wss URL.
  --stop         — zatrzymaj relay (serwer + tunnel).
  --skip-tunnel  — tylko lokalny serwer (bez internetu).

Zmienne: IGNITE_MP_SERVER (wymuś istniejący relay), SKIP_MP_BAKE=1 (pomiń w buildzie)
EOF
}

mp_local_url() {
	printf 'http://127.0.0.1:%s' "${MP_PORT}"
}

mp_http_from_wss() {
	local wss="$1"
	printf '%s' "${wss/wss:\/\//https:\/\/}"
}

mp_healthy() {
	local base="$1"
	local attempt
	for attempt in 1 2 3 4 5; do
		if curl -sf --max-time 10 "${base}/status" >/dev/null 2>&1; then
			return 0
		fi
		sleep 2
	done
	return 1
}

cloudflared_bin() {
	if command -v cloudflared >/dev/null 2>&1; then
		command -v cloudflared
		return 0
	fi
	if command -v nix >/dev/null 2>&1; then
		nix shell nixpkgs#cloudflared -c bash -lc 'command -v cloudflared' 2>/dev/null || true
	fi
}

run_cloudflared() {
	local cf
	cf="$(cloudflared_bin)"
	if [[ -n "${cf}" ]]; then
		"${cf}" "$@"
		return $?
	fi
	if command -v nix >/dev/null 2>&1; then
		nix shell nixpkgs#cloudflared -c cloudflared "$@"
		return $?
	fi
	return 1
}

stop_pid_file() {
	local file="$1"
	if [[ -f "${file}" ]]; then
		local pid
		pid="$(cat "${file}")"
		if kill -0 "${pid}" 2>/dev/null; then
			kill "${pid}" 2>/dev/null || true
		fi
		rm -f "${file}"
	fi
}

stop_relay() {
	stop_pid_file "${TUNNEL_PID_FILE}"
	stop_pid_file "${MP_PID_FILE}"
	echo "Relay MP zatrzymany."
}

start_mp_server() {
	if mp_healthy "$(mp_local_url)"; then
		return 0
	fi

	if lsof -ti:"${MP_PORT}" >/dev/null 2>&1; then
		if mp_healthy "$(mp_local_url)"; then
			return 0
		fi
	fi

	echo "== Uruchamiam serwer MP na porcie ${MP_PORT} =="
	if command -v npm >/dev/null 2>&1; then
		npm run mp:server >>"${ROOT}/data/mp-server.log" 2>&1 &
	else
		nix develop -c npm run mp:server >>"${ROOT}/data/mp-server.log" 2>&1 &
	fi
	echo $! >"${MP_PID_FILE}"

	for _ in $(seq 1 60); do
		if mp_healthy "$(mp_local_url)"; then
			return 0
		fi
		sleep 0.25
	done
	echo "Serwer MP nie odpowiada na $(mp_local_url)" >&2
	exit 1
}

start_tunnel() {
	local log https_url wss_url

	# Named tunnel — stały hostname (cloudflared tunnel run <name>)
	if [[ -n "${IGNITE_NAMED_TUNNEL:-}" ]]; then
		stop_pid_file "${TUNNEL_PID_FILE}"
		: >"${TUNNEL_LOG}"
		echo "== Named tunnel: ${IGNITE_NAMED_TUNNEL} ==" >&2
		run_cloudflared tunnel run "${IGNITE_NAMED_TUNNEL}" >>"${TUNNEL_LOG}" 2>&1 &
		echo $! >"${TUNNEL_PID_FILE}"

		if [[ -n "${IGNITE_NAMED_TUNNEL_HOST:-}" ]]; then
			wss_url="${IGNITE_NAMED_TUNNEL_HOST}"
			[[ "${wss_url}" != wss://* ]] && wss_url="wss://${wss_url#https://}"
			sleep 3
			if mp_healthy "$(mp_http_from_wss "${wss_url}")"; then
				printf '%s' "${wss_url}"
				return 0
			fi
			echo "Named tunnel host nie odpowiada — sprawdzam log…" >&2
		fi

		for _ in $(seq 1 90); do
			https_url="$(grep -oE 'https://[a-zA-Z0-9.-]+' "${TUNNEL_LOG}" | grep -v trycloudflare | head -1 || true)"
			if [[ -n "${https_url}" ]]; then
				wss_url="wss://${https_url#https://}"
				if mp_healthy "$(mp_http_from_wss "${wss_url}")"; then
					printf '%s' "${wss_url}"
					return 0
				fi
			fi
			sleep 1
		done
		echo "Named tunnel nie wystartował (log: ${TUNNEL_LOG})." >&2
		return 1
	fi

	stop_pid_file "${TUNNEL_PID_FILE}"
	: >"${TUNNEL_LOG}"

	echo "== Cloudflare quick tunnel → $(mp_local_url) ==" >&2
	run_cloudflared tunnel --url "$(mp_local_url)" >>"${TUNNEL_LOG}" 2>&1 &
	echo $! >"${TUNNEL_PID_FILE}"

	for _ in $(seq 1 120); do
		https_url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "${TUNNEL_LOG}" | head -1 || true)"
		if [[ -n "${https_url}" ]]; then
			wss_url="wss://${https_url#https://}"
			sleep 4
			if mp_healthy "$(mp_http_from_wss "${wss_url}")"; then
				printf '%s' "${wss_url}"
				return 0
			fi
		fi
		sleep 0.5
	done

	echo "Nie udało się wystartować tunelu Cloudflare (log: ${TUNNEL_LOG})." >&2
	return 1
}

write_endpoint() {
	local wss_url="$1"
	mkdir -p "${ROOT}/data" "${ROOT}/public"
	cat >"${ENV_FILE}" <<EOF
# Auto: scripts/bake-mp-endpoint.sh
IGNITE_MP_SERVER=${wss_url}
VITE_IGNITE_MP_SERVER=${wss_url}
EOF
	printf '%s\n' "{\"server\":\"${wss_url}\",\"local\":\"localhost:${MP_PORT}\"}" >"${ENDPOINT_JSON}"

	local https_url
	https_url="$(mp_http_from_wss "${wss_url}")"
	local relay_json="${ROOT}/public/policy-relays.json"
	python3 - "${relay_json}" "${https_url}/policy" "${https_url}/policy/sync" <<'PY'
import json, sys
from datetime import datetime, timezone
from pathlib import Path

path, fetch_url, sync_url = sys.argv[1:4]
data = {"fetch": ["/assets/ai/bot-policy.json"], "sync": [], "updatedAt": ""}
p = Path(path)
if p.is_file():
    try:
        data = json.loads(p.read_text())
    except json.JSONDecodeError:
        pass

def add_unique(key, url):
    lst = data.setdefault(key, [])
    if url not in lst:
        lst.append(url)

add_unique("fetch", fetch_url)
add_unique("sync", sync_url)
data["updatedAt"] = datetime.now(timezone.utc).isoformat()
p.write_text(json.dumps(data, indent="\t") + "\n")
PY

	if [[ -d "${ROOT}/dist" ]]; then
		cp "${ENDPOINT_JSON}" "${ROOT}/dist/mp-endpoint.json"
		cp "${relay_json}" "${ROOT}/dist/policy-relays.json"
	fi
	echo "Zapisano: ${ENV_FILE}"
	echo "Public relay: ${wss_url}"
	echo "Policy relays: ${relay_json}"
}

write_local_only() {
	mkdir -p "${ROOT}/public"
	printf '%s\n' "{\"local\":\"localhost:${MP_PORT}\"}" >"${ENDPOINT_JSON}"
	if [[ -d "${ROOT}/dist" ]]; then
		cp "${ENDPOINT_JSON}" "${ROOT}/dist/mp-endpoint.json"
	fi
	echo "Endpoint lokalny (bez public relay): ${ENDPOINT_JSON}"
}

main() {
	local mode="bake"
	local skip_tunnel=0

	for arg in "$@"; do
		case "${arg}" in
			--stop)
				mode="stop"
				;;
			--skip-tunnel)
				skip_tunnel=1
				;;
			-h | --help)
				usage
				exit 0
				;;
			*)
				echo "Nieznany argument: ${arg}" >&2
				usage >&2
				exit 1
				;;
		esac
	done

	if [[ "${mode}" == "stop" ]]; then
		stop_relay
		exit 0
	fi

	if [[ "${SKIP_MP_BAKE:-0}" == "1" ]]; then
		echo "SKIP_MP_BAKE=1 — pomijam bake endpoint."
		exit 0
	fi

	mkdir -p "${ROOT}/data"

	if [[ -f "${ENV_FILE}" && -z "${IGNITE_MP_SERVER:-}" ]]; then
		# shellcheck disable=SC1090
		source "${ENV_FILE}"
	fi

	if [[ -n "${IGNITE_MP_SERVER:-}" ]]; then
		if mp_healthy "$(mp_http_from_wss "${IGNITE_MP_SERVER}")"; then
			write_endpoint "${IGNITE_MP_SERVER}"
			exit 0
		fi
		echo "IGNITE_MP_SERVER nie odpowiada — startuję nowy relay…" >&2
	fi

	start_mp_server

	if [[ "${skip_tunnel}" == "1" ]]; then
		write_local_only
		exit 0
	fi

	local wss_url
	if wss_url="$(start_tunnel)"; then
		write_endpoint "${wss_url}"
		echo "Relay działa w tle (PID tunnel: $(cat "${TUNNEL_PID_FILE}" 2>/dev/null || echo '?'))."
	else
		write_local_only
		exit 0
	fi
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
	main "$@"
fi
