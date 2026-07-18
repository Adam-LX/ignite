#!/usr/bin/env bash
# Publikuje binaria na GitHub Releases (bez LFS / quota Codeberg).
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/release-common.sh
source "$(dirname "$0")/lib/release-common.sh"

GITHUB_USER="${GITHUB_USER:-Adam-LX}"
GITHUB_REPO="${GITHUB_REPO:-ignite-releases}"

usage() {
	cat <<EOF
Użycie: $(basename "$0") [--push-downloads]

  Tworzy/aktualizuje release vVERSION na github.com/${GITHUB_USER}/${GITHUB_REPO}
  Wymaga: gh auth login -h github.com -p ssh -s repo -w

  --push-downloads  — po uploadzie zaktualizuj DOWNLOADS.md na Codeberg (sam tekst)
EOF
}

ensure_gh() {
	if ! command -v gh >/dev/null 2>&1; then
		echo "Brak gh — uruchom: nix shell nixpkgs#gh -c $0 $*" >&2
		exit 1
	fi
	if ! gh auth status -h github.com >/dev/null 2>&1; then
		echo "Brak logowania GitHub. Jednorazowo:" >&2
		echo "  nix shell nixpkgs#gh -c gh auth login -h github.com -p ssh -s repo -w" >&2
		exit 1
	fi
}

collect_assets() {
	local version zip deb run
	version=$(read_version)
	zip=$(find_win_zip)
	deb=$(find_linux_deb)
	run=$(find_steamdeck_run)

	[[ -f "${zip}" && -f "${deb}" && -f "${run}" ]] || {
		echo "Brak binarek w release/ — zbuduj: ./scripts/publish-codeberg.sh all" >&2
		exit 1
	}

	printf '%s\n' "${zip}" "${deb}" "${run}"
}

publish_release() {
	local version tag slug assets
	version=$(read_version)
	tag="v${version}"
	slug="${GITHUB_USER}/${GITHUB_REPO}"

	mapfile -t assets < <(collect_assets)

	echo "== GitHub Releases → ${slug} (${tag}) =="
	gh repo view "${slug}" >/dev/null 2>&1 || \
		gh repo create "${slug}" --public \
			--description "Ignite — binaria desktop (Windows / Linux / Steam Deck)"

	if gh release view "${tag}" -R "${slug}" >/dev/null 2>&1; then
		echo "Aktualizuję istniejący release ${tag}…"
		gh release delete "${tag}" -R "${slug}" --yes
	fi

	gh release create "${tag}" "${assets[@]}" \
		-R "${slug}" \
		--title "Ignite ${version}" \
		--notes "Desktop builds · kod na [Codeberg](https://codeberg.org/${CODEBERG_USER}/${CODEBERG_REPO})"

	echo ""
	echo "Pobieranie (v${version}):"
	local base="https://github.com/${slug}/releases/download/${tag}"
	for a in "${assets[@]}"; do
		echo "  $(basename "${a}") → ${base}/$(basename "${a}")"
	done
}

push_downloads_md() {
	local version
	version=$(read_version)
	render_downloads_github "${version}" >"${ROOT}/DOWNLOADS.md"
	ensure_codeberg_ssh
	cd "${ROOT}"
	git add DOWNLOADS.md
	if git diff --cached --quiet; then
		echo "DOWNLOADS.md bez zmian."
		return 0
	fi
	git -c "user.name=${CODEBERG_USER}" \
		-c "user.email=${CODEBERG_USER}@noreply.codeberg.org" \
		commit -m "DOWNLOADS.md → GitHub Releases v${version}"
	git push origin main
}

main() {
	local push_dl=0
	for arg in "$@"; do
		case "${arg}" in
			-h | --help) usage; exit 0 ;;
			--push-downloads) push_dl=1 ;;
			*) echo "Nieznany argument: ${arg}" >&2; usage >&2; exit 1 ;;
		esac
	done

	ensure_gh
	publish_release
	[[ "${push_dl}" == "1" ]] && push_downloads_md
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
	if ! command -v gh >/dev/null 2>&1; then
		if command -v nix >/dev/null 2>&1; then
			exec nix shell nixpkgs#gh -c bash "$0" "$@"
		fi
	fi
	main "$@"
fi
