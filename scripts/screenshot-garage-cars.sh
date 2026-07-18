#!/usr/bin/env bash
# Render PNG orientacji aut (Electron + Vite).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ROOT}/public/assets/cars/.work/diag/screens"
BASE="${IGNITE_VITE_URL:-http://127.0.0.1:5173}"
BASE="${BASE%%\?*}"
mkdir -p "$OUT"

export PATH="/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:${HOME}/.nix-profile/bin:${PATH}"

if ! curl -sf "$BASE" >/dev/null; then
	echo "Brak Vite na $BASE — nix develop -c npm run dev:force" >&2
	exit 1
fi

export IGNITE_SHOT_OUT="$OUT"
export IGNITE_VITE_URL="$BASE"
if [[ $# -gt 0 ]]; then
	export IGNITE_SHOT_CARS="$(IFS=,; echo "$*")"
fi

if command -v nix >/dev/null 2>&1; then
	exec nix shell nixpkgs#electron -c electron "$ROOT/scripts/screenshot-garage-cars.cjs" --no-sandbox
fi
exec npx electron "$ROOT/scripts/screenshot-garage-cars.cjs" --no-sandbox
