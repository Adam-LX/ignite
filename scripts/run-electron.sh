#!/usr/bin/env bash
# Electron na NixOS — binarka z nixpkgs (node_modules/electron nie ma ld-linux).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:${HOME}/.nix-profile/bin:${PATH}"

# Discord u Adama leci na X11 (NVIDIA + GNOME Wayland). Natywny Wayland Electron
# = WebGL poza XComposite → share = czarny ekran dla Adama i Anielki.
# Trzymamy Ignite na XWayland, żeby zwykły Discord widział okno.
export ELECTRON_OZONE_PLATFORM_HINT=x11
export GDK_BACKEND=x11
unset NIXOS_OZONE_WL || true

ELECTRON_ARGS=(
	--no-sandbox
	--class=Ignite
	--ozone-platform=x11
	--disable-gpu-sandbox
	--ignore-gpu-blocklist
)

if command -v nix >/dev/null 2>&1; then
	# -u WAYLAND_DISPLAY → Electron nie bierze natywnego Waylanda mimo DISPLAY=:0
	exec env -u NIXOS_OZONE_WL -u WAYLAND_DISPLAY \
		ELECTRON_OZONE_PLATFORM_HINT=x11 GDK_BACKEND=x11 \
		nix shell nixpkgs#electron -c bash -lc \
		'exec electron . --no-sandbox --class=Ignite --ozone-platform=x11 --disable-gpu-sandbox --ignore-gpu-blocklist "$@"' \
		-- "$@"
fi

exec env -u NIXOS_OZONE_WL -u WAYLAND_DISPLAY \
	ELECTRON_OZONE_PLATFORM_HINT=x11 GDK_BACKEND=x11 \
	npx electron . "${ELECTRON_ARGS[@]}" "$@"
