#!/usr/bin/env bash
# Gemini — audyt systemu wymiany kół (garaż + mecz + GLB pipeline)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/screenshots/gemini-wheel-system-$(date +%Y%m%d-%H%M%S).json"
mkdir -p "$ROOT/screenshots"

PROMPT='Jesteś ekspertem Three.js, pipeline GLB (Blender/Trellis) i kosmetyków Rocket League.

SYMPTOM (garaż FlyBall):
- Auto z wheelWellMode=empty (np. hatch).
- Felgi kosmetyczne na hubach, ale NAD/POD autem wiszą duże ciemnoszare cylindry (stock GLB / złe skale).
- Artefakty w centrum felg — nakładanie stock + cosmetic.

PIPELINE (kod):
- prepareCarWheelWellsForLoad → purgeStray + stripStock + repositionEmptyWheelHubsFromBody
- mountWheelGlb → clearHubForCosmeticMount + alignWheelInstanceOnHub (referenceDiameterM 0.35 → car wheelMounts ~0.25m)
- cosmetic_rim_wheel_XX na hubach wheel_FL/FR/RL/RR

ZADANIE — TYLKO JSON:
{
  "diagnosis": "",
  "confidence": 0.0,
  "wheelSystemSpec": {
    "pipeline": [],
    "hubContract": "",
    "wheelGlbContract": "",
    "scalingRule": ""
  },
  "fixes": [{"priority":1,"file":"","change":"","acceptance":""}],
  "verification": []
}'

RAW="$("$ROOT/scripts/gemini-consult.sh" \
	--context "$ROOT/src/visual/wheelMount.ts" \
	--context "$ROOT/src/visual/cosmeticGlb.ts" \
	--context "$ROOT/public/assets/cars/car-catalog.json" \
	--context "$ROOT/public/assets/items/item-catalog.json" \
	--context "$ROOT/scripts/blender_gen_wheel.py" \
	"$PROMPT" 2>&1)" || true

TEXT=$(echo "$RAW" | sed -n '/---GEMINI_RESPONSE_START---/,/---GEMINI_RESPONSE_END---/p' | sed '1d;$d')
JSON=$(echo "$TEXT" | sed -n '/^```json/,/^```/p' | sed '1d;$d')
if [[ -z "$JSON" ]]; then
	JSON=$(echo "$TEXT" | tr -d '\r' | awk 'BEGIN{p=0} /^\{/{p=1} p{print} /^\}/{exit}')
fi

if [[ -n "$JSON" ]] && echo "$JSON" | jq empty 2>/dev/null; then
	jq -n --arg prompt "$PROMPT" --argjson audit "$JSON" \
		'{prompt: $prompt, audit: $audit, symptom: "stray_cylinders_garage_wheels"}' >"$OUT"
	echo "OK: $OUT"
	jq -r '.audit.diagnosis, "", (.audit.fixes[]? | "[P\(.priority)] \(.file): \(.change)")' "$OUT"
else
	echo "$RAW"
	echo "WARN: nieparsowalny JSON" >&2
	exit 1
fi
