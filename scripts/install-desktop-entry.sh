#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_ID="ignite"
DESKTOP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/scalable/apps"
LAUNCHER="$ROOT/scripts/ignite-launch.sh"

chmod +x "$LAUNCHER"
mkdir -p "$DESKTOP_DIR" "$ICON_DIR"
cp "$ROOT/assets/flyball.svg" "$ICON_DIR/${APP_ID}.svg"

cat >"$DESKTOP_DIR/${APP_ID}.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Ignite
GenericName=Car Soccer
Comment=Car soccer w przeglądarce
Exec=${LAUNCHER}
Icon=${APP_ID}
Terminal=false
Categories=Game;
StartupNotify=true
Keywords=ignite;car;soccer;game;browser;
EOF

chmod +x "$DESKTOP_DIR/${APP_ID}.desktop"
update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true

# Stary wpis FlyBall — usuń jeśli był
rm -f "$DESKTOP_DIR/flyball.desktop"

echo "OK — wpis: $DESKTOP_DIR/${APP_ID}.desktop"
echo "Szukaj „Ignite” w overview (Super) i przypnij do docka."
