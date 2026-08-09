#!/usr/bin/env bash
# Prep wszystkich aut z raw + mały island-prune (luźne baked koła).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export FLYBALL_WHEEL_STRIP_RADIUS=0
unset FLYBALL_PRUNE_ISLANDS
export FLYBALL_EMPTY_WHEEL_WELLS=1
bash "$ROOT/scripts/content/batch-prep-trellis-cars.sh"
cd "$ROOT" && nix develop -c node scripts/validateGlb.mjs --catalog
