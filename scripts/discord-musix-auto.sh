#!/usr/bin/env bash
# Pełna automatyzacja Musix: sesja Discord → (jednorazowy kod 2FA) → token → systemd.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN=""
for n in /nix/store/*/bin/node; do
	if [[ -x "$n" && "$n" == *nodejs-24* && "$n" != *slim* && "$n" != *cursor* ]]; then
		NODE_BIN="$n"
		break
	fi
done
NODE_BIN="${NODE_BIN:-node}"

export IGNITE_MUSIX_TOTP="${1:-${IGNITE_MUSIX_TOTP:-}}"
exec "$NODE_BIN" "${ROOT}/scripts/discord-musix-auto-setup.mjs" "$@"
