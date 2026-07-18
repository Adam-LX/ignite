#!/usr/bin/env bash
# Publikacja wytrenowanej polityki do federacji (GitHub bot-brain + relaye).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

if command -v npm >/dev/null 2>&1; then
	exec npm run publish:trained-policy
fi

exec nix develop -c npm run publish:trained-policy
