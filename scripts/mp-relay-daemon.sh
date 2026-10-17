#!/usr/bin/env bash
# Daemon relay MP — utrzymuje serwer + tunnel przy życiu (quick lub named Cloudflare).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

PID_FILE="${ROOT}/data/mp-relay-daemon.pid"
LOG="${ROOT}/data/mp-relay-daemon.log"
BAKE="${ROOT}/scripts/bake-mp-endpoint.sh"

usage() {
	cat <<EOF
Użycie: $(basename "$0") {start|stop|status|restart} [--skip-tunnel]

  start   — uruchom bake-mp-endpoint w pętli (PID: ${PID_FILE})
  stop    — zatrzymaj daemon + relay (bake --stop)
  status  — czy daemon działa + health lokalnego MP
  restart — stop + start

Named tunnel (stały wss://):
  IGNITE_NAMED_TUNNEL=ignite-mp
  IGNITE_NAMED_TUNNEL_HOST=wss://mp.twoja-domena.pl

Quick tunnel (domyślnie): cloudflared trycloudflare.com
EOF
}

daemon_running() {
	[[ -f "${PID_FILE}" ]] && kill -0 "$(cat "${PID_FILE}")" 2>/dev/null
}

stop_daemon() {
	if daemon_running; then
		kill "$(cat "${PID_FILE}")" 2>/dev/null || true
		rm -f "${PID_FILE}"
	fi
	"${BAKE}" --stop 2>/dev/null || true
}

start_daemon() {
	local skip_tunnel=0
	for arg in "$@"; do
		[[ "${arg}" == "--skip-tunnel" ]] && skip_tunnel=1
	done

	if daemon_running; then
		echo "Daemon już działa (PID $(cat "${PID_FILE}"))."
		exit 0
	fi

	mkdir -p "${ROOT}/data"
	stop_daemon

	local bake_args=()
	[[ "${skip_tunnel}" == "1" ]] && bake_args+=(--skip-tunnel)

	echo "== Ignite MP relay daemon → ${LOG} =="
	nohup bash -c "
		set -uo pipefail
		BAKE='${BAKE}'
		while true; do
			echo \"[\$(date -Iseconds)] relay bake…\" >>'${LOG}'
			if ! \"\${BAKE}\" ${bake_args[*]:-}; then
				echo \"[\$(date -Iseconds)] bake failed — retry 30s\" >>'${LOG}'
				sleep 30
				continue
			fi
			sleep 300
		done
	" >>"${LOG}" 2>&1 &

	echo $! >"${PID_FILE}"
	echo "Daemon PID $(cat "${PID_FILE}")"
}

show_status() {
	if daemon_running; then
		echo "Daemon: działa (PID $(cat "${PID_FILE}"))"
	else
		echo "Daemon: zatrzymany"
	fi

	local port="${IGNITE_MP_PORT:-8765}"
	if curl -sf --max-time 3 "http://127.0.0.1:${port}/status" >/dev/null 2>&1; then
		echo "MP lokalny: OK (port ${port})"
	else
		echo "MP lokalny: offline"
	fi

	if [[ -f "${ROOT}/data/mp-public-endpoint.env" ]]; then
		# shellcheck disable=SC1090
		source "${ROOT}/data/mp-public-endpoint.env"
		echo "Public relay: ${IGNITE_MP_SERVER:-brak}"
	fi
}

cmd="${1:-}"
shift || true

case "${cmd}" in
	start)
		start_daemon "$@"
		;;
	stop)
		stop_daemon
		echo "Daemon zatrzymany."
		;;
	restart)
		stop_daemon
		start_daemon "$@"
		;;
	status)
		show_status
		;;
	-h | --help | "")
		usage
		[[ -z "${cmd}" ]] && exit 1
		;;
	*)
		echo "Nieznana komenda: ${cmd}" >&2
		usage >&2
		exit 1
		;;
esac
