#!/usr/bin/env bash
# Kompat wstecz — deleguje do publish-codeberg.sh win
set -euo pipefail
exec "$(dirname "$0")/publish-codeberg.sh" win "$@"
