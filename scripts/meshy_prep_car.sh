#!/usr/bin/env bash
# Przygotuj model Meshy (domyślnie T4.glb) → public/assets/models/car.glb
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BLENDER="$(ls -d /nix/store/*-blender-*/bin/blender 2>/dev/null | tail -1)"
if [[ -z "${BLENDER}" || ! -x "${BLENDER}" ]]; then
	echo "Blender nie znaleziony w /nix/store" >&2
	exit 1
fi
export FLYBALL_ROOT="$ROOT"
export FLYBALL_EMPTY_WHEEL_WELLS="${FLYBALL_EMPTY_WHEEL_WELLS:-0}"
export MESHY_CAR_SRC="${MESHY_CAR_SRC:-$ROOT/T4.glb}"
echo "Meshy car: $MESHY_CAR_SRC → public/assets/models/car.glb (emptyWells=$FLYBALL_EMPTY_WHEEL_WELLS)"
exec "$BLENDER" --background --python "$ROOT/scripts/blender_prep_meshy_car.py"
