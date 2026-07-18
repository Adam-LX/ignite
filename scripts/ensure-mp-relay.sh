#!/usr/bin/env bash
# Auto przed dev: serwer MP + tunnel + public/mp-endpoint.json (bez ręcznego env).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "${ROOT}/scripts/bake-mp-endpoint.sh" --ensure
