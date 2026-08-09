#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export FLYBALL_ROOT="$PWD"

PYTHON="${PYTHON:-python3}"
BLENDER="${BLENDER:-$(command -v blender || true)}"
if [[ -z "${BLENDER}" ]]; then
	BLENDER="$(ls -d /nix/store/*-blender-*/bin/blender 2>/dev/null | tail -1 || true)"
fi
if [[ -z "${BLENDER}" || ! -x "${BLENDER}" ]]; then
	echo "BŁĄD: nie znaleziono blender — ustaw BLENDER=/ścieżka/do/blender" >&2
	exit 1
fi

echo "=== Blender: ${BLENDER} ==="

echo "=== KROK 1: ComfyUI — grass (wymagane) ==="
if ! "$PYTHON" scripts/generate_grass_comfyui.py; then
	if [[ -f public/assets/textures/_grass_raw.png ]]; then
		echo "ComfyUI niedostępne — używam istniejącego _grass_raw.png"
	else
		echo "BŁĄD: brak ComfyUI i brak _grass_raw.png — uruchom ComfyUI na :8188" >&2
		exit 1
	fi
fi

echo "=== KROK 2: Murawa PBR — bake_grass_maps.py (ffmpeg, bez Blendera) ==="
"$PYTHON" scripts/bake_grass_maps.py

echo "=== KROK 2c: Arena SplatMap — generate_arena_splat_assets.py ==="
"$PYTHON" scripts/generate_arena_splat_assets.py

echo "=== KROK 2b: ComfyUI — cyberpunk skybox ==="
if ! "$PYTHON" scripts/generate_skybox_comfyui.py; then
	if [[ -f public/assets/textures/cyberpunk_skybox.png ]]; then
		echo "ComfyUI niedostępne — używam istniejącego cyberpunk_skybox.png"
	else
		echo "Generuję proceduralny skybox (fallback)"
		"$PYTHON" scripts/generate_skybox_fallback.py
	fi
fi

echo "=== KROK 3: Blender — player_car.glb (sportowy bolid) ==="
"$BLENDER" --background --python scripts/blender_export_car.py

echo "=== Weryfikacja ==="
for f in public/assets/textures/grass_color.jpg public/assets/models/player_car.glb; do
	if [[ ! -f "$f" ]]; then
		echo "BŁĄD: brak $f" >&2
		exit 1
	fi
done
ls -lh public/assets/textures/grass_*.jpg public/assets/models/player_car.glb
"$PYTHON" -c "
from pathlib import Path
p=Path('public/assets/textures/grass_color.jpg')
h=p.read_bytes()[:4]
print('grass_color magic:', h, 'size:', p.stat().st_size)
assert h[:2]==b'\\xff\\xd8', 'grass_color.jpg nie jest JPEG!'
"

echo "=== Gotowe ==="
