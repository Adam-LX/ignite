#!/usr/bin/env bash
# Skeleton: upload Ignite build to Steam depot (S4.6).
# Wymaga: Steamworks SDK steamcmd + AppID + depot IDs w steam/app_build.vdf
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_ID="${STEAM_APP_ID:-}"
if [[ -z "$APP_ID" || "$APP_ID" == "480" ]]; then
	echo "Ustaw STEAM_APP_ID na prawdziwy AppID (480 = Spacewar tylko do lokalnego testu overlay)." >&2
	echo "Partner: https://partner.steamgames.com/" >&2
	exit 1
fi

VDF="${STEAM_APP_BUILD_VDF:-$ROOT/steam/app_build.vdf}"
if [[ ! -f "$VDF" ]]; then
	echo "Brak $VDF — skopiuj steam/app_build.vdf.example → app_build.vdf i uzupełnij depot IDs." >&2
	exit 1
fi

BUILD_DIR="${STEAM_CONTENT_DIR:-$ROOT/dist-steam}"
if [[ ! -d "$BUILD_DIR" ]]; then
	echo "Brak content dir: $BUILD_DIR (najpierw pack Win/Linux do dist-steam/)." >&2
	exit 1
fi

echo "[steam] AppID=$APP_ID content=$BUILD_DIR vdf=$VDF"
echo "[steam] TODO: podłącz steamcmd po AppID (S4.1). Szkielet — nic nie uploaduje."
# Przykład po konfiguracji:
# steamcmd +login "$STEAM_USER" +run_app_build "$VDF" +quit
