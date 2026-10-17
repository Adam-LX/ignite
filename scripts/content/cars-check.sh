#!/usr/bin/env bash
# Walidacja GLB + probe garażu (Playwright) — pełny check pipeline aut.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "=== [1/3] validate:glb ==="
nix develop -c npm run cars:validate

echo "=== [2/3] build:web:desktop ==="
nix develop -c bash -c 'SKIP_MP_BAKE=1 npm run build:web:desktop'

echo "=== [3/3] cars:audit ==="
nix develop -c npm run cars:audit

echo "cars:check — OK"
