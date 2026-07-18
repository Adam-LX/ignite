#!/usr/bin/env bash
# Przywraca karoserie z *_trellis_raw.glb — BEZ vertex strip (nie psuje meshy).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BLENDER="$(ls -d /nix/store/*-blender-*/bin/blender 2>/dev/null | tail -1)"
[[ -x "${BLENDER}" ]] || { echo "Brak Blendera" >&2; exit 1; }

WORK="${ROOT}/public/assets/cars/.work"
export FLYBALL_WHEEL_STRIP_RADIUS=0
export FLYBALL_STRIP_SPARE=0
export FLYBALL_PRUNE_ISLANDS=0
export FLYBALL_EMPTY_WHEEL_WELLS=1

for raw in "$WORK"/*_trellis_raw.glb; do
	[[ -f "$raw" ]] || continue
	car=$(basename "$raw" _trellis_raw.glb)
	out="${ROOT}/public/assets/cars/${car}.glb"
	echo "=== restore $car z raw (bez strip) ==="
	"$BLENDER" --background --python "$ROOT/scripts/blender_prep_meshy_car.py" -- \
		"$raw" "$out" 2>&1 | tail -2
done

echo "Walidacja…"
cd "$ROOT" && nix develop -c node scripts/validateGlb.mjs --catalog 2>&1 | tail -5
