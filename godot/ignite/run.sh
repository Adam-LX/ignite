#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if command -v godot >/dev/null 2>&1; then
	GODOT=(godot)
elif command -v godot4 >/dev/null 2>&1; then
	GODOT=(godot4)
else
	echo "Godot 4 nie znaleziony. Uruchom: nix develop -c ./godot/ignite/run.sh" >&2
	exit 1
fi

if [[ "${1:-}" == "--headless-test" ]]; then
	exec "${GODOT[@]}" --headless --path . res://scenes/main.tscn
fi

exec "${GODOT[@]}" --path . res://scenes/main.tscn "$@"
