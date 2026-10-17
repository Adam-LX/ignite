#!/usr/bin/env bash
# Jednorazowa konfiguracja CI na codeberg.org/Adam-LX/ignite:
#   - włącza Actions
#   - ustawia secret CODEBERG_DEPLOY_KEY (klucz SSH z zapisem do repo)
#
# Wymaga tokenu API (scope: repo):
#   CODEBERG_TOKEN=... ./scripts/setup-codeberg-ci.sh
#
# Token: https://codeberg.org/user/settings/applications
set -euo pipefail
cd "$(dirname "$0")/.."

CODEBERG_USER="${CODEBERG_USER:-Adam-LX}"
CODEBERG_REPO="${CODEBERG_REPO:-ignite}"
CODEBERG_LOGIN="${CODEBERG_LOGIN:-codeberg}"
KEY_FILE="${CODEBERG_DEPLOY_KEY_FILE:-${HOME}/.ssh/id_ed25519}"

if [[ -z "${CODEBERG_TOKEN:-}" ]]; then
	echo "Brak CODEBERG_TOKEN." >&2
	echo "" >&2
	echo "1. Utwórz token: https://codeberg.org/user/settings/applications" >&2
	echo "2. Uruchom:" >&2
	echo "   CODEBERG_TOKEN=<token> ./scripts/setup-codeberg-ci.sh" >&2
	echo "" >&2
	echo "Ręcznie (bez tokenu):" >&2
	echo "  • Repo → Ustawienia → Units → włącz Actions" >&2
	echo "  • Repo → Ustawienia → Actions → Secrets → CODEBERG_DEPLOY_KEY" >&2
	echo "    (wklej zawartość ${KEY_FILE})" >&2
	exit 1
fi

if [[ ! -f "${KEY_FILE}" ]]; then
	echo "Brak klucza SSH: ${KEY_FILE}" >&2
	exit 1
fi

api() {
	curl -sf -X "$1" "https://codeberg.org/api/v1/$2" \
		-H "Authorization: token ${CODEBERG_TOKEN}" \
		-H "Content-Type: application/json" \
		${3:+-d "$3"}
}

echo "== Włączanie Actions =="
api PATCH "repos/${CODEBERG_USER}/${CODEBERG_REPO}" '{"has_actions":true}' \
	| node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('has_actions:', d.has_actions)"

echo ""
echo "== Secret CODEBERG_DEPLOY_KEY =="

if command -v tea >/dev/null 2>&1; then
	if ! tea logins list 2>/dev/null | grep -q "${CODEBERG_LOGIN}-api"; then
		tea logins add --name "${CODEBERG_LOGIN}-api" --url https://codeberg.org \
			--token "${CODEBERG_TOKEN}" --no-version-check
	fi
	tea actions secrets create --login "${CODEBERG_LOGIN}-api" \
		-r "${CODEBERG_USER}/${CODEBERG_REPO}" \
		CODEBERG_DEPLOY_KEY --file "${KEY_FILE}" 2>/dev/null \
		|| tea actions secrets create --login "${CODEBERG_LOGIN}-api" \
			-r "${CODEBERG_USER}/${CODEBERG_REPO}" \
			CODEBERG_DEPLOY_KEY --stdin <"${KEY_FILE}"
	echo "Secret ustawiony przez tea."
else
	echo "Brak tea — ustaw secret ręcznie w UI (Actions → Secrets)." >&2
	echo "Nazwa: CODEBERG_DEPLOY_KEY" >&2
	echo "Wartość: plik ${KEY_FILE}" >&2
fi

echo ""
echo "Gotowe. Push na main odpala .forgejo/workflows/release.yml"
echo "Repo: https://codeberg.org/${CODEBERG_USER}/${CODEBERG_REPO}/actions"
