#!/usr/bin/env bash
# Jedna komenda: Vivaldi+CDP → setup kanału Ignite.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

bash "$ROOT/scripts/youtube/open-vivaldi-cdp.sh" --restart
exec node "$ROOT/scripts/youtube/setupChannel.mjs" "$@"
