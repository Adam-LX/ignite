#!/usr/bin/env bash
# Playwright E2E: autostart 1v1 → IGNITE → match live (SwiftShader / Nix chromium).
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:-}" ]]; then
	CHROMIUM_STORE="$(nix build --no-link --print-out-paths nixpkgs#chromium 2>/dev/null || true)"
	if [[ -n "${CHROMIUM_STORE}" && -x "${CHROMIUM_STORE}/bin/chromium" ]]; then
		export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${CHROMIUM_STORE}/bin/chromium"
	fi
fi

export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS="${PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS:-1}"

nix develop -c bash -c '
	if [[ "${SKIP_E2E_BUILD:-0}" != "1" ]]; then
		SKIP_MP_BAKE=1 npm run build:web:desktop
	fi
	node scripts/match-autostart-trace.mjs
'
