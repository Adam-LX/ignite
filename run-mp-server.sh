#!/usr/bin/env bash
# Serwer pokojów 1v1 + globalny mózg botów (ws://0.0.0.0:8765)
set -euo pipefail
cd "$(dirname "$0")"
exec nix develop -c npm run mp:server
