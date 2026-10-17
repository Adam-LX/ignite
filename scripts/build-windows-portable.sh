#!/usr/bin/env bash
# Buduje Ignite-*-win64.zip (win-unpacked + Ignite.exe) — bez NSIS portable / admina.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== Ignite — build Windows (zip x64) =="
echo ""

run_build() {
	export CSC_IDENTITY_AUTO_DISCOVERY=false
	export USE_SYSTEM_7ZA=true

	echo "[1/3] npm install…"
	npm install

	echo "[2/3] Vite build (ELECTRON_BUILD=1)…"
	npm run build:web:desktop

	echo "[3/3] electron-builder — Windows zip x64…"
	npx electron-builder --win zip --x64 --publish never

	show_result
}

show_result() {
	local zip
	zip=$(find release -maxdepth 1 -name 'Ignite-*-win64.zip' -print -quit 2>/dev/null || true)
	if [ -n "${zip}" ]; then
		local size
		size=$(du -h "${zip}" | cut -f1)
		echo ""
		echo "Gotowe: ${zip} (${size})"
		echo "Tester: wypakuj zip → uruchom Ignite.exe (bez admina, bez instalacji)."
		echo "F11 = fullscreen · Esc = pauza · Alt+Esc = wyjście"
	else
		echo ""
		echo "Sprawdź katalog release/"
		ls -la release/ 2>/dev/null || true
	fi
}

if command -v npm >/dev/null 2>&1; then
	run_build
elif [ -f flake.nix ] && command -v nix >/dev/null 2>&1; then
	echo "Używam: nix develop…"
	exec nix develop -c bash "$0"
else
	echo "Brak npm. Uruchom: nix develop && $0"
	exit 1
fi
