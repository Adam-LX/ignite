#!/usr/bin/env bash
# Jednorazowy bootstrap bota Discord + auto-setup serwera.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_DIR="${HOME}/.config/ignite"
ENV_FILE="${ENV_DIR}/discord.env"
SETUP="${ROOT}/scripts/discord-setup-server.mjs"

usage() {
	cat <<EOF
Użycie: $(basename "$0") [run]

  1. Tworzy ~/.config/ignite/discord.env (jeśli brak)
  2. Otwiera Discord Developer Portal + generator linku zaproszenia
  3. Po zapisaniu tokena — uruchamia discord-setup-server.mjs

Kroki (jednorazowo, ~3 min):
  A) Discord → Utwórz PUSTY serwer (Dla mnie i moich znajomych)
  B) developers.discord.com → New Application → Bot → Reset Token → skopiuj
  C) OAuth2 → URL Generator → bot + Administrator → skopiuj link → dodaj bota NA SWÓJ SERWER
  D) Wklej token i Client ID poniżej (lub do ${ENV_FILE})

EOF
}

open_url() {
	local url="$1"
	if command -v xdg-open >/dev/null 2>&1; then
		xdg-open "${url}" >/dev/null 2>&1 || true
	elif command -v brave >/dev/null 2>&1; then
		brave "${url}" >/dev/null 2>&1 || true
	fi
}

prompt_env() {
	mkdir -p "${ENV_DIR}"
	chmod 700 "${ENV_DIR}"

	if [[ -f "${ENV_FILE}" ]] && grep -q "DISCORD_BOT_TOKEN=." "${ENV_FILE}" 2>/dev/null; then
		echo "Znaleziono ${ENV_FILE} — używam istniejącego tokena."
		return 0
	fi

	CLIENT_ID="${DISCORD_CLIENT_ID:-}"
	BOT_TOKEN="${DISCORD_BOT_TOKEN:-}"

	if [[ -n "${BOT_TOKEN}" ]]; then
		cat >"${ENV_FILE}" <<EOF
# Ignite Discord setup — chmod 600
DISCORD_CLIENT_ID=${CLIENT_ID}
DISCORD_BOT_TOKEN=${BOT_TOKEN}
# DISCORD_GUILD_ID=
EOF
		chmod 600 "${ENV_FILE}"
		echo "Zapisano ${ENV_FILE} (z env)"
		return 0
	fi

	echo ""
	echo "== Discord bot — wklej dane (Enter = pomiń jeśli już w pliku) =="
	open_url "https://discord.com/developers/applications"

	read -rp "Application / Client ID: " CLIENT_ID
	read -rsp "Bot Token (niewidoczny): " BOT_TOKEN
	echo ""

	if [[ -z "${BOT_TOKEN}" ]]; then
		echo "Brak tokena — zapisz ręcznie do ${ENV_FILE}:" >&2
		echo "  DISCORD_BOT_TOKEN=..." >&2
		echo "  DISCORD_CLIENT_ID=..." >&2
		echo "  DISCORD_GUILD_ID=...  # opcjonalnie" >&2
		exit 1
	fi

	cat >"${ENV_FILE}" <<EOF
# Ignite Discord setup — chmod 600
DISCORD_CLIENT_ID=${CLIENT_ID}
DISCORD_BOT_TOKEN=${BOT_TOKEN}
# DISCORD_GUILD_ID=
EOF
	chmod 600 "${ENV_FILE}"
	echo "Zapisano ${ENV_FILE}"
}

invite_link() {
	local cid
	cid="$(grep -E '^DISCORD_CLIENT_ID=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2- || true)"
	if [[ -n "${cid}" ]]; then
		local url="https://discord.com/api/oauth2/authorize?client_id=${cid}&permissions=8&scope=bot%20applications.commands"
		echo ""
		echo "Link zaproszenia bota (Administrator — tylko na setup, potem możesz obniżyć):"
		echo "  ${url}"
		open_url "${url}"
	fi
}

run_setup() {
	echo "Uruchamiam setup…"
	node "${SETUP}"
}

main() {
	local mode="${1:-}"

	if [[ "${mode}" == "setup" ]]; then
		run_setup
		return 0
	fi

	usage
	echo "Krok A: Utwórz pusty serwer w Discord (jeśli jeszcze nie masz)."
	open_url "https://discord.com/channels/@me"
	sleep 1
	prompt_env
	invite_link
	echo ""
	if [[ -n "${DISCORD_SKIP_INVITE_WAIT:-}" ]]; then
		echo "DISCORD_SKIP_INVITE_WAIT=1 — pomijam czekanie na Enter (upewnij się, że bot jest na serwerze)"
	else
		echo "Dodaj bota na swój serwer przez link powyżej, POTEM naciśnij Enter…"
		read -r
	fi

	run_setup
}

main "$@"
