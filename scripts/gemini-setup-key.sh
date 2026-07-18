#!/usr/bin/env bash
# Zapis klucza Gemini API (darmowy tier AI Studio) — poza repo, chmod 600.
#   ./scripts/gemini-setup-key.sh              # interaktywnie
#   ./scripts/gemini-setup-key.sh AIzaSy...  # z argumentu
set -euo pipefail

KEY_FILE="${GEMINI_API_KEY_FILE:-$HOME/.config/gemini/api_key}"
mkdir -p "$(dirname "$KEY_FILE")"
chmod 700 "$(dirname "$KEY_FILE")"

if [[ -n "${1:-}" ]]; then
	KEY="$1"
elif [[ -t 0 ]] && [[ -t 1 ]]; then
	echo "Otwórz: https://aistudio.google.com/app/apikey"
	echo "→ Utwórz klucz API (darmowy tier, bez karty jeśli nie wymaga)."
	echo ""
	read -rsp "Wklej klucz (AIza...): " KEY
	echo ""
else
	echo "Użycie: $0 AIzaSy...   lub uruchom interaktywnie w terminalu" >&2
	exit 1
fi

KEY="${KEY//$'\n'/}"
KEY="${KEY//[[:space:]]/}"

if [[ ! "$KEY" =~ ^(AIza[0-9A-Za-z_-]{30,}|AQ\.[0-9A-Za-z_-]{20,})$ ]]; then
	echo "Nie wygląda na klucz Gemini API." >&2
	exit 1
fi

printf '%s' "$KEY" >"$KEY_FILE"
chmod 600 "$KEY_FILE"
echo "Zapisano: $KEY_FILE"

# Szybki test (model z darmowego tieru)
if command -v curl >/dev/null; then
	HTTP=$(curl -s -o /tmp/gemini-key-test.json -w '%{http_code}' \
		"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${KEY}" \
		-H 'Content-Type: application/json' \
		-d '{"contents":[{"parts":[{"text":"Odpowiedz jednym słowem: OK"}]}],"generationConfig":{"maxOutputTokens":16}}')
	if [[ "$HTTP" == "200" ]]; then
		echo "Test API: OK (gemini-2.5-flash-lite, free tier)"
	else
		echo "Test API: HTTP $HTTP — sprawdź klucz / limity:"
		head -c 300 /tmp/gemini-key-test.json
		echo ""
	fi
fi
