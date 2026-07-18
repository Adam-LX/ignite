#!/usr/bin/env bash
# Ignite — Electron z diagnostyką ghostingu showcase.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

QS="${1:-showcaseAudit=1}"
BASE="${IGNITE_VITE_URL:-http://127.0.0.1:5173}"
BASE="${BASE%%\?*}"
export IGNITE_DEV=1
export IGNITE_VITE_URL="${BASE}/?${QS}"
export IGNITE_BOOT_DEBUG=1

echo "Ignite showcase audit → ${IGNITE_VITE_URL}"
echo "Logi: /tmp/ignite-showcase-audit.log"

if ! curl -sf "${BASE}" >/dev/null 2>&1; then
	echo "Brak Vite na ${BASE} — uruchom: nix develop -c npm run dev" >&2
	exit 1
fi

exec bash "$ROOT/scripts/run-electron.sh" 2>&1 | tee /tmp/ignite-showcase-audit.log
