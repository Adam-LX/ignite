#!/usr/bin/env bash
# Gemini → data/content/*.design.json (M5 Content System)
#   ./scripts/content/gemini-design-pass.sh
#   ./scripts/content/gemini-design-pass.sh --skip-api   # tylko walidacja istniejących plików
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_CARS="$ROOT/data/content/cars.design.json"
OUT_ARENAS="$ROOT/data/content/arenas.design.json"
SKIP_API=false

for arg in "$@"; do
	[[ "$arg" == "--skip-api" ]] && SKIP_API=true
done

validate_json() {
	local f="$1"
	jq empty "$f" >/dev/null
	echo "OK: $f"
}

if [[ "$SKIP_API" == true ]]; then
	validate_json "$OUT_CARS"
	validate_json "$OUT_ARENAS"
	exit 0
fi

PROMPT='Wygeneruj TYLKO jeden blok JSON (bez markdown) w formacie:
{
  "cars": [ { "id", "nameKey", "rarity", "bodyStyle", "defaultUnlocked", "trellisPrompt" } ],
  "arenas": [ { "id", "nameKey", "defaultUnlocked", "dimensions": { width,length,height,cornerCut,goalWidth,goalHeight,goalDepth,rampSize }, "perimeterPreset", "atmosphere", "spawns", "boostPads", "trellisProps" } ]
}
Wymagania aut: 8-10 sztuk, wspólny hitbox Ignite Standard (tylko kosmetyka), prompty Trellis pod GLB 1.18m oś +Z. Nazwy własne (Puls, Tytan, Spektrum…) — NIE Rocket League/Octane.
Wymagania aren: 4-6 map, standard=80x120, compact mniejsza, wide szersza, jedna customEdges.
Rarity: common|rare|epic|legendary. nameKey: garage.car.* i arena.*'

RESP_FILE="$ROOT/screenshots/gemini-consult-content-$(date +%Y%m%d-%H%M%S).json"
mkdir -p "$ROOT/data/content" "$ROOT/screenshots"

if ! RAW="$("$ROOT/scripts/gemini-consult.sh" \
	--context "$ROOT/ROADMAP.md" \
	--context "$ROOT/docs/MESHY.md" \
	--context "$ROOT/public/assets/cars/car-catalog.json" \
	--context "$ROOT/src/visual/arenaConstants.ts" \
	"$PROMPT" 2>/dev/null)"; then
	echo "Gemini niedostępny — zostawiam istniejące pliki design." >&2
	validate_json "$OUT_CARS"
	validate_json "$OUT_ARENAS"
	exit 0
fi

TEXT=$(echo "$RAW" | sed -n '/---GEMINI_RESPONSE_START---/,/---GEMINI_RESPONSE_END---/p' | sed '1d;$d')
JSON=$(echo "$TEXT" | sed -n '/^```json/,/^```/p' | sed '1d;$d')
[[ -z "$JSON" ]] && JSON=$(echo "$TEXT" | tr -d '\r' | grep -m1 '^{' || true)

if [[ -z "$JSON" ]] || ! echo "$JSON" | jq -e '.cars and .arenas' >/dev/null 2>&1; then
	echo "Gemini zwrócił nieparsowalny JSON — zostawiam istniejące pliki." >&2
	validate_json "$OUT_CARS"
	validate_json "$OUT_ARENAS"
	exit 0
fi

jq -n \
	--argjson cars "$(echo "$JSON" | jq '.cars')" \
	--argjson arenas "$(echo "$JSON" | jq '.arenas')" \
	'{
	  schemaVersion: 1,
	  generatedBy: "gemini-design-pass",
	  constraints: {
	    hitboxProfile: "octane",
	    targetLengthM: 1.18,
	    forwardAxis: "+Z",
	    wheelNames: ["wheel_FL","wheel_FR","wheel_RL","wheel_RR"]
	  },
	  cars: $cars
	}' >"$OUT_CARS"

jq -n \
	--argjson arenas "$(echo "$JSON" | jq '.arenas')" \
	'{
	  schemaVersion: 1,
	  generatedBy: "gemini-design-pass",
	  arenas: $arenas
	}' >"$OUT_ARENAS"

echo "$JSON" | jq '{cars: (.cars | length), arenas: (.arenas | length)}' >"$RESP_FILE"
ln -sf "$(basename "$RESP_FILE")" "$ROOT/screenshots/gemini-last-content-design.json"

validate_json "$OUT_CARS"
validate_json "$OUT_ARENAS"
echo "Zapisano: $OUT_CARS, $OUT_ARENAS"
