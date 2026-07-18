#!/usr/bin/env bash
# Trening botów na GPU (PyTorch CUDA) — lokalnie, eksport bot-policy.json
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

PYTHON="${FLYBALL_CUDA_PYTHON:-/nix/store/243wwghbn74zc2s73pygjrzjgjk488m6-python3-3.13.12-env/bin/python3}"

if ! "${PYTHON}" -c "import torch" 2>/dev/null; then
	echo "Brak PyTorch w ${PYTHON}" >&2
	echo "Ustaw FLYBALL_CUDA_PYTHON na interpreter z torch+cuda." >&2
	exit 1
fi

exec "${PYTHON}" "${ROOT}/scripts/trainBotsCuda.py" "$@"
status=$?
if [[ "${SKIP_BOT_POLICY_PUBLISH:-}" != "1" ]]; then
	bash "${ROOT}/scripts/auto-publish-bot-policy.sh" || true
fi
exit "${status}"
