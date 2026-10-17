#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_ID="ignite"
DESKTOP_DIR="$HOME/.local/share/applications"
Hicolor="$HOME/.local/share/icons/hicolor"
SCALABLE_DIR="$Hicolor/scalable/apps"
SVG_SRC="$ROOT/assets/flyball.svg"
PNG_SRC="$ROOT/assets/icon.png"
LAUNCHER="$ROOT/scripts/ignite-launch.sh"

chmod +x "$ROOT/scripts/ignite-launch.sh" "$ROOT/scripts/run-desktop.sh" "$ROOT/scripts/run-electron.sh" "$ROOT/scripts/dev-desktop.sh"

render_icon_png() {
	if [[ -f "$ROOT/flake.nix" ]] && command -v nix >/dev/null 2>&1; then
		nix develop "$ROOT" -c node "$ROOT/scripts/render-app-icon.mjs" && return 0
	fi
	if command -v node >/dev/null 2>&1; then
		node "$ROOT/scripts/render-app-icon.mjs" && return 0
	fi
	return 1
}

if ! render_icon_png; then
	echo "WARN: render-app-icon nieudany" >&2
	if [[ ! -f "$PNG_SRC" ]] && command -v inkscape >/dev/null 2>&1; then
		echo "Fallback: inkscape SVG → PNG" >&2
		inkscape "$SVG_SRC" --export-type=png --export-filename="$PNG_SRC" -w 512 -h 512
	fi
fi

if [[ ! -f "$PNG_SRC" ]]; then
	echo "BŁĄD: brak $PNG_SRC — uruchom: nix develop -c npm run icons:render" >&2
	exit 1
fi

for size in 16 32 48 64 128 256 512; do
	mkdir -p "$Hicolor/${size}x${size}/apps"
	if command -v inkscape >/dev/null 2>&1; then
		inkscape "$PNG_SRC" --export-type=png \
			--export-filename="$Hicolor/${size}x${size}/apps/${APP_ID}.png" \
			-w "$size" -h "$size" 2>/dev/null || \
		cp "$PNG_SRC" "$Hicolor/${size}x${size}/apps/${APP_ID}.png"
	else
		cp "$PNG_SRC" "$Hicolor/${size}x${size}/apps/${APP_ID}.png"
	fi
done

mkdir -p "$DESKTOP_DIR" "$SCALABLE_DIR"
cp "$SVG_SRC" "$SCALABLE_DIR/${APP_ID}.svg"

sed -e "s|__LAUNCHER__|${LAUNCHER}|g" -e "s|__ICON__|${PNG_SRC}|g" \
	"$ROOT/assets/ignite.desktop" >"$DESKTOP_DIR/${APP_ID}.desktop"
chmod +x "$DESKTOP_DIR/${APP_ID}.desktop"
update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
gtk-update-icon-cache -f -t "$Hicolor" 2>/dev/null || true

rm -f "$DESKTOP_DIR/flyball.desktop"

echo "OK — $DESKTOP_DIR/${APP_ID}.desktop"
echo "Ikony: $SCALABLE_DIR/${APP_ID}.svg + PNG 16–512 w hicolor"
echo "Launcher: Electron + Vite (świeży src/; auto-restart po zmianach)"
echo "Szybki cold start z dist/: IGNITE_USE_DIST=1 $LAUNCHER"
