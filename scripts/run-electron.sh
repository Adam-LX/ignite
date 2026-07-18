#!/usr/bin/env bash
# Electron na NixOS — binarka z nixpkgs (node_modules/electron nie ma ld-linux).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PATH="/run/current-system/sw/bin:/nix/var/nix/profiles/default/bin:${HOME}/.nix-profile/bin:${PATH}"

if command -v nix >/dev/null 2>&1; then
	exec nix shell nixpkgs#electron -c bash -lc \
		'exec electron . --no-sandbox "$@"' \
		-- "$@"
fi

exec npx electron . "$@"
