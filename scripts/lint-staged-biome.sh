#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ARGS=(check --write --error-on-warnings --no-errors-on-unmatched ./src)

if command -v nix >/dev/null 2>&1 && [[ -f flake.nix ]]; then
	exec nix develop -c biome "${ARGS[@]}"
fi

exec ./node_modules/.bin/biome "${ARGS[@]}"
