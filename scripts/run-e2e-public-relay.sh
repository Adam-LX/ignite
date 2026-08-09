#!/usr/bin/env bash
# E2E online przez publiczny relay (auto-wykrywanie z ensure-mp-relay).
set -euo pipefail
cd "$(dirname "$0")/.."

bash scripts/ensure-mp-relay.sh
# shellcheck disable=SC1091
source data/mp-public-endpoint.env

if [[ -z "${IGNITE_MP_SERVER:-}" ]]; then
	echo "Brak publicznego relay — uruchom cloudflared lub ustaw IGNITE_NAMED_TUNNEL_HOST" >&2
	exit 1
fi

export IGNITE_MP_SERVER
echo "== E2E online przez ${IGNITE_MP_SERVER} =="
export SKIP_E2E_BUILD="${SKIP_E2E_BUILD:-1}"
export SKIP_MP_BAKE=1

bash scripts/bake-mp-endpoint.sh --release
npm run test:e2e:online
