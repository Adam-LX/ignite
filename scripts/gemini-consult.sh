#!/usr/bin/env bash
# Konsultacja Gemini API — darmowy model flash, bez przeglądarki.
#   ./scripts/gemini-consult.sh "pytanie"
#   ./scripts/gemini-consult.sh --context ROADMAP.md "co dalej?"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY_FILE="${GEMINI_API_KEY_FILE:-$HOME/.config/gemini/api_key}"
# Darmowy tier AI Studio — Flash, bez karty (limity RPM/RPD w AI Studio)
MODEL="${GEMINI_MODEL:-gemini-3.1-flash-lite}"
OUT_DIR="$ROOT/screenshots"
mkdir -p "$OUT_DIR"

CONTEXT_FILES=()
IMAGE_FILES=()
JSON_MODE=0
ARGS=()
while [[ $# -gt 0 ]]; do
	case "$1" in
		--context)
			CONTEXT_FILES+=("$2")
			shift 2
			;;
		--image)
			IMAGE_FILES+=("$2")
			shift 2
			;;
		--model)
			MODEL="$2"
			shift 2
			;;
		--json)
			JSON_MODE=1
			shift
			;;
		*)
			ARGS+=("$1")
			shift
			;;
	esac
done

PROMPT="${ARGS[*]:-}"
if [[ -z "$PROMPT" ]]; then
	echo "Użycie: $0 [--context plik.md] \"pytanie\"" >&2
	exit 1
fi

if [[ -f "$KEY_FILE" ]]; then
	KEY=$(tr -d '[:space:]' <"$KEY_FILE")
elif [[ -n "${GEMINI_API_KEY:-}" ]]; then
	KEY="$GEMINI_API_KEY"
else
	echo "Brak klucza. Uruchom: $ROOT/scripts/gemini-setup-key.sh" >&2
	echo "Albo: https://aistudio.google.com/app/apikey" >&2
	exit 1
fi

CTX_BLOCK=""
for ctx in "${CONTEXT_FILES[@]}"; do
	[[ -f "$ctx" ]] || ctx="$ROOT/$ctx"
	if [[ -f "$ctx" ]]; then
		CTX_BLOCK+=$'\n\n'"### $(basename "$ctx")"$'\n'"$(head -c 8000 "$ctx")"
	fi
done

FULL_PROMPT="$PROMPT"
if [[ -n "$CTX_BLOCK" ]]; then
	FULL_PROMPT="Kontekst projektu:
---
$CTX_BLOCK
---

Pytanie: $PROMPT"
fi

PARTS_FILE=$(mktemp)
BODY_FILE=$(mktemp)
trap 'rm -f "$PARTS_FILE" "$BODY_FILE"' EXIT
jq -n --arg text "$FULL_PROMPT" '[{text: $text}]' >"$PARTS_FILE"
for img in "${IMAGE_FILES[@]}"; do
	[[ -f "$img" ]] || img="$ROOT/$img"
	[[ -f "$img" ]] || continue
	MIME="image/png"
	[[ "$img" =~ \.(jpe?g|JPE?G)$ ]] && MIME="image/jpeg"
	B64_FILE=$(mktemp)
	base64 -w0 "$img" >"$B64_FILE" 2>/dev/null || base64 "$img" | tr -d '\n' >"$B64_FILE"
	jq --rawfile data "$B64_FILE" --arg mime "$MIME" \
		'. + [{inline_data: {mime_type: $mime, data: $data}}]' \
		"$PARTS_FILE" >"${PARTS_FILE}.next"
	mv "${PARTS_FILE}.next" "$PARTS_FILE"
	rm -f "$B64_FILE"
done

GEN_CFG='{"maxOutputTokens": 4096, "temperature": 0.35}'
if [[ "$JSON_MODE" == "1" ]]; then
	GEN_CFG='{"maxOutputTokens": 4096, "temperature": 0.2, "responseMimeType": "application/json"}'
fi

jq -n \
	--slurpfile parts "$PARTS_FILE" \
	--argjson gen "$GEN_CFG" \
	'{contents: [{parts: $parts[0]}], generationConfig: $gen}' \
	>"$BODY_FILE"

RESP=$(curl -sS \
	"https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}" \
	-H 'Content-Type: application/json' \
	-d @"$BODY_FILE")

if echo "$RESP" | jq -e '.error' >/dev/null 2>&1; then
	echo "Błąd API:" >&2
	echo "$RESP" | jq -r '.error.message // .' >&2
	exit 1
fi

TEXT=$(echo "$RESP" | jq -r '[.candidates[0].content.parts[]?.text // empty] | join("")')

TS=$(date +%Y%m%d-%H%M%S)
LOG="$OUT_DIR/gemini-consult-${TS}.json"
jq -n --arg prompt "$PROMPT" --arg model "$MODEL" --arg response "$TEXT" \
	'{prompt: $prompt, model: $model, response: $response}' >"$LOG"
ln -sf "$(basename "$LOG")" "$OUT_DIR/gemini-last-consult.json"

echo "---GEMINI_RESPONSE_START---"
echo "$TEXT"
echo "---GEMINI_RESPONSE_END---"
echo "(log: $LOG)" >&2
