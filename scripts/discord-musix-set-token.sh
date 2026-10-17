#!/usr/bin/env bash
# Zapisz DISCORD_BOT_TOKEN i włącz checklistę Musix.
set -euo pipefail
ENV_FILE="${HOME}/.config/ignite/discord.env"
META="${HOME}/.config/ignite/discord-server.json"
CLIENT_ID="$(grep -E '^DISCORD_CLIENT_ID=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2- || true)"
GUILD_ID="$(python3 -c "import json;print(json.load(open('${META}'))['guildId'])" 2>/dev/null || true)"

mkdir -p "$(dirname "${ENV_FILE}")"
chmod 700 "$(dirname "${ENV_FILE}")" 2>/dev/null || true

echo ""
echo "=== Ignite Musix — token bota ==="
echo "1) Otwórz: https://discord.com/developers/applications/${CLIENT_ID:-APP}/bot"
echo "2) Reset Token → skopiuj"
echo "3) Message Content Intent → ON → Save Changes"
echo ""

if [[ -n "${1:-}" ]]; then
	TOKEN="$1"
else
	read -rsp "Wklej Bot Token (niewidoczny): " TOKEN
	echo ""
fi

if [[ -z "${TOKEN}" ]]; then
	echo "Pusty token — anuluję." >&2
	exit 1
fi

# Zachowaj CLIENT_ID / GUILD_ID
CID="${CLIENT_ID}"
GID="${GUILD_ID:-}"
if [[ -f "${ENV_FILE}" ]]; then
	CID="$(grep -E '^DISCORD_CLIENT_ID=' "${ENV_FILE}" | cut -d= -f2- || true)"
	GID="$(grep -E '^DISCORD_GUILD_ID=' "${ENV_FILE}" | cut -d= -f2- || true)"
fi
GID="${GID:-${GUILD_ID}}"

cat >"${ENV_FILE}" <<EOF
# Ignite Discord — chmod 600
DISCORD_CLIENT_ID=${CID}
DISCORD_BOT_TOKEN=${TOKEN}
DISCORD_GUILD_ID=${GID}
EOF
chmod 600 "${ENV_FILE}"
echo "Zapisano ${ENV_FILE}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ ! -f "${META}" ]] || ! grep -q '"musix"' "${META}" 2>/dev/null; then
	echo "Tworzę kanały Musix…"
	node "${ROOT}/scripts/discord-ensure-musix.mjs" || true
fi

echo ""
echo "OK. Odpal bota:"
echo "  bash ${ROOT}/scripts/discord-musix-run.sh"
echo "albo w tle:"
echo "  systemctl --user enable --now ignite-musix"
echo ""
echo "W #musix (STAFF): wklej YT → playlista na żywo (kto/kiedy/co + ▶ teraz)."
