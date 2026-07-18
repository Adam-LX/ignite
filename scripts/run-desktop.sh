#!/usr/bin/env bash
# Zbudowany dist → Electron (deleguje do run-desktop.sh w root).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec bash "$ROOT/run-desktop.sh" "$@"
