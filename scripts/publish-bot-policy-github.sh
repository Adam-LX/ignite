#!/usr/bin/env bash
# Wypchnij data/global-bot-policy.json na GitHub (gałąź bot-brain).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

GITHUB_USER="${GITHUB_USER:-Adam-LX}"
GITHUB_REPO="${GITHUB_REPO:-ignite-releases}"
GITHUB_BRANCH="${IGNITE_BOT_POLICY_GITHUB_BRANCH:-bot-brain}"
POLICY_PATH="${IGNITE_BOT_POLICY_GITHUB_PATH:-global-bot-policy.json}"
SOURCE="${1:-${ROOT}/data/global-bot-policy.json}"

usage() {
	cat <<EOF
Użycie: $(basename "$0") [ścieżka/do/global-bot-policy.json]

Wypycha mózg botów na:
  github.com/${GITHUB_USER}/${GITHUB_REPO} @ ${GITHUB_BRANCH}/${POLICY_PATH}

Wymaga: gh auth login -h github.com (repo scope) lub GITHUB_TOKEN w env.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
	usage
	exit 0
fi

if [[ ! -f "${SOURCE}" ]]; then
	echo "Brak pliku: ${SOURCE}" >&2
	echo "Zagraj mecz vs boty (npm run mp:server) albo: npm run train:bots" >&2
	exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
	echo "Brak gh — nix shell nixpkgs#gh -c $0" >&2
	exit 1
fi

if ! gh auth status -h github.com >/dev/null 2>&1; then
	echo "Zaloguj: gh auth login -h github.com -p ssh -s repo -w" >&2
	exit 1
fi

slug="${GITHUB_USER}/${GITHUB_REPO}"

# Utwórz gałąź bot-brain z main/master jeśli nie istnieje
if ! gh api "repos/${slug}/git/ref/heads/${GITHUB_BRANCH}" >/dev/null 2>&1; then
	default_branch="$(gh api "repos/${slug}" --jq .default_branch)"
	base_sha="$(gh api "repos/${slug}/git/ref/heads/${default_branch}" --jq .object.sha)"
	gh api "repos/${slug}/git/refs" \
		-f ref="refs/heads/${GITHUB_BRANCH}" \
		-f sha="${base_sha}" >/dev/null 2>&1 || true
	echo "Gałąź ${GITHUB_BRANCH} (z ${default_branch})"
fi

gen="$(python3 -c "import json; d=json.load(open('${SOURCE}')); print(d.get('active',{}).get('generation','?'))")"
fit="$(python3 -c "import json; d=json.load(open('${SOURCE}')); print(d.get('active',{}).get('fitness',0))")"
msg="bot-brain: manual publish gen ${gen} fit ${fit}"

existing_sha=""
if gh api "repos/${slug}/contents/${POLICY_PATH}?ref=${GITHUB_BRANCH}" >/dev/null 2>&1; then
	existing_sha="$(gh api "repos/${slug}/contents/${POLICY_PATH}?ref=${GITHUB_BRANCH}" --jq .sha)"
fi

content_b64="$(base64 -w0 <"${SOURCE}")"

if [[ -n "${existing_sha}" ]]; then
	gh api "repos/${slug}/contents/${POLICY_PATH}" \
		-X PUT \
		-f message="${msg}" \
		-f content="${content_b64}" \
		-f branch="${GITHUB_BRANCH}" \
		-f sha="${existing_sha}" >/dev/null
else
	gh api "repos/${slug}/contents/${POLICY_PATH}" \
		-X PUT \
		-f message="${msg}" \
		-f content="${content_b64}" \
		-f branch="${GITHUB_BRANCH}" >/dev/null
fi

raw="https://raw.githubusercontent.com/${slug}/${GITHUB_BRANCH}/${POLICY_PATH}"
echo "OK: ${raw}"
