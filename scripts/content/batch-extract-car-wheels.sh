#!/usr/bin/env bash
# Wycina koła z aut Trellis → public/assets/items/wheels/{id}.glb
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BLENDER="$(ls -d /nix/store/*-blender-*/bin/blender 2>/dev/null | tail -1)"
[[ -x "${BLENDER}" ]] || { echo "Brak Blendera" >&2; exit 1; }

WORK="${ROOT}/public/assets/cars/.work"

extract_one() {
	local car="$1"
	local wheel_id="$2"
	local radius="$3"
	local raw="${WORK}/${car}_trellis_raw.glb"
	local hub_glb="${ROOT}/public/assets/cars/${car}.glb"
	local out="${ROOT}/public/assets/items/wheels/${wheel_id}.glb"
	[[ -f "$raw" ]] || { echo "SKIP $car — brak $raw" >&2; return 0; }
	echo "=== extract $wheel_id z $car (r=$radius) ==="
	FLYBALL_WHEEL_STRIP_RADIUS="$radius" \
	FLYBALL_WHEEL_HUB_GLB="$hub_glb" \
	"$BLENDER" --background --python "$ROOT/scripts/blender_extract_wheel_from_body.py" -- \
		"$raw" "$out" wheel_FL
	ls -la "$out"
}

extract_one buggy dune 0.19
extract_one muscle muscleforge 0.32
extract_one truck truckforge 0.19

echo "Gotowe. Dodaj wpisy do item-catalog.json jeśli nowe id."
