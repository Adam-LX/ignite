#!/usr/bin/env bash
# Re-prep wszystkich aut Trellis z .work/*_trellis_raw.glb
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BLENDER="$(ls -d /nix/store/*-blender-*/bin/blender 2>/dev/null | tail -1)"
[[ -x "${BLENDER}" ]] || { echo "Brak Blendera" >&2; exit 1; }

RADIUS="${FLYBALL_WHEEL_STRIP_RADIUS:-0}"
FORCE_PRUNE="${FLYBALL_PRUNE_ISLANDS:-}"
# shellcheck source=scripts/content/trellis-prep-common.sh
source "$ROOT/scripts/content/trellis-prep-common.sh"
WORK="${ROOT}/public/assets/cars/.work"

flyball_tire_radius_for_car() {
	case "$1" in
	truck) echo 0.15 ;;
	muscle | buggy) echo 0.14 ;;
	*) echo 0.125 ;;
	esac
}

flyball_height_cap_for_car() {
	case "$1" in
	blade) echo 0.52 ;;
	*) echo 0 ;;
	esac
}

for raw in "$WORK"/*_trellis_raw.glb; do
	[[ -f "$raw" ]] || continue
	car=$(basename "$raw" _trellis_raw.glb)
	out="${ROOT}/public/assets/cars/${car}.glb"
	if [[ -n "$FORCE_PRUNE" ]]; then
		PRUNE="$FORCE_PRUNE"
	else
		PRUNE="$(flyball_prune_flag_for_car "$car")"
	fi
	TIRE="$(flyball_tire_radius_for_car "$car")"
	CAP="$(flyball_height_cap_for_car "$car")"
	echo "=== prep $car (strip=$RADIUS prune=$PRUNE tire=$TIRE cap=$CAP) ==="
	FLYBALL_WHEEL_STRIP_RADIUS="$RADIUS" \
		FLYBALL_PRUNE_ISLANDS="$PRUNE" \
		FLYBALL_EMPTY_WHEEL_WELLS=1 \
		FLYBALL_TIRE_RADIUS_M="$TIRE" \
		FLYBALL_MAX_BODY_HEIGHT_M="$CAP" \
		"$BLENDER" --background --python "$ROOT/scripts/blender_prep_meshy_car.py" -- \
		"$raw" "$out" 2>&1 | tail -2
done
echo "Gotowe."
