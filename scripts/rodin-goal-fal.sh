#!/usr/bin/env bash
# Generuj bramkę Rodin Gen-2.5 przez fal.ai (~$0.40 / gen).
# Hyper3D Creator = kredyty na stronie; API = osobny FAL_KEY.
#
#   export FAL_KEY='...'   # https://fal.ai/dashboard/keys
#   ./scripts/rodin-goal-fal.sh
#   ./scripts/install-rodin-goal.sh ~/Pobrane/goalFrame-rodin.glb

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONCEPT="${1:-$ROOT/public/assets/arenas/standard/concepts/goalFrame_front.png}"
OUT="${2:-$HOME/Pobrane/goalFrame-rodin.glb}"
PROMPT_FILE="$HOME/Pobrane/rodin-goal-prompt.txt"
MODEL="fal-ai/hyper3d/rodin/v2.5"

if [[ -z "${FAL_KEY:-}" ]]; then
  cat <<EOF
Brak FAL_KEY — nie mogę odpalić Rodina z CLI.

Opcja A (najszybsza z Twoim Creator):
  1) https://hyper3d.ai/  (już otwarte)
  2) Upload: $CONCEPT
  3) Prompt: $PROMPT_FILE
  4) Confirm geo → Confirm material → Download .glb
  5) Zapisz jako ~/Pobrane/goalFrame-rodin.glb
  6) ./scripts/install-rodin-goal.sh

Opcja B (API, bez klikania):
  1) https://fal.ai/dashboard/keys  → utwórz klucz
  2) export FAL_KEY='...'
  3) ./scripts/rodin-goal-fal.sh
EOF
  exit 2
fi

[[ -f "$CONCEPT" ]] || { echo "Brak konceptu: $CONCEPT"; exit 1; }

PROMPT=$(
  if [[ -f "$PROMPT_FILE" ]]; then cat "$PROMPT_FILE"
  else echo "Sleek cyberpunk soccer goal frame, OPEN empty mouth, tubular rounded posts, watertight metal, no holes, no net mesh, no floor"
  fi | tr '\n' ' ' | sed 's/"/\\"/g'
)

echo "Upload konceptu na fal.storage…"
# fal storage: POST https://fal.media/files/upload  (or use data URI for small PNG)
B64=$(base64 -w0 "$CONCEPT")
DATA_URI="data:image/png;base64,$B64"

echo "Submit $MODEL (Gen-2.5 High, Quad — 1–3 min)…"
RESP=$(curl -sS -X POST "https://queue.fal.run/${MODEL}" \
  -H "Authorization: Key ${FAL_KEY}" \
  -H "Content-Type: application/json" \
  -d "{
    \"prompt\": \"${PROMPT}\",
    \"image_urls\": [\"${DATA_URI}\"],
    \"tier\": \"Gen-2.5-High\",
    \"geometry_file_format\": \"glb\",
    \"material\": \"PBR\",
    \"quality_mesh_option\": \"500K Quad\",
    \"texture_delight\": true
  }")

REQ=$(echo "$RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("request_id") or d.get("requestId") or "")')
STATUS_URL=$(echo "$RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("status_url") or "")')
RESP_URL=$(echo "$RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("response_url") or "")')

if [[ -z "$REQ" ]]; then
  echo "Submit fail:"
  echo "$RESP" | head -c 1200
  echo
  exit 1
fi
echo "request_id=$REQ"

# Poll
for i in $(seq 1 120); do
  ST=$(curl -sS -H "Authorization: Key ${FAL_KEY}" \
    "${STATUS_URL:-https://queue.fal.run/${MODEL}/requests/${REQ}/status}")
  STATE=$(echo "$ST" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("status") or d.get("detail") or "?")' 2>/dev/null || echo '?')
  echo "  [$i] $STATE"
  case "$STATE" in
    COMPLETED|OK|completed) break ;;
    FAILED|ERROR|failed)
      echo "$ST" | head -c 1500
      exit 1
      ;;
  esac
  sleep 5
done

RESULT=$(curl -sS -H "Authorization: Key ${FAL_KEY}" \
  "${RESP_URL:-https://queue.fal.run/${MODEL}/requests/${REQ}}")

URL=$(echo "$RESULT" | python3 -c '
import sys,json
d=json.load(sys.stdin)
m=d.get("model_mesh") or {}
print(m.get("url") or "")
')

if [[ -z "$URL" ]]; then
  echo "Brak model_mesh.url:"
  echo "$RESULT" | head -c 2000
  exit 1
fi

echo "Download → $OUT"
mkdir -p "$(dirname "$OUT")"
curl -sSL "$URL" -o "$OUT"
echo "OK $(du -h "$OUT" | cut -f1)  →  ./scripts/install-rodin-goal.sh \"$OUT\""
