#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BLENDER="$(ls -d /nix/store/*-blender-*/bin/blender 2>/dev/null | tail -1)"
if [[ -z "${BLENDER}" || ! -x "${BLENDER}" ]]; then
	echo "Blender nie znaleziony w /nix/store" >&2
	exit 1
fi
export FLYBALL_ROOT="$ROOT"
export MESHY_GOAL_SRC="${MESHY_GOAL_SRC:-$ROOT/public/assets/models/goal_frame_meshy_sized.glb}"
echo "Meshy goal: $MESHY_GOAL_SRC → public/assets/models/goal_frame.glb"
exec "$BLENDER" --background --python "$ROOT/scripts/blender_prep_meshy_goal.py"
