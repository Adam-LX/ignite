#!/usr/bin/env bash
# Buduje AppImage Ignite pod Steam Deck (Electron amd64, preset steamdeck).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Ignite — build Steam Deck AppImage (amd64) =="

patch_nixos_7za() {
	local dir="${PWD}/node_modules/7zip-bin/linux/x64"
	local seven
	seven="$(command -v 7za 2>/dev/null || command -v 7z 2>/dev/null || true)"
	[ -n "${seven}" ] || return 0
	[ -d "${dir}" ] || return 0
	if [ -f "${dir}/7za" ] && [ ! -f "${dir}/7za.bundled" ]; then
		if ! "${dir}/7za" --help >/dev/null 2>&1; then
			mv "${dir}/7za" "${dir}/7za.bundled"
		fi
	fi
	printf '#!/usr/bin/env bash\nexec %q "$@"\n' "${seven}" >"${dir}/7za"
	chmod +x "${dir}/7za"
}

patch_nixos_binary() {
	local bin="$1"
	local sys="$2"
	[[ -f "${bin}" && -n "${sys}" ]] || return 0
	[[ -f "${bin}.bundled" ]] && return 0
	if "${bin}" -version >/dev/null 2>&1 || "${bin}" --version >/dev/null 2>&1; then
		return 0
	fi
	mv "${bin}" "${bin}.bundled"
	printf '#!/usr/bin/env bash\nexec %q "$@"\n' "${sys}" >"${bin}"
	chmod +x "${bin}"
}

patch_nixos_appimage_tools() {
	local root="${HOME}/.cache/electron-builder/appimage"
	local f
	for f in \
		"${root}"/appimage-*/linux-x64/mksquashfs \
		"${root}"/appimage-*/linux-x64/desktop-file-validate \
		"${root}"/appimage-*/linux-x64/opj_decompress; do
		[[ -f "${f}" ]] || continue
		case "$(basename "${f}")" in
			mksquashfs)
				patch_nixos_binary "${f}" "$(command -v mksquashfs 2>/dev/null || true)"
				;;
			desktop-file-validate)
				patch_nixos_binary "${f}" "$(command -v desktop-file-validate 2>/dev/null || true)"
				;;
			opj_decompress)
				patch_nixos_binary "${f}" "$(command -v opj_decompress 2>/dev/null || true)"
				;;
		esac
	done
}

preextract_appimage_tools() {
	local cache="${HOME}/.cache/electron-builder/appimage"
	local arch7z dir
	for arch7z in "${cache}"/appimage-*.7z; do
		[[ -f "${arch7z}" ]] || continue
		dir="${arch7z%.7z}"
		if [[ ! -f "${dir}/linux-x64/mksquashfs" ]]; then
			mkdir -p "${dir}"
			7za x -bd "${arch7z}" -o"${dir}" >/dev/null
		fi
	done
	patch_nixos_appimage_tools
}

patch_nixos_fpm() {
	local cache="${HOME}/.cache/electron-builder/fpm/fpm-1.9.3-2.3.1-linux-x86_64"
	local fpm_nix
	fpm_nix="$(command -v fpm 2>/dev/null || true)"
	[ -n "${fpm_nix}" ] || {
		echo "Brak fpm w PATH — uruchom: nix develop" >&2
		exit 1
	}
	mkdir -p "${cache}"
	if [ -f "${cache}/fpm" ] && [ ! -f "${cache}/fpm.bundled" ]; then
		if ! "${cache}/fpm" --version >/dev/null 2>&1; then
			mv "${cache}/fpm" "${cache}/fpm.bundled"
		fi
	fi
	printf '#!/usr/bin/env bash\nexec %q "$@"\n' "${fpm_nix}" >"${cache}/fpm"
	chmod +x "${cache}/fpm"
}

run_build() {
	export CSC_IDENTITY_AUTO_DISCOVERY=false
	export STEAM_DECK=1
	patch_nixos_fpm

	echo "[1/3] npm install…"
	npm install
	patch_nixos_7za
	preextract_appimage_tools

	echo "[2/3] Vite build (ELECTRON_BUILD=1)…"
	npm run build:web:desktop

	echo "[3/3] electron-builder — AppImage x64…"
	preextract_appimage_tools
	npx electron-builder --linux AppImage --x64

	show_result
}

show_result() {
	local img run version
	version=$(node -p "require('./package.json').version")
	img="release/Ignite-${version}-linux-amd64.AppImage"
	if [ -f "${img}" ]; then
		chmod +x "${img}"
		local size
		size=$(du -h "${img}" | cut -f1)
		echo ""
		echo "AppImage: ${img} (${size})"

		echo ""
		echo "[4/4] Pakuję Ignite-SteamDeck.run (jeden plik do pobrania)…"
		bash scripts/mk-steamdeck-run.sh "${img}"
		run="release/Ignite-${version}-SteamDeck.run"
		if [ -f "${run}" ]; then
			echo ""
			echo "★ Pobierz na Decka: ${run}"
			echo "  chmod +x Ignite-*-SteamDeck.run && ./Ignite-*-SteamDeck.run"
		fi
	else
		echo ""
		echo "Sprawdź katalog release/"
		ls -la release/*.AppImage 2>/dev/null || ls -la release/ 2>/dev/null || true
	fi
}

if command -v npm >/dev/null 2>&1 && command -v fpm >/dev/null 2>&1; then
	run_build
elif [ -f flake.nix ] && command -v nix >/dev/null 2>&1; then
	echo "Używam: nix develop…"
	exec nix develop -c bash "$0"
else
	echo "Brak npm/fpm. Uruchom: nix develop && $0"
	exit 1
fi
