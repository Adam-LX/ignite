#!/usr/bin/env bash
# Gemini — audyt ghostingu garażu (klucz: Print Screen = OK, animacja = rozdwojone)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/screenshots/gemini-garage-ghost-$(date +%Y%m%d-%H%M%S).json"
mkdir -p "$ROOT/screenshots"

PROMPT='Jesteś ekspertem WebGL/Three.js, Chromium compositor (Wayland/Electron) i post-processingu.

SYMPTOM KRYTYCZNY (Ignite garaż):
- Auto 3D wygląda ROZDWOJONE podczas animacji (obrót + kamera).
- Po wciśnięciu Print Screen / zrzut ekranu — w kadrze auto jest NORMALNE (pojedyncze).
- To NIE jest statyczny podwójny mesh — problem czasowy / compositing / bufor klatek.

JUŻ WDROŻONE (nie powtarzaj bez weryfikacji):
- MSAA composera = 0 w menu/garażu
- Bloom wyłączony w garażu (bloomPass.enabled=false)
- DoF wyłączone w menu/garażu (shader + TS)
- backdrop-filter: none na .garage-overlay w garażu
- Cienie hero wyłączone w garażu, shadowMap.autoUpdate=false
- Kurz menu ukryty w garażu

ARCHITEKTURA:
- Electron fullscreen, GNOME Wayland, RTX 5070 Ti
- #game-container z-index 0, canvas WebGL
- .garage-overlay position:fixed inset:0 z-index:1001 NAD canvasem (grid: header | main | footer)
- EffectComposer: RenderPass → UnrealBloomPass (off) → cinematicPostFx → OutputPass
- heroCar.rotation.y += idlePhase * 0.28 ORAZ camera garageTurntable += 0.38 (DWA ruchy)
- MenuCinematicCamera: smoothed lerp pozycji kamery (inercja)

HIPOTEZY DO RANKINGU (szczególnie pod Print Screen):
1. Fullscreen HTML layer nad WebGL → desync warstw compositora (stara+nowa klatka widoczne naraz)
2. EffectComposer / RT ping-pong — resztkowy trail mimo wyłączonego bloom
3. Podwójny ruch: obrót auta + orbita kamery = smuga bez velocity buffer
4. WebGL antialias + composer OutputPass — podwójne prezentowanie
5. Vignette overlay (ui-vignette-on) nad środkiem boiska
6. Rzeczywisty duplicate mesh (mało prawdopodobne przy OK screenshot)

ZADANIE — odpowiedz TYLKO poprawny JSON (bez markdown, bez ```):
{
  "diagnosis": "1-2 zdania — dlaczego Print Screen naprawia obraz",
  "confidence": 0.0-1.0,
  "rootCause": "compositor|postprocess|dual_motion|duplicate_mesh|other",
  "rankedCauses": [{"id":"", "likelihood":"high|medium|low", "mechanism":"", "printScreenClue":""}],
  "fixes": [{"priority":1, "area":"css|three|electron|both", "change":"konkretna zmiana", "keepsAnimations":true}],
  "verification": ["krok QA"]
}'

RAW="$("$ROOT/scripts/gemini-consult.sh" \
	--context "$ROOT/src/ui/LiveMainMenuScene.ts" \
	--context "$ROOT/src/Renderer.ts" \
	--context "$ROOT/src/visual/menuCinematicCamera.ts" \
	--context "$ROOT/src/menu.css" \
	--context "$ROOT/src/visual/garagePresentationPolicy.ts" \
	"$PROMPT" 2>&1)" || true

TEXT=$(echo "$RAW" | sed -n '/---GEMINI_RESPONSE_START---/,/---GEMINI_RESPONSE_END---/p' | sed '1d;$d')
JSON=$(echo "$TEXT" | sed -n '/^```json/,/^```/p' | sed '1d;$d')
if [[ -z "$JSON" ]]; then
	JSON=$(echo "$TEXT" | tr -d '\r' | awk 'BEGIN{p=0} /^\{/{p=1} p{print} /^\}/{exit}')
fi

if [[ -n "$JSON" ]] && echo "$JSON" | jq empty 2>/dev/null; then
	jq -n --arg prompt "$PROMPT" --argjson audit "$JSON" \
		'{prompt: $prompt, audit: $audit, symptom: "print_screen_ok_during_animation_ghost"}' >"$OUT"
	echo "OK: $OUT"
	jq -r '.audit.diagnosis, "", "rootCause: \(.audit.rootCause // "?")", "", (.audit.fixes[]? | "[P\(.priority)] \(.area): \(.change)")' "$OUT"
else
	echo "$RAW"
	echo "WARN: nieparsowalny JSON" >&2
	exit 1
fi
