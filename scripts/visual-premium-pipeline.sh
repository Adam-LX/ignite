#!/usr/bin/env bash
# Premium visual pass — FlyBall / Ignite (ComfyUI, Blender, opcjonalnie Meshy).
#   cd ~/Dokumenty/Projekty/FlyBall && ./scripts/visual-premium-pipeline.sh
#   ./scripts/visual-premium-pipeline.sh grass    # tylko murawa
#   ./scripts/visual-premium-pipeline.sh consult  # Gemini API (wymaga ~/.config/gemini/api_key)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

step() { echo "==> $*"; }

grass() {
	step "Murawa PBR — ComfyUI :8188"
	if ! curl -sf http://127.0.0.1:8188/system_stats >/dev/null 2>&1; then
		echo "ComfyUI offline. Uruchom kontener lub: comfyui / podman start comfyui"
		exit 1
	fi
	python3 scripts/generate_grass_comfyui.py
	step "Po wygenerowaniu: odśwież manifest jeśli używasz Meshy arena"
	echo "  npm run meshy:sync-manifest   # opcjonalnie"
}

car_comfy() {
	step "Retexture auta — ComfyUI"
	python3 scripts/generate_car_comfyui.py
}

car_blender() {
	step "Eksport auta z Blendera (AO bake — ręcznie w UI, potem export)"
	if command -v blender >/dev/null; then
		FLYBALL_ROOT="$ROOT" blender --background --python scripts/blender_export_car.py
	else
		echo "Brak blender w PATH — nix develop lub systemowy pakiet"
		exit 1
	fi
}

consult() {
	step "Konsultacja Gemini (gemini-3.1-flash-lite, free tier)"
	./scripts/gemini-consult.sh --context ROADMAP.md --context docs/MESHY.md \
		"Stan wizualny Ignite po premium pass (bloom, contact shadow, grass AO). Co jeszcze P0 przed v0.2.0? Konkretnie: plik, narzędzie, efekt. Po polsku."
}

case "${1:-all}" in
	grass) grass ;;
	car-comfy) car_comfy ;;
	car-blender) car_blender ;;
	consult) consult ;;
	all)
		consult || true
		if curl -sf http://127.0.0.1:8188/system_stats >/dev/null 2>&1; then
			grass || true
		else
			echo "(pominięto grass — ComfyUI offline)"
		fi
		echo ""
		echo "Gotowe w kodzie: bloom+, contact shadow, grass AO, power-up emissive, ball trail."
		echo "Następny krok assetów: car AO w Blenderze → car.glb / car_orange.glb"
		;;
	*)
		echo "Użycie: $0 {all|grass|car-comfy|car-blender|consult}"
		exit 1
		;;
esac
