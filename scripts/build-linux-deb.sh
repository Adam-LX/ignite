#!/usr/bin/env bash
# Buduje .deb dla Ubuntu/Debian (Electron, amd64).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Ignite — build Linux .deb (Ubuntu amd64) =="

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
	patch_nixos_fpm

	echo "[1/3] npm install…"
	npm install

	echo "[2/3] Vite build (ELECTRON_BUILD=1)…"
	npm run build:web:desktop

	echo "[3/3] electron-builder — deb x64…"
	npx electron-builder --linux deb --x64 --publish never

	show_result
}

show_result() {
	local deb
	deb=$(find release -maxdepth 1 -name 'Ignite-*-linux-amd64.deb' -o -name 'ignite_*_amd64.deb' 2>/dev/null | head -1)
	if [ -n "${deb}" ]; then
		local size
		size=$(du -h "${deb}" | cut -f1)
		echo ""
		echo "Gotowe: ${deb} (${size})"
		echo "Instalacja: sudo dpkg -i ${deb##*/}  && sudo apt -f install"
		echo "Uruchomienie: ignite   (menu aplikacji: Ignite)"
	else
		echo ""
		echo "Sprawdź katalog release/"
		ls -la release/*.deb 2>/dev/null || ls -la release/ 2>/dev/null || true
	fi
}

if command -v npm >/dev/null 2>&1 && command -v fpm >/dev/null 2>&1; then
	run_build
elif [ -f flake.nix ] && command -v nix >/dev/null 2>&1; then
	echo "Używam: nix develop (nodejs + fpm + dpkg)…"
	exec nix develop -c bash "$0"
else
	echo "Brak npm/fpm. Uruchom: nix develop && $0"
	exit 1
fi
