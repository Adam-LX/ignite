#!/usr/bin/env bash
# Pętla audytu wizualnego: screenshoty aut (factory + dune) → Gemini Vision → JSON z fixami
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT_DIR="$ROOT/screenshots/cars-audit"
AUDIT_JSON="$OUT_DIR/audit-visual-${STAMP}.json"
GEMINI_OUT="$ROOT/screenshots/gemini-cars-audit-${STAMP}.json"
mkdir -p "$OUT_DIR"

export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS="${PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS:-1}"
CHROMIUM_STORE="$(nix build --no-link --print-out-paths nixpkgs#chromium 2>/dev/null || true)"
if [[ -n "${CHROMIUM_STORE}" && -x "${CHROMIUM_STORE}/bin/chromium" ]]; then
	export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${CHROMIUM_STORE}/bin/chromium"
fi

echo "=== [1/5] Build web ==="
cd "$ROOT"
if [[ "${SKIP_E2E_BUILD:-0}" != "1" ]]; then
	nix develop -c bash -c 'SKIP_MP_BAKE=1 npm run build:web:desktop'
fi

echo "=== [2/5] Screenshots — factory (default) ==="
nix develop -c env IGNITE_AUDIT_WHEEL=default node scripts/garage-cars-gemini-audit.mjs
AUDIT_DEFAULT=$(ls -t "$OUT_DIR"/audit-*.json 2>/dev/null | head -1)

echo "=== [3/5] Screenshots — dune (cross-car) ==="
nix develop -c env IGNITE_AUDIT_WHEEL=dune node scripts/garage-cars-gemini-audit.mjs
AUDIT_DUNE=$(ls -t "$OUT_DIR"/audit-*.json 2>/dev/null | head -1)

# Połącz oba audyty w jeden JSON
jq -n \
	--arg stamp "$STAMP" \
	--slurpfile def "${AUDIT_DEFAULT:-/dev/null}" \
	--slurpfile dune "${AUDIT_DUNE:-/dev/null}" \
	'{
		stamp: $stamp,
		factory: (if ($def|length)>0 then $def[0] else null end),
		dune: (if ($dune|length)>0 then $dune[0] else null end),
		cars: (
			(if ($def|length)>0 then $def[0].cars else []) as $dc |
			(if ($dune|length)>0 then $dune[0].cars else []) as $uc |
			[$dc[] | . as $c | ($uc[] | select(.carId == $c.carId)) as $u |
				$c + {duneProbe: $u.probe, duneScreenshot: $u.screenshot}]
		)
	}' >"$AUDIT_JSON" 2>/dev/null || cp "$AUDIT_DEFAULT" "$AUDIT_JSON"

echo "=== [4/5] Gemini Vision (wygląd — factory + dune) ==="
IMG_ARGS=()
TMP_IMG_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_IMG_DIR"' EXIT
while IFS= read -r shot; do
	[[ -f "$shot" ]] || continue
	small="$TMP_IMG_DIR/$(basename "$shot" .png)-sm.jpg"
	if command -v magick >/dev/null 2>&1; then
		magick "$shot" -resize 960x540 -quality 82 "$small"
	elif command -v convert >/dev/null 2>&1; then
		convert "$shot" -resize 960x540 -quality 82 "$small"
	else
		cp "$shot" "$small.png"
		small="$small.png"
	fi
	IMG_ARGS+=(--image "$small")
done < <(jq -r '.cars[] | .screenshot, .duneScreenshot? // empty' "$AUDIT_JSON" | sort -u)

TECH_CONTEXT='AUDYT WIZUALNY FlyBall — PRIORYTET: JAK TO WYGLĄDA NA SCREENSHOCIE.

Każdy screenshot = auto w garażu 3D (menuHeroCar, skala ~2.45x).
Dla każdego auta masz 2 ujęcia: wheel=default (factory procedural) i wheel=dune (wycięte z buggy).

OCENIAJ WYŁĄCZNIE WIZUALNIE:
1) Czy koła DOTYKAJĄ murawy i siedzą w nadkolach (nie unoszą się, nie są pionowymi płytami)?
2) Czy widać resztki baked wheels (żółte/brązowe cylindry, zapas z tyłu buggy)?
3) Czy factory vs dune wygląda sensownie cross-car (sleek+muscles na dune)?
4) Czy karoseria jest kompletna (brak dziur, white fins artefakty)?

Probe JSON (metry, world Y):
- rimFlGeomMinWorldY ≈ 0.072 = OK styk z murawą
- cosmeticRims=4, strayWheelMeshes=0 = OK technicznie (ale Ty oceniasz SCREENSHOT)

PIPELINE (kontekst): Trellis→Blender prep (strip OFF)→procedural wheels (+X axis) lub extracted dune.glb

ZADANIE — JSON TYLKO:
{
  "summary": "1-2 zdania po polsku — ogólny wygląd",
  "visualScore": 0.0,
  "confidence": 0.0,
  "perCar": [{
    "carId": "",
    "factoryVisual": "ok|wheels_float|wheels_vertical|baked_residue|body_artifacts|misaligned",
    "duneVisual": "ok|...",
    "factoryVsDune": "",
    "severity": 0,
    "notes": ""
  }],
  "rankedFixes": [{"priority":1,"file":"","change":"","acceptance":"wygląda OK na screenshocie"}],
  "cursorAgentPrompt": "jeden akapit po polsku — następna iteracja pod WYGLĄD",
  "verification": ["npm run cars:audit", "screenshot compare"]
}'

PROBE_JSON=$(jq -c '.cars' "$AUDIT_JSON")

RAW="$("$ROOT/scripts/gemini-consult.sh" \
	--model "${GEMINI_VISION_MODEL:-gemini-2.5-flash-lite}" \
	--json \
	--context "$ROOT/public/assets/cars/car-catalog.json" \
	--context "$ROOT/src/visual/wheelMount.ts" \
	"${IMG_ARGS[@]}" \
	"$TECH_CONTEXT

Probe + screenshot paths (JSON):
$PROBE_JSON" 2>&1)" || true

TEXT=$(echo "$RAW" | sed -n '/---GEMINI_RESPONSE_START---/,/---GEMINI_RESPONSE_END---/p' | sed '1d;$d')
JSON=$(echo "$TEXT" | sed -n '/^```json/,/^```/p' | sed '1d;$d')
if [[ -z "$JSON" ]]; then
	JSON=$(echo "$TEXT" | tr -d '\r' | awk 'BEGIN{p=0} /^\{/{p=1} p{print} /^\}/{exit}')
fi

if [[ -n "$JSON" ]] && echo "$JSON" | jq empty 2>/dev/null; then
	GEMINI_JSON_FILE=$(mktemp)
	echo "$JSON" >"$GEMINI_JSON_FILE"
	jq -n \
		--arg audit "$AUDIT_JSON" \
		--slurpfile gemini "$GEMINI_JSON_FILE" \
		'{localAudit: $audit, gemini: $gemini[0]}' >"$GEMINI_OUT"
	rm -f "$GEMINI_JSON_FILE"
	echo "OK: $GEMINI_OUT"
	jq -r '.gemini.summary, "", "visualScore: \(.gemini.visualScore // "n/a")", "", .gemini.cursorAgentPrompt, "", (.gemini.rankedFixes[]? | "[P\(.priority)] \(.file): \(.change)")' "$GEMINI_OUT"
else
	echo "$RAW" | tail -80
	jq -n --arg audit "$AUDIT_JSON" --arg raw "$TEXT" \
		'{localAudit: $audit, geminiRaw: $raw}' >"$GEMINI_OUT"
	echo "WARN: nieparsowalny JSON Gemini — geminiRaw w $GEMINI_OUT" >&2
	exit 0
fi

echo "=== [5/5] Gotowe ==="
