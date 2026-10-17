#!/usr/bin/env bash
# Uruchom bot Musix (kolejka YouTube na Discord Ignite).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="${ROOT}/scripts/discord-musix"
ENV_FILE="${HOME}/.config/ignite/discord.env"
META="${HOME}/.config/ignite/discord-server.json"

# Prefer system node/npm; fallback do nix store nodejs pełnego.
if ! command -v node >/dev/null 2>&1 || [[ "$(command -v node)" == *cursor-agent* ]]; then
	for n in /nix/store/*/bin/node; do
		if [[ -x "$n" && "$n" == *nodejs-24* && "$n" != *slim* && "$n" != *cursor* ]]; then
			export PATH="$(dirname "$n"):$PATH"
			break
		fi
	done
fi
if ! command -v npm >/dev/null 2>&1; then
	for n in /nix/store/*/bin/npm; do
		if [[ -x "$n" && "$n" == *nodejs-24* && "$n" != *slim* ]]; then
			export PATH="$(dirname "$n"):$PATH"
			break
		fi
	done
fi

if [[ ! -f "${ENV_FILE}" ]] || ! grep -q 'DISCORD_BOT_TOKEN=.' "${ENV_FILE}" 2>/dev/null; then
	if [[ -z "${DISCORD_BOT_TOKEN:-}" ]]; then
		echo "Brak DISCORD_BOT_TOKEN w ${ENV_FILE}" >&2
		echo "  Uzupełnij token bota (Discord Developer Portal → Bot → Reset Token)" >&2
		echo "  Włącz też: Message Content Intent" >&2
		exit 1
	fi
fi

if [[ ! -f "${META}" ]] || ! grep -q '"musix"' "${META}" 2>/dev/null; then
	echo "Brak channels.musix w meta — tworzę kanały…"
	node "${ROOT}/scripts/discord-ensure-musix.mjs"
fi

if [[ ! -d "${PKG}/node_modules/discord.js" ]]; then
	echo "npm install w scripts/discord-musix…"
	(cd "${PKG}" && npm install --no-fund --no-audit)
fi

if ! command -v yt-dlp >/dev/null 2>&1; then
	echo "Brak yt-dlp w PATH" >&2
	exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
	echo "Brak ffmpeg w PATH (wymagane przez @discordjs/voice)" >&2
	exit 1
fi

echo "Start Musix bot…"
echo "  Intent: Message Content musi być ON w Discord Developer Portal"
exec node "${ROOT}/scripts/discord-musix-bot.mjs"
