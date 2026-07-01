#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="http://127.0.0.1:5173/"
LOG="$ROOT/.flyball-dev.log"
PIDFILE="$ROOT/.flyball-dev.pid"

cd "$ROOT"

server_up() {
	curl -sf --connect-timeout 1 "$URL" >/dev/null 2>&1
}

notify() {
	if command -v notify-send >/dev/null 2>&1; then
		notify-send "FlyBall" "$1"
	fi
}

start_server() {
	if [ -f "$PIDFILE" ]; then
		local pid
		pid="$(cat "$PIDFILE")"
		if kill -0 "$pid" 2>/dev/null && server_up; then
			return 0
		fi
	fi

	: >"$LOG"

	if command -v npm >/dev/null 2>&1; then
		[ -d node_modules ] || npm install >>"$LOG" 2>&1
		nohup npm run dev:force >>"$LOG" 2>&1 &
	elif [ -f flake.nix ]; then
		nohup nix develop -c npm run dev:force >>"$LOG" 2>&1 &
	else
		nohup nix shell nixpkgs#nodejs_22 -c bash -c "cd '$ROOT' && npm install && npm run dev:force" >>"$LOG" 2>&1 &
	fi

	echo $! >"$PIDFILE"

	for _ in $(seq 1 45); do
		if server_up; then
			return 0
		fi
		sleep 1
	done

	notify "Serwer dev nie wstał — zobacz $LOG"
	exit 1
}

if ! server_up; then
	start_server
fi

xdg-open "$URL" >/dev/null 2>&1 &
