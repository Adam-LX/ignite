#!/usr/bin/env bash
# Bezpieczny upload screenów na #screenshoty — TYLKO webhook (nie user token).
# Jedna wiadomość, max kilka JPG, bez floodu → nie wywala z DC.
#
# 1) Discord → #screenshoty → Edytuj kanał → Integracje → Webhooki → Nowy webhook
# 2) Skopiuj URL do:
#      ~/.config/ignite/discord-screenshots.webhook
#    albo:
#      export DISCORD_SCREENSHOTS_WEBHOOK='https://discord.com/api/webhooks/...'
# 3) bash scripts/discord-post-screenshots.sh [katalog-jpg]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${1:-$ROOT/screenshots/discord-promo/jpg}"
WEBHOOK="${DISCORD_SCREENSHOTS_WEBHOOK:-}"
if [[ -z "$WEBHOOK" && -f "$HOME/.config/ignite/discord-screenshots.webhook" ]]; then
  WEBHOOK="$(tr -d ' \n\r' < "$HOME/.config/ignite/discord-screenshots.webhook")"
fi
if [[ -z "$WEBHOOK" || "$WEBHOOK" != https://discord.com/api/webhooks/* ]]; then
  echo "Brak webhooka #screenshoty." >&2
  echo "Utwórz webhook w kanale i zapisz URL:" >&2
  echo "  echo 'https://discord.com/api/webhooks/ID/TOKEN' > ~/.config/ignite/discord-screenshots.webhook" >&2
  echo "  chmod 600 ~/.config/ignite/discord-screenshots.webhook" >&2
  exit 2
fi

mapfile -t FILES < <(find "$DIR" -maxdepth 1 -type f \( -name '*.jpg' -o -name '*.jpeg' -o -name '*.png' \) | sort)
if ((${#FILES[@]} == 0)); then
  echo "Brak plików w $DIR" >&2
  exit 1
fi
# Discord: max 10 załączników / msg; trzymaj mało i lekkie JPG
FILES=("${FILES[@]:0:8}")

echo "Postuję ${#FILES[@]} plików → #screenshoty (1 request)…"
ARGS=(-F "payload_json={\"content\":\"**Ignite** — świeże screeny z meczu / areny\",\"username\":\"Ignite Screens\"}")
i=0
for f in "${FILES[@]}"; do
  ARGS+=(-F "files[$i]=@${f}")
  ((i++)) || true
done

code=$(curl -sS -o /tmp/ignite-dc-upload.json -w '%{http_code}' \
  "${ARGS[@]}" \
  "$WEBHOOK")
echo "HTTP $code"
python3 - <<'PY'
import json
try:
  d=json.load(open('/tmp/ignite-dc-upload.json'))
  if 'id' in d:
    print('OK message id', d['id'], 'channel', d.get('channel_id'))
  else:
    print(d)
except Exception as e:
  print(open('/tmp/ignite-dc-upload.json').read()[:500], e)
PY
[[ "$code" == "200" ]]
