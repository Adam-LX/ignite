#!/usr/bin/env bash
# Wspólne funkcje: miejsce na dysku, audyt paczki, publikacja Codeberg (Git LFS).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

CODEBERG_USER="${CODEBERG_USER:-Adam-LX}"
CODEBERG_REPO="${CODEBERG_REPO:-ignite}"
CODEBERG_LOGIN="${CODEBERG_LOGIN:-codeberg}"
CODEBERG_SSH_FP="${CODEBERG_SSH_FP:-SHA256:b8S6LUXhl41dwmgd6oBPQkUE8JZpSaomGoiU6GKXb3k}"

read_version() {
	node -p "require('${ROOT}/package.json').version"
}

disk_free_gb() {
	local path="$1"
	df -BG "${path}" 2>/dev/null | awk 'NR==2 {gsub(/G/, "", $4); print $4}'
}

check_disk_space() {
	local min_gb="$1"
	shift
	local path worst=999999 avail part

	for path in "$@"; do
		avail=$(disk_free_gb "${path}")
		part=$(df -BG "${path}" 2>/dev/null | awk 'NR==2 {print $1}')
		echo "  ${part}: ${avail} GB wolne"
		if (( avail < worst )); then
			worst=${avail}
		fi
	done

	if (( worst < min_gb )); then
		echo ""
		echo "Za mało miejsca: minimum ${min_gb} GB (najmniej wolne: ${worst} GB)." >&2
		echo "Spróbuj: nix-collect-garbage -d · rm -rf release/ node_modules/.cache ~/.cache/electron-builder" >&2
		exit 1
	fi
	echo "Dysk OK (≥${min_gb} GB wymagane, najmniej wolne: ${worst} GB)."
}

ensure_codeberg_ssh() {
	if [[ -n "${CODEBERG_DEPLOY_KEY:-}" ]]; then
		mkdir -p "${HOME}/.ssh"
		printf '%s\n' "${CODEBERG_DEPLOY_KEY}" >"${HOME}/.ssh/id_ed25519"
		chmod 600 "${HOME}/.ssh/id_ed25519"
		ssh-keyscan -t ed25519 codeberg.org >>"${HOME}/.ssh/known_hosts" 2>/dev/null || true
	fi
	eval "$(ssh-agent -s)" >/dev/null
	ssh-add "${HOME}/.ssh/id_ed25519" 2>/dev/null || true
}

ensure_tea() {
	if [[ "${SKIP_TEA:-0}" == "1" ]]; then
		return 0
	fi
	if ! command -v tea >/dev/null 2>&1; then
		echo "Brak tea — uruchom: nix shell nixpkgs#tea" >&2
		exit 1
	fi
	ensure_codeberg_ssh
	if ! tea logins list 2>/dev/null | grep -q "${CODEBERG_LOGIN}"; then
		tea logins add --name "${CODEBERG_LOGIN}" --url https://codeberg.org \
			--ssh-agent-key "${CODEBERG_SSH_FP}" --no-version-check
	fi
}

ensure_repo() {
	if [[ "${SKIP_TEA:-0}" == "1" ]]; then
		return 0
	fi
	if tea repos list --login "${CODEBERG_LOGIN}" 2>/dev/null | grep -q "${CODEBERG_REPO}"; then
		return 0
	fi
	tea repos create --login "${CODEBERG_LOGIN}" \
		--name "${CODEBERG_REPO}" \
		--description "Ignite — car soccer (desktop builds)" \
		--private=false \
		--init \
		--readme Default \
		--license MIT
}

audit_asar() {
	local asar="$1"
	# shellcheck source=scripts/lib/privacy-audit.sh
	source "${ROOT}/scripts/lib/privacy-audit.sh"
	audit_privacy_asar "${asar}"
}

GITHUB_USER="${GITHUB_USER:-Adam-LX}"
GITHUB_REPO="${GITHUB_REPO:-ignite-releases}"

render_downloads_github() {
	local version="$1"
	local base="https://github.com/${GITHUB_USER}/${GITHUB_REPO}/releases/download/v${version}"
	cat <<EOF
# Ignite — pobieranie

Binaria na **GitHub Releases** (bez limitu LFS). Kod gry: [Codeberg](https://codeberg.org/${CODEBERG_USER}/${CODEBERG_REPO}) · [README.md](README.md).

## Download

| Platforma | Plik | Rozmiar |
|-----------|------|---------|
| **Windows** | [Ignite-${version}-win64.zip](${base}/Ignite-${version}-win64.zip) | ~205 MB |
| **Ubuntu / Debian** | [Ignite-${version}-linux-amd64.deb](${base}/Ignite-${version}-linux-amd64.deb) | ~211 MB |
| **Steam Deck** | [Ignite-${version}-SteamDeck.run](${base}/Ignite-${version}-SteamDeck.run) | ~210 MB |

### Kod źródłowy
Repozytorium git na [Codeberg](https://codeberg.org/${CODEBERG_USER}/${CODEBERG_REPO}) — archiwum \`.tar.zst\` nie jest publikowane (tylko lokalny eksport: \`./scripts/publish-codeberg.sh source\`).

### Windows
1. Pobierz zip → **Wypakuj cały folder**
2. Uruchom **Ignite.exe** — **nie wymaga admina**
3. **F11** — fullscreen · **Esc** — pauza
4. SmartScreen (brak podpisu) → „Więcej informacji” → „Uruchom mimo to”

### Linux
\`\`\`bash
sudo dpkg -i Ignite-${version}-linux-amd64.deb
sudo apt -f install
ignite
\`\`\`

### Steam Deck
\`\`\`bash
chmod +x Ignite-${version}-SteamDeck.run
./Ignite-${version}-SteamDeck.run
\`\`\`
Pierwsze uruchomienie rozpakowuje grę do \`~/.local/share/ignite/\`. Dodaj \`.run\` do Steam jako grę spoza Steam.

[GitHub Releases](https://github.com/${GITHUB_USER}/${GITHUB_REPO}/releases/tag/v${version})
EOF
}

render_downloads() {
	local version="$1"
	cat <<EOF
# Ignite — pobieranie

Binaria desktopowe. Kod gry: [Codeberg](https://codeberg.org/${CODEBERG_USER}/${CODEBERG_REPO}) · [README.md](README.md).

## Download

| Platforma | Plik | Rozmiar |
|-----------|------|---------|
| **Windows** | [Ignite-${version}-win64.zip](https://codeberg.org/${CODEBERG_USER}/${CODEBERG_REPO}/media/tag/v${version}-win64/releases/Ignite-${version}-win64.zip) | ~205 MB |
| **Ubuntu / Debian** | [Ignite-${version}-linux-amd64.deb](https://codeberg.org/${CODEBERG_USER}/${CODEBERG_REPO}/media/tag/v${version}-linux-amd64/releases/Ignite-${version}-linux-amd64.deb) | ~211 MB |

### Kod źródłowy
Repozytorium git — archiwum \`.tar.zst\` tylko lokalnie (\`./scripts/publish-codeberg.sh source\`).

### Windows
1. Pobierz zip → **Wypakuj cały folder**
2. Uruchom **Ignite.exe** — **nie wymaga admina**
3. **F11** — fullscreen · **Esc** — pauza
4. SmartScreen (brak podpisu) → „Więcej informacji” → „Uruchom mimo to”

### Linux
\`\`\`bash
sudo dpkg -i Ignite-${version}-linux-amd64.deb
sudo apt -f install
ignite
\`\`\`
EOF
}

ensure_git_lfs() {
	if ! command -v git-lfs >/dev/null 2>&1; then
		echo "Brak git-lfs" >&2
		exit 1
	fi
	git lfs install --force
	git lfs track '*.zip' '*.deb' '*.tar.zst' '*.mp3' '*.exe' 2>/dev/null || true
}

uses_codeberg_origin() {
	git -C "${ROOT}" rev-parse --is-inside-work-tree &>/dev/null || return 1
	local url
	url=$(git -C "${ROOT}" remote get-url origin 2>/dev/null || true)
	[[ "${url}" == *"${CODEBERG_USER}/${CODEBERG_REPO}"* ]]
}

publish_artifacts_in_repo() {
	local version
	version=$(read_version)
	local tags=()

	echo "== Publikacja w repo (monorepo) =="
	ensure_codeberg_ssh
	ensure_git_lfs

	render_downloads "${version}" >"${ROOT}/DOWNLOADS.md"
	mkdir -p "${ROOT}/releases"

	local pair file tag name
	for pair in "$@"; do
		file="${pair%%:*}"
		tag="${pair##*:}"
		name=$(basename "${file}")
		[[ -f "${file}" ]] || {
			echo "Brak pliku: ${file}" >&2
			exit 1
		}
		cp "${file}" "${ROOT}/releases/${name}"
		tags+=("${tag}")
	done

	cd "${ROOT}"
	git add .gitattributes DOWNLOADS.md releases/
	if git diff --cached --quiet; then
		echo "Brak zmian w releases/ — tagi i tak zostaną zaktualizowane."
	else
		git -c "user.name=${CODEBERG_USER}" \
			-c "user.email=${CODEBERG_USER}@noreply.codeberg.org" \
			commit -m "Release v${version} [skip ci]"
	fi
	git push origin main

	local t
	for t in "${tags[@]}"; do
		git tag -f "${t}"
		git push -f origin "${t}"
	done

	echo ""
	echo "Pobieranie (v${version}):"
	for pair in "$@"; do
		file="${pair%%:*}"
		tag="${pair##*:}"
		echo "  [${tag}] https://codeberg.org/${CODEBERG_USER}/${CODEBERG_REPO}/media/tag/${tag}/releases/$(basename "${file}")"
	done
	echo "Repo: https://codeberg.org/${CODEBERG_USER}/${CODEBERG_REPO}"
}

export_source_tarball() {
	# shellcheck source=scripts/lib/export-source.sh
	source "${ROOT}/scripts/lib/export-source.sh"
	export_clean_source "$(read_version)"
}

find_source_tarball() {
	find "${ROOT}/release" -maxdepth 1 -name 'Ignite-*-src.tar.zst' -print -quit
}

# publish_artifacts file:tag [file:tag ...]
publish_artifacts() {
	if [[ "${CODEBERG_IN_REPO:-}" == "1" ]] || uses_codeberg_origin; then
		publish_artifacts_in_repo "$@"
		return
	fi

	ensure_codeberg_ssh
	ensure_tea
	ensure_repo

	local version
	version=$(read_version)
	local work staging
	work=$(mktemp -d)
	staging=$(mktemp -d)

	echo "== Publikacja na Codeberg (clone + LFS) =="

	mkdir -p "${staging}/releases"
	render_downloads "${version}" >"${staging}/DOWNLOADS.md"
	: >"${staging}/tags.list"

	local pair file tag name
	for pair in "$@"; do
		file="${pair%%:*}"
		tag="${pair##*:}"
		name=$(basename "${file}")
		[[ -f "${file}" ]] || {
			echo "Brak pliku: ${file}" >&2
			exit 1
		}
		cp "${file}" "${staging}/releases/${name}"
		echo "${name}:${tag}" >>"${staging}/tags.list"
	done

	nix shell nixpkgs#git nixpkgs#git-lfs -c bash "${ROOT}/scripts/lib/codeberg-push.sh" \
		"${work}" "${staging}" "${CODEBERG_USER}" "${CODEBERG_REPO}" "${version}"

	rm -rf "${work}" "${staging}"

	echo ""
	echo "Pobieranie (v${version}):"
	for pair in "$@"; do
		file="${pair%%:*}"
		tag="${pair##*:}"
		echo "  [${tag}] https://codeberg.org/${CODEBERG_USER}/${CODEBERG_REPO}/media/tag/${tag}/releases/$(basename "${file}")"
	done
	echo "Repo: https://codeberg.org/${CODEBERG_USER}/${CODEBERG_REPO}"
}

find_versioned_artifact() {
	local pattern="$1"
	local version
	version=$(read_version)
	local exact
	exact=$(find "${ROOT}/release" -maxdepth 1 -name "Ignite-${version}-${pattern}" -print -quit)
	if [[ -n "${exact}" && -f "${exact}" ]]; then
		echo "${exact}"
		return
	fi
	find "${ROOT}/release" -maxdepth 1 -name "Ignite-*-${pattern}" | sort -V | tail -1
}

find_win_zip() {
	find_versioned_artifact "win64.zip"
}

find_linux_deb() {
	local deb
	deb=$(find_versioned_artifact "linux-amd64.deb")
	if [[ -n "${deb}" ]]; then
		echo "${deb}"
		return
	fi
	find "${ROOT}/release" -maxdepth 1 -name 'ignite_*_amd64.deb' -print -quit
}

find_steamdeck_run() {
	find_versioned_artifact "SteamDeck.run"
}
