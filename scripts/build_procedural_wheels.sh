#!/usr/bin/env bash
# Proceduralne felgi FlyBall (Blender) — zastępuje złe eksporty Trellis.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BLENDER="$(command -v blender 2>/dev/null || true)"
if [[ -z "$BLENDER" ]]; then
  BLENDER="$(ls -d /nix/store/*-blender-*/bin/blender 2>/dev/null | tail -1 || true)"
fi
if [[ -z "$BLENDER" ]]; then
  echo "Brak blender w PATH" >&2
  exit 1
fi

OUT_DIR="$ROOT/public/assets/items/wheels"
mkdir -p "$OUT_DIR"

for style in factory steel rally neon chrome; do
  out="$OUT_DIR/${style}.glb"
  echo "→ $style → $out"
  "$BLENDER" --background --python "$ROOT/scripts/blender_gen_wheel.py" -- "$style" "$out"
done

# default = factory (osobny plik dla katalogu)
cp -f "$OUT_DIR/factory.glb" "$OUT_DIR/default.glb" 2>/dev/null || true

echo "Gotowe: $OUT_DIR/*.glb"
