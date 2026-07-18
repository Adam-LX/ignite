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
Użycie: $(basename "$0") [--stop] [--skip-tunnel] [--release] [--ensure]

  Domyślnie: uruchom serwer MP + cloudflared quick tunnel, zapisz wss URL.
  --ensure       — dev: wykryj działający relay lub uruchom; cicho gdy tylko LAN.
  --stop         — zatrzymaj relay (serwer + tunnel).
  --skip-tunnel  — tylko lokalny serwer (bez internetu).
  --release      — build produkcyjny: IGNITE_MP_SERVER lub pusty endpoint (bez tunelu).

Zmienne: IGNITE_MP_SERVER (wymuś istniejący relay), SKIP_MP_BAKE=1 (pomiń w buildzie)
         IGNITE_MP_BAKE_POLICY=1 (dopisz relay do policy-relays.json — tylko VPS)
         IGNITE_NAMED_TUNNEL_HOST=wss://mp.twoja-domena.pl (stały VPS)
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
	# Dev/ensure: krótki probe — nie blokuj launchera gry na minutę.
	local attempts="${MP_HEALTH_ATTEMPTS:-5}"
	local timeout="${MP_HEALTH_TIMEOUT:-10}"
	local attempt
	for attempt in $(seq 1 "${attempts}"); do
		if curl -sf --max-time "${timeout}" "${base}/status" >/dev/null 2>&1; then
			return 0
		fi
		[[ "${attempt}" -lt "${attempts}" ]] && sleep 1
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

	[[ "${QUIET:-0}" != "1" ]] && echo "== Uruchamiam serwer MP na porcie ${MP_PORT} =="
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

# Wyciąga https://*.trycloudflare.com z logu tunelu (NIGDY z /proc/fd — blokuje się na pipe).
discover_existing_tunnel_url() {
	local pid cmdline https_url wss_url
	local local_target="127.0.0.1:${MP_PORT}"

	# Najpierw nasz log — bez czytania cudzych fd.
	if [[ -f "${TUNNEL_LOG}" ]]; then
		https_url="$(
			grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "${TUNNEL_LOG}" |
				tail -1 || true
		)"
		if [[ -n "${https_url}" ]]; then
			wss_url="wss://${https_url#https://}"
			if MP_HEALTH_ATTEMPTS=2 MP_HEALTH_TIMEOUT=3 mp_healthy "$(mp_http_from_wss "${wss_url}")"; then
				printf '%s' "${wss_url}"
				return 0
			fi
		fi
	fi

	for pid in $(pgrep -f 'cloudflared.*tunnel' 2>/dev/null || true); do
		cmdline="$(tr '\0' ' ' <"/proc/${pid}/cmdline" 2>/dev/null || true)"
		if [[ "${cmdline}" != *"${local_target}"* && "${cmdline}" != *":${MP_PORT}"* ]]; then
			continue
		fi
		# Tylko potwierdź, że nasz tunnel żyje — URL bierz z logu / ENV, nie z fd.
		echo "${pid}" >"${TUNNEL_PID_FILE}"
		if [[ -n "${https_url:-}" ]]; then
			wss_url="wss://${https_url#https://}"
			if MP_HEALTH_ATTEMPTS=2 MP_HEALTH_TIMEOUT=3 mp_healthy "$(mp_http_from_wss "${wss_url}")"; then
				printf '%s' "${wss_url}"
				return 0
			fi
		fi
	done
	return 1
}

# Kolejność: ENV → IGNITE_MP_SERVER → named host → działający cloudflared.
resolve_public_relay_url() {
	local wss_url="" https_url=""

	if [[ -f "${ENV_FILE}" && -z "${IGNITE_MP_SERVER:-}" ]]; then
		# shellcheck disable=SC1090
		source "${ENV_FILE}"
	fi

	if [[ -n "${IGNITE_MP_SERVER:-}" ]]; then
		wss_url="${IGNITE_MP_SERVER}"
		[[ "${wss_url}" != wss://* ]] && wss_url="wss://${wss_url#https://}"
		if mp_healthy "$(mp_http_from_wss "${wss_url}")"; then
			printf '%s' "${wss_url}"
			return 0
		fi
	fi

	if [[ -n "${IGNITE_NAMED_TUNNEL_HOST:-}" ]]; then
		wss_url="${IGNITE_NAMED_TUNNEL_HOST}"
		[[ "${wss_url}" != wss://* ]] && wss_url="wss://${wss_url#https://}"
		if mp_healthy "$(mp_http_from_wss "${wss_url}")"; then
			printf '%s' "${wss_url}"
			return 0
		fi
	fi

	if wss_url="$(discover_existing_tunnel_url)"; then
		printf '%s' "${wss_url}"
		return 0
	fi

	return 1
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
	local bake_policy="${IGNITE_MP_BAKE_POLICY:-0}"
	mkdir -p "${ROOT}/data" "${ROOT}/public"
	cat >"${ENV_FILE}" <<EOF
# Auto: scripts/bake-mp-endpoint.sh
IGNITE_MP_SERVER=${wss_url}
VITE_IGNITE_MP_SERVER=${wss_url}
EOF
	printf '%s\n' "{\"server\":\"${wss_url}\",\"local\":\"localhost:${MP_PORT}\"}" >"${ENDPOINT_JSON}"

	if [[ "${bake_policy}" == "1" ]]; then
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
	fi

	if [[ -d "${ROOT}/dist" ]]; then
		cp "${ENDPOINT_JSON}" "${ROOT}/dist/mp-endpoint.json"
		if [[ "${bake_policy}" == "1" && -f "${ROOT}/public/policy-relays.json" ]]; then
			cp "${ROOT}/public/policy-relays.json" "${ROOT}/dist/policy-relays.json"
		fi
	fi
	if [[ "${QUIET:-0}" != "1" ]]; then
		echo "Zapisano: ${ENV_FILE}"
		echo "Public relay: ${wss_url}"
	fi
}

write_release_template() {
	mkdir -p "${ROOT}/public"
	printf '%s\n' "{\"server\":\"\",\"local\":\"localhost:${MP_PORT}\"}" >"${ENDPOINT_JSON}"
	if [[ -d "${ROOT}/dist" ]]; then
		cp "${ENDPOINT_JSON}" "${ROOT}/dist/mp-endpoint.json"
	fi
	echo "Release endpoint (pusty relay — ustaw IGNITE_MP_SERVER przed buildem): ${ENDPOINT_JSON}"
}

write_local_only() {
	mkdir -p "${ROOT}/public"
	printf '%s\n' "{\"server\":\"\",\"local\":\"localhost:${MP_PORT}\"}" >"${ENDPOINT_JSON}"
	if [[ -d "${ROOT}/dist" ]]; then
		cp "${ENDPOINT_JSON}" "${ROOT}/dist/mp-endpoint.json"
	fi
	if [[ "${QUIET:-0}" != "1" ]]; then
		echo "Endpoint lokalny (bez public relay): ${ENDPOINT_JSON}"
	fi
}

main() {
	local mode="bake"
	local skip_tunnel=0
	local release_mode=0
	local ensure_mode=0

	for arg in "$@"; do
		case "${arg}" in
			--stop)
				mode="stop"
				;;
			--ensure)
				ensure_mode=1
				QUIET=1
				;;
			--skip-tunnel)
				skip_tunnel=1
				;;
			--release)
				release_mode=1
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
		[[ "${QUIET:-0}" != "1" ]] && echo "SKIP_MP_BAKE=1 — pomijam bake endpoint."
		exit 0
	fi

	mkdir -p "${ROOT}/data"

	start_mp_server

	if [[ "${release_mode}" == "1" ]]; then
		if [[ -n "${IGNITE_MP_SERVER:-}" ]] && mp_healthy "$(mp_http_from_wss "${IGNITE_MP_SERVER}")"; then
			write_endpoint "${IGNITE_MP_SERVER}"
			exit 0
		fi
		write_release_template
		exit 0
	fi

	local wss_url=""
	if wss_url="$(resolve_public_relay_url)"; then
		write_endpoint "${wss_url}"
		[[ "${ensure_mode}" == "1" ]] && echo "[ignite] MP relay: ${wss_url}"
		exit 0
	fi

	if [[ "${skip_tunnel}" == "1" ]]; then
		write_local_only
		exit 0
	fi

	if wss_url="$(start_tunnel)"; then
		write_endpoint "${wss_url}"
		if [[ "${ensure_mode}" == "1" ]]; then
			echo "[ignite] MP relay: ${wss_url}"
		else
			echo "Relay działa w tle (PID tunnel: $(cat "${TUNNEL_PID_FILE}" 2>/dev/null || echo '?'))."
		fi
	else
		write_local_only
		[[ "${ensure_mode}" == "1" ]] && echo "[ignite] MP relay: tylko localhost:${MP_PORT}"
	fi
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
	main "$@"
fi
