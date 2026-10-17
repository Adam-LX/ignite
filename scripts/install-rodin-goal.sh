#!/usr/bin/env bash
# Podłącz GLB z Rodina (po ręcznym Confirm → Download).
# Użycie:
#   1) W Hyper3D: Confirm geometrii → Confirm materiału → Download .glb
#   2) Zapisz jako ~/Pobrane/goalFrame-rodin.glb  (albo podaj ścieżkę)
#   3) ./scripts/install-rodin-goal.sh [ścieżka.glb]

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$HOME/Pobrane/goalFrame-rodin.glb}"
DEST="$ROOT/public/assets/arenas/standard/props/goalFrame.glb"
REJ="$ROOT/public/assets/arenas/standard/props/_rejected"

if [[ ! -f "$SRC" ]]; then
  echo "Brak pliku: $SRC"
  echo "Pobierz GLB z Rodina (Pack → .glb) i zapisz jako ~/Pobrane/goalFrame-rodin.glb"
  exit 1
fi

size=$(stat -c%s "$SRC")
if (( size < 400000 )); then
  echo "Plik za mały ($size B) — to pewnie nie pełny mesh."
  exit 1
fi

mkdir -p "$REJ"
if [[ -f "$DEST" ]]; then
  cp -f "$DEST" "$REJ/goalFrame-before-rodin-$(date +%Y%m%d-%H%M%S).glb"
fi
cp -f "$SRC" "$DEST"

# Włącz GLB w meczu (FORCE_GLB_GOAL)
GOAL_TS="$ROOT/src/visual/GoalVisual.ts"
if grep -q 'const FORCE_GLB_GOAL = false' "$GOAL_TS"; then
  sed -i 's/const FORCE_GLB_GOAL = false/const FORCE_GLB_GOAL = true/' "$GOAL_TS"
  echo "FORCE_GLB_GOAL=true"
fi

date -Iseconds > "$ROOT/.ignite-dev.stamp"
echo "OK → $DEST ($(du -h "$DEST" | cut -f1))"
echo "Ctrl+Shift+R w grze."
