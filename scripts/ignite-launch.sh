#!/usr/bin/env bash
# Ignite — pełnoekranowa aplikacja Electron (NIE przeglądarka).
#
# Domyślnie: Vite ze src/ (świeży kod + HMR). Zmiany w src/ lub GLB
# automatycznie restartują serwer przed otwarciem okna.
# IGNITE_USE_DIST=1 → szybki cold start z dist/ (bez HMR).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE_URL="${IGNITE_VITE_URL:-http://127.0.0.1:5173/}"
LOG="$ROOT/.ignite-dev.log"
PIDFILE="$ROOT/.ignite-dev.pid"
STAMPFILE="$ROOT/.ignite-dev.stamp"
LAUNCH_LOG="${XDG_CACHE_HOME:-$HOME/.cache}/ignite-launch.log"
LOCKFILE="${XDG_CACHE_HOME:-$HOME/.cache}/ignite-launch.lock"

# GNOME overview ma ubogi PATH — bez tego nix shell nie działa.
export PATH="/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:${HOME}/.nix-profile/bin:${PATH}"

cd "$ROOT"
mkdir -p "$(dirname "$LAUNCH_LOG")"

# Jedna instancja startu serwera — unikaj wyścigu restartów Vite.
# Lock tylko na boot Vite; Electron poza lockiem (żeby dało się zrestartować grę).
exec 9>"$LOCKFILE"
if ! flock -n 9; then
	echo "$(date -Iseconds) inny launcher już startuje Vite — czekam…" >>"$LAUNCH_LOG"
	flock 9
fi

server_up() {
	curl -sf --connect-timeout 1 "${BASE_URL}" >/dev/null 2>&1
}

pid_owns_dev_port() {
	local pid="${1:-}"
	[ -n "$pid" ] || return 1
	kill -0 "$pid" 2>/dev/null || return 1
	if ss -tlnp 2>/dev/null | grep -q "pid=$pid,.*:5173"; then
		return 0
	fi
	# Wrapper (npm / nix) w PIDFILE — port trzyma child (node).
	local holder="" p=""
	holder="$(
		ss -tlnp 'sport = :5173' 2>/dev/null |
			sed -n 's/.*pid=\([0-9]*\).*/\1/p' |
			head -1
	)"
	[ -n "$holder" ] || return 1
	p="$holder"
	while [ -n "$p" ] && [ "$p" != "0" ] && [ "$p" != "1" ]; do
		[ "$p" = "$pid" ] && return 0
		p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
	done
	return 1
}

kill_process_tree() {
	local pid="${1:-}"
	[ -n "$pid" ] || return 0
	local c
	for c in $(pgrep -P "$pid" 2>/dev/null || true); do
		kill_process_tree "$c"
	done
	kill "$pid" 2>/dev/null || true
}

free_stale_dev_port() {
	local holder=""
	holder="$(
		ss -tlnp 'sport = :5173' 2>/dev/null |
			sed -n 's/.*pid=\([0-9]*\).*/\1/p' |
			head -1
	)"
	if [ -z "$holder" ]; then
		return 0
	fi
	if [ -f "$PIDFILE" ]; then
		local saved
		saved="$(cat "$PIDFILE")"
		if [ "$saved" = "$holder" ] && pid_owns_dev_port "$holder"; then
			return 0
		fi
		if pid_owns_dev_port "$saved"; then
			return 0
		fi
	fi
	kill_process_tree "$holder"
	for _ in $(seq 1 10); do
		if ! ss -tlnp 'sport = :5173' 2>/dev/null | grep -q .; then
			return 0
		fi
		sleep 0.2
	done
	kill -9 "$holder" 2>/dev/null || true
}

stop_dev_server() {
	if [ -f "$PIDFILE" ]; then
		local pid
		pid="$(cat "$PIDFILE")"
		kill_process_tree "$pid"
		for _ in $(seq 1 20); do
			kill -0 "$pid" 2>/dev/null || break
			sleep 0.1
		done
		kill -9 "$pid" 2>/dev/null || true
		# dobij childy (node) jeśli zostały
		local holder=""
		holder="$(
			ss -tlnp 'sport = :5173' 2>/dev/null |
				sed -n 's/.*pid=\([0-9]*\).*/\1/p' |
				head -1
		)"
		if [ -n "$holder" ]; then
			kill_process_tree "$holder"
			kill -9 "$holder" 2>/dev/null || true
		fi
		rm -f "$PIDFILE"
	fi
	free_stale_dev_port
	# Zwolnij port nawet gdy pidfile zgubiony.
	local holder=""
	holder="$(
		ss -tlnp 'sport = :5173' 2>/dev/null |
			sed -n 's/.*pid=\([0-9]*\).*/\1/p' |
			head -1
	)"
	if [ -n "$holder" ]; then
		kill_process_tree "$holder"
		sleep 0.3
		kill -9 "$holder" 2>/dev/null || true
	fi
}

notify() {
	if command -v notify-send >/dev/null 2>&1; then
		notify-send "Ignite" "$1"
	fi
}

fail() {
	echo "$(date -Iseconds) $*" >>"$LAUNCH_LOG"
	notify "$1"
	exit "${2:-1}"
}

run_npm() {
	if [ -f "$ROOT/flake.nix" ] && command -v nix >/dev/null 2>&1; then
		nix develop "$ROOT" -c "$@"
	else
		"$@"
	fi
}

# Najnowszy mtime w src/ + katalogu aut (kod / GLB / katalogi).
# Pomijaj .work / cache — batch Trellis nie może triggerować restartu Vite.
newest_content_mtime() {
	find "$ROOT/src" "$ROOT/public/assets/cars" "$ROOT/electron" \
		"$ROOT/index.html" "$ROOT/package.json" "$ROOT/vite.config.ts" \
		-path '*/.work/*' -prune -o \
		-path '*/node_modules/*' -prune -o \
		-type f \( \
			-name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' -o \
			-name '*.cjs' -o -name '*.css' -o -name '*.json' -o -name '*.glb' -o \
			-name '*.html' \
		\) -printf '%T@\n' 2>/dev/null | sort -n | tail -1 | cut -d. -f1
}

content_newer_than_dev() {
	local content_t stamp_t
	content_t="$(newest_content_mtime)"
	[ -n "$content_t" ] || return 1
	stamp_t=0
	if [ -f "$STAMPFILE" ]; then
		stamp_t="$(stat -c %Y "$STAMPFILE" 2>/dev/null || echo 0)"
	fi
	# +2s tolerancja na równoległy zapis
	(( content_t > stamp_t + 2 ))
}

start_server() {
	stop_dev_server

	: >"$LOG"
	# Relay w tle z twardym timeoutem — NIGDY nie blokuj startu Electron/Vite.
	# (bake kiedyś wisiał na cat /proc/cloudflared/fd → gra „nie odpalała się”).
	(
		MP_HEALTH_ATTEMPTS=2 MP_HEALTH_TIMEOUT=3 \
			timeout 12 bash "${ROOT}/scripts/ensure-mp-relay.sh" >>"$LOG" 2>&1
	) &

	[ -d "$ROOT/node_modules" ] || run_npm npm install >>"$LOG" 2>&1

	# Restart po zmianie src: zwykły vite (bez --force). Force tylko gdy brak cache.
	local vite_cmd="npm run dev -- --host 127.0.0.1 --port 5173 --strictPort"
	if [ ! -d "$ROOT/node_modules/.vite/deps" ]; then
		vite_cmd="npm run dev:force -- --host 127.0.0.1 --port 5173 --strictPort"
	fi

	# nohup nie uruchamia funkcji shell — subshell + setsid (grupa procesów).
	setsid bash -c '
		ROOT="$1"
		CMD="$2"
		cd "$ROOT" || exit 1
		if [ -f "$ROOT/flake.nix" ] && command -v nix >/dev/null 2>&1; then
			exec nix develop "$ROOT" -c bash -lc "$CMD"
		fi
		exec bash -lc "$CMD"
	' bash "$ROOT" "$vite_cmd" >>"$LOG" 2>&1 &
	local bg_pid=$!
	if [ -z "${bg_pid}" ] || [ "${bg_pid}" = "0" ]; then
		echo "$(date -Iseconds) FAIL: setsid nie wystartował" >>"$LAUNCH_LOG"
		notify "Ignite: nie udało się uruchomić Vite"
		exit 1
	fi
	echo "${bg_pid}" >"$PIDFILE"

	for _ in $(seq 1 45); do
		if server_up; then
			date -Iseconds >"$STAMPFILE"
			echo "$(date -Iseconds) Vite OK (pid ${bg_pid})" >>"$LAUNCH_LOG"
			return 0
		fi
		sleep 1
	done

	echo "$(date -Iseconds) FAIL: Vite nie wstał w 45s — log: $LOG" >>"$LAUNCH_LOG"
	tail -40 "$LOG" >>"$LAUNCH_LOG" 2>/dev/null || true
	notify "Serwer dev nie wstał — zobacz $LOG"
	exit 1
}

ensure_fresh_dev() {
	if [ -f "$PIDFILE" ]; then
		local pid
		pid="$(cat "$PIDFILE")"
		if pid_owns_dev_port "$pid" && server_up; then
			if content_newer_than_dev; then
				echo "$(date -Iseconds) src/assety nowsze niż Vite — restart" >>"$LAUNCH_LOG"
				notify "Ignite: odświeżam serwer (nowy kod/asset)"
				start_server
				return 0
			fi
			return 0
		fi
	fi
	start_server
}

# --- tryb dist (opcjonalny) -------------------------------------------------
if [[ "${IGNITE_USE_DIST:-}" == "1" ]]; then
	echo "$(date -Iseconds) IGNITE_USE_DIST=1 → dist/" >>"$LAUNCH_LOG"
	bash "$ROOT/run-desktop.sh" 2>>"$LAUNCH_LOG" || fail "Ignite nie wystartowało — log: $LAUNCH_LOG"
	exit 0
fi

# --- domyślnie: Vite ze src/ ------------------------------------------------
ensure_fresh_dev
# Zwolnij lock przed Electron — gra może być relaunchowana.
flock -u 9 || true

# Cache-bust dokumentu Electron (unikaj starego HTML w Chromium).
export IGNITE_DEV=1
export IGNITE_VITE_URL="${BASE_URL%/}/?ignite=$(date +%s)"

bash "$ROOT/scripts/run-electron.sh" 2>>"$LAUNCH_LOG" || fail "Ignite (dev) nie wystartowało — log: $LAUNCH_LOG"
