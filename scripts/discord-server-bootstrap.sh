#!/usr/bin/env bash
# Bootstrap bota Discord + auto-tworzenie / setup serwera Ignite.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_DIR="${HOME}/.config/ignite"
ENV_FILE="${ENV_DIR}/discord.env"
SETUP="${ROOT}/scripts/discord-setup-server.mjs"

usage() {
	cat <<EOF
Użycie: $(basename "$0") [run|setup]

  run   — pełny flow (token → invite → setup)
  setup — tylko discord-setup-server.mjs (token już w env)

Jednorazowo (~3 min):
  1) developers.discord.com → New Application „Ignite” → Bot → Reset Token
     Włącz: MESSAGE CONTENT INTENT (Musix bot), Public Bot = ON
  2) Wklej Client ID + Bot Token (skrypt zapisze ${ENV_FILE})
  3) Skrypt:
       • jeśli bot ma 0 serwerów → tworzy guild „Ignite”
       • albo dodajesz bota na pusty serwer linkiem OAuth
       • buduje role + kanały + pinezki + invite
  4) Musix (kolejka Admin):
       node scripts/discord-ensure-musix.mjs
       bash scripts/discord-musix-run.sh
       # opcjonalnie: systemctl --user enable --now ignite-musix

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
# Ignite Discord — chmod 600
DISCORD_CLIENT_ID=${CLIENT_ID}
DISCORD_BOT_TOKEN=${BOT_TOKEN}
# DISCORD_GUILD_ID=
EOF
		chmod 600 "${ENV_FILE}"
		echo "Zapisano ${ENV_FILE} (z env)"
		return 0
	fi

	echo ""
	echo "== Discord bot Ignite — wklej dane =="
	open_url "https://discord.com/developers/applications"

	read -rp "Application / Client ID: " CLIENT_ID
	read -rsp "Bot Token (niewidoczny): " BOT_TOKEN
	echo ""

	if [[ -z "${BOT_TOKEN}" ]]; then
		echo "Brak tokena — zapisz ręcznie do ${ENV_FILE}:" >&2
		echo "  DISCORD_BOT_TOKEN=..." >&2
		echo "  DISCORD_CLIENT_ID=..." >&2
		exit 1
	fi

	cat >"${ENV_FILE}" <<EOF
# Ignite Discord — chmod 600
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
		echo "Link zaproszenia bota (opcjonalny, jeśli bot ma już 0 serwerów — setup sam utworzy guild):"
		echo "  ${url}"
	fi
}

run_setup() {
	echo "Uruchamiam setup…"
	node "${SETUP}"
}

main() {
	local mode="${1:-run}"

	if [[ "${mode}" == "-h" || "${mode}" == "--help" ]]; then
		usage
		return 0
	fi

	if [[ "${mode}" == "setup" ]]; then
		run_setup
		return 0
	fi

	usage
	prompt_env
	invite_link
	echo ""
	echo "Jeśli bot jest już na serwerze albo ma 0 serwerów (auto-create) — Enter."
	echo "W przeciwnym razie najpierw dodaj bota linkiem OAuth, potem Enter."
	if [[ -z "${DISCORD_SKIP_INVITE_WAIT:-}" ]]; then
		read -r
	fi
	run_setup
}

main "$@"
