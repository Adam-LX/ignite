#!/usr/bin/env bash
# Sprawdza miejsce na dysku → buduje → audyt → publikuje na Codeberg (win / linux / source / all).
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/release-common.sh
source "$(dirname "$0")/lib/release-common.sh"

usage() {
	cat <<EOF
Użycie: $(basename "$0") [win|linux|source|all]

  win     — zip x64 + tag vVERSION-win64
  linux   — .deb amd64 + tag vVERSION-linux-amd64
  source  — eksport oczyszczonego .tar.zst do release/ (tylko lokalnie)
  all     — win + linux (domyślnie; opcjonalnie lokalny eksport źródeł)

Zmienne: CODEBERG_USER, CODEBERG_REPO, SKIP_BUILD=1 (pomiń build binarek)
         EXPORT_SOURCE_LOCAL=0 (pomiń lokalny eksport źródeł przy all)
EOF
}

build_win() {
	[[ "${SKIP_BUILD:-0}" == "1" ]] && return 0
	./scripts/build-windows-portable.sh
}

build_linux() {
	[[ "${SKIP_BUILD:-0}" == "1" ]] && return 0
	./scripts/build-linux-deb.sh
}

prepare_source() {
	[[ "${SKIP_SOURCE:-0}" == "1" ]] && return 0
	export_source_tarball
}

publish_win() {
	local zip version tag
	zip=$(find_win_zip)
	[[ -n "${zip}" ]] || {
		echo "Brak Ignite-*-win64.zip w release/" >&2
		exit 1
	}
	audit_asar "${ROOT}/release/win-unpacked/resources/app.asar"
	version=$(read_version)
	tag="v${version}-win64"
	publish_artifacts "${zip}:${tag}"
}

publish_linux() {
	local deb version tag
	deb=$(find_linux_deb)
	[[ -n "${deb}" ]] || {
		echo "Brak Ignite-*-linux-amd64.deb w release/" >&2
		exit 1
	}
	audit_asar "${ROOT}/release/linux-unpacked/resources/app.asar"
	version=$(read_version)
	tag="v${version}-linux-amd64"
	publish_artifacts "${deb}:${tag}"
}

publish_source() {
	local version src
	version=$(read_version)
	prepare_source >/dev/null
	src="${ROOT}/release/Ignite-${version}-src.tar.zst"
	[[ -f "${src}" ]] || {
		echo "Brak ${src}" >&2
		exit 1
	}
	echo "Archiwum źródeł (tylko lokalnie): ${src}"
}

publish_all() {
	local zip deb version
	zip=$(find_win_zip)
	deb=$(find_linux_deb)
	[[ -n "${zip}" && -n "${deb}" ]] || {
		echo "Brak artefaktów w release/ (zip lub deb)." >&2
		exit 1
	}
	audit_asar "${ROOT}/release/win-unpacked/resources/app.asar"
	audit_asar "${ROOT}/release/linux-unpacked/resources/app.asar"
	version=$(read_version)
	if [[ "${EXPORT_SOURCE_LOCAL:-1}" == "1" ]]; then
		prepare_source >/dev/null
		echo "Archiwum źródeł (lokalnie): release/Ignite-${version}-src.tar.zst"
	fi
	publish_artifacts \
		"${zip}:v${version}-win64" \
		"${deb}:v${version}-linux-amd64"
}

main() {
	local target="${1:-all}"

	case "${target}" in
		-h | --help)
			usage
			exit 0
			;;
		win | linux | source | all) ;;
		*)
			echo "Nieznany cel: ${target}" >&2
			usage >&2
			exit 1
			;;
	esac

	local version
	version=$(read_version)
	echo "== Ignite publish → Codeberg (v${version}, ${target}) =="
	echo ""

	echo "== Miejsce na dysku =="
	case "${target}" in
		win | linux) check_disk_space 8 "${ROOT}" "${HOME}/.cache" ;;
		source) check_disk_space 4 "${ROOT}" "${HOME}/.cache" ;;
		all) check_disk_space 12 "${ROOT}" "${HOME}/.cache" ;;
	esac
	echo ""

	case "${target}" in
		win)
			build_win
			publish_win
			;;
		linux)
			build_linux
			publish_linux
			;;
		source)
			publish_source
			;;
		all)
			build_win
			build_linux
			publish_all
			;;
	esac
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
	if ! command -v tea >/dev/null 2>&1 || ! command -v git-lfs >/dev/null 2>&1 || ! command -v zstd >/dev/null 2>&1; then
		if [ -f flake.nix ] && command -v nix >/dev/null 2>&1; then
			echo "Używam: nix develop (tea + git-lfs + zstd)…"
			exec nix develop -c bash "$0" "$@"
		fi
	fi
	main "$@"
fi
