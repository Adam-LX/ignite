#!/usr/bin/env bash
# Wspólny audyt prywatności — ścieżki + treść tekstowa (export źródeł, app.asar).
set -euo pipefail

# Ścieżki / nazwy plików — blokada (regex na pełną ścieżkę względem roota).
PRIVACY_PATH_RX='(\.cursor/|\.cursorrules$|/\.cursor/|IMPLEMENTATION\.md$|\.jsonl$|agent-transcript|agent_transcript|/\.env$|/\.env\.|data/donation\.env$|/donation\.json$|\.pem$|id_rsa|credentials\.json$|\.provenance\.json$|/docker/|^docker/|/scripts/music/|/screenshots/)'

# Treść — tokeny, ścieżki home, transkrypty (nie nazwy plików z listy wykluczeń).
PRIVACY_CONTENT_RX='/home/[a-zA-Z0-9._-]+|HF_TOKEN=[^[:space:]#[:blank:]]{8,}|ghp_[a-zA-Z0-9]+|github_pat_[a-zA-Z0-9_]+|sk-[a-zA-Z0-9-]{20,}|agent-transcript|agent_transcript|Dokumenty/Projekty/FlyBall'

privacy_rg_globs() {
	printf '%s\n' \
		'!*.png' '!*.jpg' '!*.jpeg' '!*.gif' '!*.webp' '!*.ico' \
		'!*.mp3' '!*.ogg' '!*.wav' '!*.flac' \
		'!*.glb' '!*.gltf' '!*.bin' '!*.wasm' '!*.zst' '!*.7z' \
		'!*.exe' '!*.deb' '!*.asar' '!*.zip' \
		'!*.obj' '!*.mtl' \
		'!**/.source-exportignore' '!**/.gitignore' \
		'!**/privacy-audit.sh' \
		'!**/export-source.sh' \
		'!**/release-common.sh' \
		'!**/LICENSE.md' \
		'!**/MUSIC.md'
}

audit_privacy_paths() {
	local root="$1"
	local label="${2:-${root}}"

	echo "== Audyt ścieżek: ${label} ==" >&2
	local hits
	hits=$(find "${root}" -print 2>/dev/null | rg -i "${PRIVACY_PATH_RX}" || true)
	if [[ -n "${hits}" ]]; then
		echo "BLOKADA: wrażliwe ścieżki:" >&2
		echo "${hits}" >&2
		return 1
	fi
	echo "OK — brak wrażliwych ścieżek" >&2
}

audit_privacy_path_listing() {
	local label="$1"
	shift
	local listing="$*"

	echo "== Audyt listy plików: ${label} ==" >&2
	local hits
	hits=$(echo "${listing}" | rg -i "${PRIVACY_PATH_RX}" || true)
	if [[ -n "${hits}" ]]; then
		echo "BLOKADA: wrażliwe ścieżki:" >&2
		echo "${hits}" >&2
		return 1
	fi
	echo "OK — brak wrażliwych ścieżek" >&2
}

audit_privacy_content() {
	local root="$1"
	local label="${2:-${root}}"

	echo "== Audyt treści: ${label} ==" >&2
	local -a rg_args=()
	local g
	while IFS= read -r g; do
		rg_args+=(-g "${g}")
	done < <(privacy_rg_globs)

	local hits
	hits=$(rg -n --hidden "${rg_args[@]}" -e "${PRIVACY_CONTENT_RX}" "${root}" 2>/dev/null || true)
	if [[ -n "${hits}" ]]; then
		echo "BLOKADA: wrażliwa treść w plikach:" >&2
		echo "${hits}" >&2
		return 1
	fi
	echo "OK — brak wrażliwej treści w plikach tekstowych" >&2
}

audit_privacy_tree() {
	local root="$1"
	local label="${2:-$(basename "${root}")}"
	audit_privacy_paths "${root}" "${label}"
	audit_privacy_content "${root}" "${label}"
}

audit_privacy_asar() {
	local asar="$1"
	[[ -f "${asar}" ]] || {
		echo "Brak ${asar}" >&2
		return 1
	}

	echo "== Audyt paczki: ${asar} ==" >&2
	local listing
	listing=$(nix develop -c npx --yes asar list "${asar}" 2>/dev/null)
	audit_privacy_path_listing "${asar}" "${listing}"
	local count
	count=$(echo "${listing}" | wc -l)
	echo "OK — ${count} plików w asar" >&2
}

audit_privacy_tarball() {
	local archive="$1"
	echo "== Audyt archiwum: $(basename "${archive}") ==" >&2
	local listing hits
	listing=$(tar -tf "${archive}")
	hits=$(echo "${listing}" | rg -i "${PRIVACY_PATH_RX}" || true)
	if [[ -n "${hits}" ]]; then
		echo "BLOKADA: wrażliwe ścieżki w archiwum:" >&2
		echo "${hits}" >&2
		return 1
	fi
	echo "OK — $(echo "${listing}" | wc -l) wpisów, ścieżki czyste" >&2

	local tmp extracted
	tmp=$(mktemp -d)
	tar -xf "${archive}" -C "${tmp}"
	extracted=$(find "${tmp}" -mindepth 1 -maxdepth 1 -type d | head -1)
	[[ -n "${extracted}" ]] || {
		echo "BLOKADA: puste archiwum" >&2
		rm -rf "${tmp}"
		return 1
	}
	audit_privacy_content "${extracted}" "$(basename "${archive}")"
	rm -rf "${tmp}"
}
