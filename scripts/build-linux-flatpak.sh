#!/usr/bin/env bash
# Buduje .flatpak (Freedesktop 24.08 + Electron2.BaseApp).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Ignite — build Linux Flatpak (amd64) =="

ensure_flatpak_runtime() {
	if ! command -v flatpak >/dev/null 2>&1; then
		echo "Brak flatpak w PATH." >&2
		exit 1
	fi
	local need=()
	for ref in \
		org.freedesktop.Platform//24.08 \
		org.freedesktop.Sdk//24.08 \
		org.electronjs.Electron2.BaseApp//24.08
	do
		if ! flatpak info --system "${ref}" >/dev/null 2>&1 \
			&& ! flatpak info --user "${ref}" >/dev/null 2>&1; then
			need+=("${ref}")
		fi
	done
	if ((${#need[@]} > 0)); then
		echo "Instaluję brakujące runtime Flatpak: ${need[*]}"
		flatpak install -y --noninteractive --system flathub "${need[@]}"
	fi
}

ensure_flatpak_builder() {
	if command -v flatpak-builder >/dev/null 2>&1; then
		return 0
	fi
	if command -v nix >/dev/null 2>&1; then
		echo "Brak flatpak-builder — dołączam przez nixpkgs…"
		# shellcheck disable=SC1091
		eval "$(nix print-dev-env -f '<nixpkgs>' -A flatpak-builder 2>/dev/null || true)"
	fi
	if ! command -v flatpak-builder >/dev/null 2>&1; then
		echo "Brak flatpak-builder. Uruchom: nix shell nixpkgs#flatpak-builder -c $0" >&2
		exit 1
	fi
}

run_build() {
	export CSC_IDENTITY_AUTO_DISCOVERY=false
	ensure_flatpak_runtime
	ensure_flatpak_builder

	echo "[1/3] npm install…"
	npm install

	echo "[2/3] Vite build (ELECTRON_BUILD=1)…"
	npm run build:web:desktop

	echo "[3/3] electron-builder — flatpak x64…"
	npx electron-builder --linux flatpak --x64 --publish never

	show_result
}

show_result() {
	local fp
	fp=$(find release -maxdepth 1 -name 'Ignite-*-linux-amd64.flatpak' 2>/dev/null | head -1)
	if [ -n "${fp}" ]; then
		local size
		size=$(du -h "${fp}" | cut -f1)
		echo ""
		echo "Gotowe: ${fp} (${size})"
		echo "Instalacja: flatpak install --user ${fp##*/}"
		echo "Uruchomienie: flatpak run com.flyball.ignite"
	else
		echo ""
		echo "Sprawdź katalog release/"
		ls -la release/*.flatpak 2>/dev/null || ls -la release/ 2>/dev/null || true
	fi
}

if command -v npm >/dev/null 2>&1; then
	if command -v flatpak-builder >/dev/null 2>&1; then
		run_build
	elif command -v nix >/dev/null 2>&1; then
		echo "Używam: nix shell nixpkgs#flatpak-builder…"
		exec nix shell nixpkgs#flatpak-builder -c bash "$0"
	else
		run_build
	fi
elif [ -f flake.nix ] && command -v nix >/dev/null 2>&1; then
	echo "Używam: nix develop…"
	exec nix develop -c bash "$0"
else
	echo "Brak npm. Uruchom: nix develop && $0"
	exit 1
fi
